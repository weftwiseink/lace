---
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-02-26T00:00:00-06:00
last_updated:
  by: "@claude-sonnet-4-6"
  at: 2026-02-26T18:00:00-06:00
task_list: lace/portless
type: report
state: live
status: done
tags: [investigation, ports, portless, wezterm, asymmetric-mapping, architecture, design-rationale]
references:
  - packages/lace/src/lib/up.ts
  - packages/lace/src/lib/port-allocator.ts
  - packages/lace/src/lib/template-resolver.ts
  - packages/lace/src/lib/feature-metadata.ts
  - devcontainers/features/src/wezterm-server/devcontainer-feature.json
  - devcontainers/features/src/wezterm-server/install.sh
  - cdocs/proposals/2026-02-26-portless-devcontainer-feature.md
  - cdocs/reports/2026-02-26-portless-integration-design-rationale.md
---

# Lace Port Allocation Design Investigation

> **BLUF:** Lace has two distinct port injection paths: symmetric (top-level `features`) and asymmetric (`prebuildFeatures`).
> The wezterm-server feature uses the prebuild path — `hostSshPort` default "2222" becomes the container-internal port, lace allocates the host port, producing asymmetric `22430:2222` mappings.
> install.sh never reads the option value.
> Portless should follow the same prebuild pattern: default "1355" as container-internal, lace maps asymmetrically (e.g., `22435:1355`).
> This eliminates build-time port baking entirely — the container always uses portless's default port, and port reassignment only changes the Docker mapping.
>
> **Update (round 3):** The original version of this report concluded that using portless as a prebuild feature was "architecturally wrong."
> This was based on the false premise that prebuild features are only for build-time concerns.
> In fact, wezterm-mux-server is also a runtime daemon started via entrypoint — the "prebuild" layer is about Docker image layering, not about whether the service runs at build time or runtime.
> The portless proposal now uses the prebuild path, matching the wezterm pattern exactly.

## How the Wezterm-Server Feature Actually Works

### The declaration

In `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/wezterm-server/devcontainer-feature.json`:

```json
"options": {
    "hostSshPort": {
        "type": "string",
        "default": "2222",
        "description": "Host-side SSH port for lace port allocation. Not used by install.sh ..."
    }
},
"customizations": {
    "lace": {
        "ports": {
            "hostSshPort": {
                "label": "wezterm ssh",
                "onAutoForward": "silent",
                "requireLocalPort": true
            }
        }
    }
}
```

The `default` is `"2222"` — the container-internal sshd port. The field description
explicitly states: "Not used by install.sh -- the actual SSH listener port is
determined by the sshd feature (default 2222)."

### What install.sh does

`install.sh` does not read `HOSTSSHPORT` at all. It installs wezterm-mux-server
binaries and writes an entrypoint that starts `wezterm-mux-server --daemonize`.
No sshd configuration. No port baking. The `hostSshPort` option exists solely as
lace pipeline metadata.

### The implicit design: prebuild-only

Because `hostSshPort` is never used by `install.sh`, the feature only makes
sense as a **prebuild feature** placed in
`customizations.lace.prebuildFeatures`, not in the top-level `features` block.

For prebuild features, `injectForPrebuildBlock()` in `template-resolver.ts`
produces an **asymmetric** `appPort` entry:

```typescript
// Asymmetric injection writes ${lace.port(...)}:DEFAULT_PORT into appPort
// since prebuild features can't have their options changed at runtime
const template = `${portLabel}:${defaultPort}`;
appPort.push(template);
```

With `defaultPort = "2222"`, the result is:

```
appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"]
→ resolves to: ["22430:2222"]
```

Docker maps host port 22430 → container port 2222 (where sshd listens). The
container never knows about port 22430. This is the correct asymmetric pattern.

If wezterm were naively placed in the top-level `features` block, `injectForBlock()`
(the symmetric path) would inject `hostSshPort: "${lace.port(wezterm-server/hostSshPort)}"`,
the devcontainer CLI would pass `HOSTSSHPORT=22430` to `install.sh`, `install.sh`
would ignore it, and `generatePortEntries()` would produce `appPort: ["22430:22430"]`.
Docker would map 22430→22430 but sshd is on 2222: connections would fail silently.

## The Two Injection Paths in Detail

### Path 1: Top-level `features` — symmetric injection

`injectForBlock()` in `template-resolver.ts` (lines 189-222):

```typescript
(block[fullRef] as Record<string, unknown>)[optionName] =
  `\${lace.port(${shortId}/${optionName})}`;
```

The template is written into the **feature option value**. The devcontainer CLI
passes it as an env var to `install.sh`. The resolved port (e.g., `22435`) becomes
both the container-internal listening port (via `install.sh`) and the host port
(via `generatePortEntries` which produces `22435:22435`).

**Requirement**: `install.sh` MUST use the option value to configure the service.

### Path 2: `prebuildFeatures` — asymmetric injection

`injectForPrebuildBlock()` in `template-resolver.ts` (lines 224-267):

```typescript
const template = `${portLabel}:${defaultPort}`;
appPort.push(template);
config.appPort = appPort;
```

The template is written into **`appPort`**, not the feature option. The feature
option is ignored (its default value is the fixed container-internal port). The
resolved port is the host port only. Docker maps `<lace-allocated>:<default>`.

**Requirement**: the feature's service must already listen on `default` (the port
baked at prebuild time). The container never knows the host-allocated port.

## LacePortDeclaration Schema

From `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/feature-metadata.ts`:

```typescript
export interface LacePortDeclaration {
  label?: string;
  onAutoForward?: "silent" | "notify" | "openBrowser" | "openPreview" | "ignore";
  requireLocalPort?: boolean;
  protocol?: "http" | "https";
}
```

There is **no `containerPort` field**. The asymmetric mapping in the prebuild path
uses the feature's `options[optionName].default` value as the container-side port.
There is no way to declare a different container-internal port separate from the
option default in the current schema.

## Portless as a Prebuild Feature with Asymmetric Mapping

**Answer: Yes. Portless should use the prebuild path, matching wezterm-server.**

Placing portless in `customizations.lace.prebuildFeatures` with default `"1355"`:
- `injectForPrebuildBlock()` generates `appPort: ["22435:1355"]` (asymmetric)
- `install.sh` receives no `PROXYPORT` env var (it doesn't need one)
- The entrypoint starts `portless proxy` with no arguments — portless defaults to 1355
- No `PORTLESS_PORT` env var, no `/etc/profile.d/`, no `/etc/environment`
- Docker maps host 22435 → container 1355
- Port reassignment only changes the Docker mapping — no rebuild needed

The earlier version of this report argued this was "architecturally wrong" because "prebuild features are baked into the container image at build time" while "portless is a runtime service."
This reasoning was flawed — wezterm-mux-server is also a runtime service that starts via entrypoint.
The "prebuild" in prebuildFeatures refers to Docker image layering, not the service's runtime lifecycle.
Both wezterm and portless are installed at build time and started at runtime via entrypoints.

## Recommended Approach for Portless

Use the **prebuild features path** with **asymmetric injection**:

1. Declare `proxyPort` option with default `"1355"` in `devcontainer-feature.json`
2. Declare `customizations.lace.ports.proxyPort` for auto-injection
3. User places feature in `customizations.lace.prebuildFeatures`
4. `injectForPrebuildBlock()` generates `appPort: ["${lace.port(portless/proxyPort)}:1355"]`
5. Template resolution → `appPort: ["22435:1355"]`
6. `generatePortEntries()` adds `forwardPorts: [22435]` and `portsAttributes`
7. `install.sh` installs portless and generates entrypoint (no port plumbing)
8. Entrypoint starts `portless proxy` on default 1355
9. Docker maps host 22435 → container 1355 (asymmetric)

No build-time port baking.
No `PORTLESS_PORT` env var.
Port reassignment only changes the Docker mapping.

## Port Allocator Mechanics (Reference)

From `port-allocator.ts`:

- Allocation range: `22425–22499` (75 ports, "wez" mnemonic)
- Persistence: `.lace/port-assignments.json` in the workspace folder
- Reuse: existing assignment is reused if the port passes a TCP connect probe (available)
- Conflict: if the existing port is in use, a new one is found and assigned; the
  container must be rebuilt (since the port was baked into the container image)
- Labels: `featureShortId/optionName` (e.g., `portless/proxyPort`)

The stable reuse behavior means port reassignment is rare in practice. The typical
lifecycle is: lace allocates port 22435 on first `lace up`, persists it, reuses it
on every subsequent `lace up` as long as nothing else on the host claims 22435.

## Summary

| | Wezterm | Portless |
|---|---|---|
| Feature block | `customizations.lace.prebuildFeatures` | `customizations.lace.prebuildFeatures` |
| Injection type | Asymmetric (appPort only) | Asymmetric (appPort only) |
| Mapping produced | `22430:2222` | `22435:1355` |
| install.sh reads port option | No | No |
| Container-internal port | Always 2222 (sshd default) | Always 1355 (portless default) |
| Port baked in image | No | No |
| Port visible inside container | Not needed | Not needed |
| Port reassignment | Docker mapping change only | Docker mapping change only |

Portless follows the wezterm asymmetric pattern exactly.
