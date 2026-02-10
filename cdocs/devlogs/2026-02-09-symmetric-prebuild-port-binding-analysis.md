---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T23:30:00-08:00
task_list: lace/dogfooding
type: devlog
state: archived
status: done
tags: [architecture, ports, prebuild, symmetric, containerPort, investigation, devcontainer-spec]
references:
  - cdocs/proposals/2026-02-09-symmetric-prebuild-port-binding.md
  - cdocs/reviews/2026-02-09-review-of-symmetric-prebuild-port-binding.md
  - cdocs/reviews/2026-02-09-review-of-symmetric-prebuild-port-binding-r2.md
  - cdocs/proposals/2026-02-09-prebuild-features-port-support.md
---

# Symmetric Prebuild Port Binding Analysis

## Objective

Investigate whether prebuild features can have their ports changed at runtime and propose a refactor that replaces the asymmetric auto-injection design (from the prebuild-features-port-support proposal) with symmetric injection. The user's feedback was that prebuild features should behave like normal features, not have divergent behavior.

## Plan

1. Read the current asymmetric implementation in `up.ts` and `template-resolver.ts`
2. Read the prior proposal and its review chain (R1-R3) to understand why asymmetric was chosen
3. Investigate the devcontainer feature lifecycle: how options are passed, when `install.sh` runs, whether options can be overridden at runtime
4. Examine the wezterm-server `install.sh` to understand what it actually does with `sshPort`
5. Examine the upstream sshd feature to understand how ports are configured
6. Draft proposal, self-review, revise, re-review

## Investigation Findings

### Key Finding 1: sshPort is metadata-only

The wezterm-server `install.sh` at `/var/home/mjr/code/weft/lace/devcontainers/features/src/wezterm-server/install.sh` only reads two environment variables:

```sh
VERSION="${VERSION:-20240203-110809-5046fc22}"
CREATERUNTIMEDIR="${CREATERUNTIMEDIR:-true}"
```

The `sshPort` option (which becomes `SSHPORT` as an environment variable) is declared in `devcontainer-feature.json` but never consumed by `install.sh`. It exists purely as lace metadata for port allocation and routing. The actual SSH listener port is configured by the separate `ghcr.io/devcontainers/features/sshd:1` feature.

### Key Finding 2: Feature options become environment variables via spec-defined transformation

Per the devcontainer features specification at containers.dev, options are transformed to env vars: `str.replace(/[^\w_]/g, '_').replace(/^[\d_]+/g, '_').toUpperCase()`. So `sshPort` becomes `SSHPORT`. These are emitted to `devcontainer-features.env` and sourced before `install.sh` runs. However, the spec provides NO mechanism for overriding these at runtime -- they are strictly build-time values.

### Key Finding 3: The upstream sshd feature bakes the port at install time

The upstream `ghcr.io/devcontainers/features/sshd:1` reads `SSHD_PORT="${SSHD_PORT:-"2222"}"` and configures `/etc/ssh/sshd_config` via `sed` during `install.sh`. The startup script (`/usr/local/share/ssh-init.sh`) starts the daemon without re-reading the port. For prebuild features, the port is fixed at 2222 (the default).

### Key Finding 4: The devcontainer CLI re-runs install.sh for features in the features block

Features in the `features` block are treated as Docker RUN layers. If the image already has a feature installed (via prebuild), putting the same feature in `features` causes `install.sh` to re-run as a new layer. This is standard Docker layer behavior. However, this defeats the purpose of prebuilding: for wezterm-server, it means re-downloading a ~50MB .deb from GitHub on every `devcontainer up`.

### Key Finding 5: containerPort metadata is the clean solution

The R1 review identified that:
1. Feature promotion (moving prebuild features to `features` block) defeats the prebuild cache
2. Symmetric mapping `22430:22430` is non-functional when sshd listens on 2222

The solution is a `containerPort` field in `customizations.lace.ports` metadata that declares the actual container-side port. This lets `generatePortEntries()` produce correct `host:containerPort` mappings without re-running `install.sh` or hardcoding defaults in the injection logic.

## Design Evolution

### R0: Feature promotion (original draft)

The initial approach promoted port-declaring prebuild features to the `features` block in the extended config, causing the devcontainer CLI to re-run `install.sh` with resolved port values. This had two fatal flaws:
- Performance: re-downloading binaries on every build
- Correctness: sshPort is metadata-only, so re-running install.sh with `SSHPORT=22430` has no effect (the script ignores it)

### R1: containerPort metadata (accepted)

Replace feature promotion with a `containerPort` field in the feature's `customizations.lace.ports` declaration. This field tells lace "the service inside the container listens on this port" and is used by `generatePortEntries()` to produce correct `appPort` mappings. The injection remains symmetric (same `injectForBlock()` call for both blocks). The prebuild cache is fully preserved.

## Implementation Notes

### Symmetric injection is a one-line change

The entire injection simplification reduces to replacing:

```typescript
injectForBlock(features, metadataMap, injected);
injectForPrebuildBlock(config, prebuildFeatures, metadataMap, injected);
```

With:

```typescript
injectForBlock(features, metadataMap, injected);
injectForBlock(prebuildFeatures, metadataMap, injected);
```

And deleting `injectForPrebuildBlock()` entirely (~40 lines removed).

### containerPort-aware appPort generation is also a one-line change

In `generatePortEntries()`:

```typescript
// Before:
result.appPort.push(`${alloc.port}:${alloc.port}`);

// After:
const containerPort = featureMeta?.containerPort ?? alloc.port;
result.appPort.push(`${alloc.port}:${containerPort}`);
```

### The resolved prebuild option value is "dead data"

When `${lace.port(wezterm-server/sshPort)}` resolves to `22430` in the prebuild feature's options, this value appears in the extended config's `prebuildFeatures` block. The devcontainer CLI ignores it entirely -- it only processes the top-level `features` block. But the value served its purpose: the `PortAllocator` assigned port 22430 for label `wezterm-server/sshPort`, and `generatePortEntries()` used that allocation to create `appPort: ["22430:2222"]` (with `containerPort` from metadata).

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/proposals/2026-02-09-symmetric-prebuild-port-binding.md` | Proposal: symmetric injection + containerPort metadata |
| `cdocs/reviews/2026-02-09-review-of-symmetric-prebuild-port-binding.md` | R1 review: identified feature promotion as flawed |
| `cdocs/reviews/2026-02-09-review-of-symmetric-prebuild-port-binding-r2.md` | R2 review: accepted containerPort approach |
| `cdocs/devlogs/2026-02-09-symmetric-prebuild-port-binding-analysis.md` | This devlog |

## Verification

This is an analysis/proposal session, not an implementation session. Verification is that the proposal was accepted at R2 with only non-blocking suggestions:

- R1 review: **Revise** -- two blocking issues (E7 correctness, feature promotion performance)
- R2 review: **Accept** -- both blocking issues resolved via containerPort metadata

The proposal is ready for implementation. Key implementation artifacts:
- `containerPort` field added to `LacePortDeclaration` and `FeaturePortDeclaration` types
- One-line change in `generatePortEntries()` to use `containerPort ?? alloc.port`
- Deletion of `injectForPrebuildBlock()` (~40 lines)
- Deletion of `warnPrebuildPortFeaturesStaticPort()` (~50 lines)
- Addition of `containerPort: 2222` to wezterm-server's `devcontainer-feature.json`
- Update of `warnPrebuildPortTemplates()` message text

## Key Question Answered

> Is it actually possible for a prebaked feature to have its port changed at runtime?

**No.** The devcontainer spec provides no mechanism for overriding feature options at runtime. Feature options are strictly build-time environment variables passed to `install.sh`. For prebaked features, `install.sh` ran at prebuild time with default values, and the configuration is baked into the image. There is no runtime override mechanism.

However, this does not matter for achieving symmetric behavior. The port that matters for connectivity is the `appPort` mapping -- the Docker port binding between host and container. This is a runtime concern that lace controls via the extended config. The `containerPort` metadata field tells lace what port the service actually listens on inside the container, enabling correct `appPort` generation without needing to change anything inside the container at runtime.
