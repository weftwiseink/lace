---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T17:20:00-07:00
task_list: lace/prebuild-cache-rethink
type: proposal
state: archived
status: evolved
tags: [prebuild, empirical_test, upstream_cache, buildkit, validation, rfp_input, superseded]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-7"
  at: 2026-05-06T18:30:00-07:00
  round: 1
---

> WARN(opus/lace/prebuild-cache-rethink): **Superseded by a different (and successful) approach, 2026-05-12.**
> The BuildKit-based test in this proposal was empirically infeasible: `cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md` showed `chmod 1777 /tmp` cannot prevent `containers/buildah#6503` from re-corrupting `/tmp` at each feature install step on rootless podman; `cdocs/reports/2026-05-12-experiment-fuse-overlayfs-bypass.md` confirmed switching storage drivers does not help (the bug is in shared `containers/storage` Go code); `cdocs/reports/2026-05-12-podman-56-downgrade-cost-analysis.md` recommended against downgrading to 5.6.
>
> However, the legacy builder (`--buildkit never`, which lace already uses) is structurally immune to #6503 because it uses `COPY --from` rather than `RUN --mount=type=bind` for feature install. A focused follow-up experiment (`cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`) found that `devcontainer build --buildkit never` produces a usable local layer cache for back-to-back builds of weftwise: build 1 took 234s; build 2 took 16s; 15x speedup; all feature install scripts cached.
>
> **The migration path the BuildKit version of this proposal was attempting to test is therefore viable via the legacy builder.** See the successor proposal at [`cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md`](./2026-05-12-migrate-to-legacy-builder-cache.md), which elaborates the migration plan scoped to the author's constraint of "acceptable start times within one project on one machine, no remote registries needed."
>
> This proposal stays archived as historical context for the path not taken (upstream BuildKit cache, infeasible).
> The collision-bug fix (P1 / P2 in the options report) is now subsumed by the migration since deletion of `lace prebuild` removes the collision class entirely.

# Empirical Test: Can Upstream `BUILDKIT_INLINE_CACHE` + `build.cacheFrom` Replace Lace Prebuild?

> BLUF: This proposal defines a four-scenario empirical test that runs in roughly 90-120 minutes of wall time and ~40 minutes of supervised attention.
> It targets `~/code/weft/weftwise/main` — the project where the author originally observed the cache-busting behaviour, and the heavier of the two real lace projects (Electron + Playwright build steps in addition to the six-feature stack).
> It compares the current lace prebuild flow (control) against a plain `devcontainer up` flow that relies only on devcontainer-CLI 0.83.0's `BUILDKIT_INLINE_CACHE` plus `build.cacheFrom` against a localhost OCI registry (treatment).
> Pass: treatment is within 1.5x of control on warm and single-feature-change scenarios, and faster than control on the cross-project-collision scenario.
> Fail: treatment is slower than control by more than 1.5x on warm/single-change, or `--progress=plain` shows zero `CACHED` markers across runs (i.e., the cache never engaged).
> The test does not commit to deletion: it produces measurements the author can use to decide whether to delete `prebuildFeatures` and `lace prebuild` outright (RFP Bundle P_minimum/P5/P6), to keep them, or to take an intermediate path.
>
> NOTE(opus/lace/prebuild-cache-rethink): The author originally observed the problematic cache-busting via *VS Code's* Dev Containers extension. Rather than re-verify in VS Code at the end, the test plan instead captures VS Code's underlying `devcontainer` CLI invocation during preparation (Phase 1) and ensures the test's CLI commands match it. This neutralises the risk that the CLI test "passes" but VS Code's path does something materially different (e.g., a `--build-no-cache` flag we missed).
>
> NOTE(opus/lace/prebuild-cache-rethink): Scenario D has been split into D1 (per-project caches, mostly tautological by design) and D2 (shared cache, the load-bearing test for whether `BUILDKIT_INLINE_CACHE` handles divergent feature sets without poisoning).
>
> NOTE(opus/lace/prebuild-cache-rethink): The treatment Dockerfile applies `RUN chmod 1777 /tmp` before `apt-get` as a standard rootless-podman workaround for a known BuildKit issue. A parallel investigation report (`cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`) verifies whether this bug is real, current, and a podman-side issue.

## Objective

Test whether the cache-busting defect that motivated lace's custom prebuild mechanism (devcontainer-CLI issue #313, partially fixed in PR #382, fully addressed for feature paths only in 0.83.0's `BUILDKIT_INLINE_CACHE` integration) has been resolved upstream to the point that a vanilla `devcontainer up` with `build.cacheFrom` against a local registry performs comparably to lace's custom prebuild for the project author's actual workload.
The hypothesis is that `lace prebuild` is now obsolete; the test's job is to either confirm that empirically or surface a measurement that contradicts it.

## Background

- [`cdocs/reports/2026-05-06-devcontainer-features-actual-behavior.md`](../reports/2026-05-06-devcontainer-features-actual-behavior.md) - Web research showing the upstream cache-bust bug was real, was partially fixed in 2023, and got an explicit feature-path inline-cache fix in 0.83.0 (Jan 2026).
- [`cdocs/reports/2026-05-06-prebuild-original-rationale.md`](../reports/2026-05-06-prebuild-original-rationale.md) - The original prebuild rationale was unmeasured and asserted; there is no baseline to falsify against in the lace corpus.
- [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](./2026-05-05-rfp-rethink-prebuild-cache.md) - The RFP this proposal feeds; explicitly opens the design space including "drop prebuild entirely" (P6).
- [`cdocs/reports/2026-05-05-prebuild-cache-system-options.md`](../reports/2026-05-05-prebuild-cache-system-options.md) - The options report; recommends Lens 3 / Bundle P5 (runtime-install pivot) but flags first-start latency as the unmeasured tension.
- [`cdocs/reports/2026-05-05-prebuild-tag-collision-incident.md`](../reports/2026-05-05-prebuild-tag-collision-incident.md) - The incident; provides the timing baseline for Scenario D (whelm vs. weftwise collision: ~2m 17s wall, ~48s image rebuild, ~80s `podman run`).

## Hypothesis

> H1: For the weftwise project on the author's hardware, plain `devcontainer up` with `BUILDKIT_INLINE_CACHE=1` and `build.cacheFrom = ["localhost:5000/lace-empirical-test/weftwise-cache:latest"]` produces wall-clock times that are within 1.5x of the current `lace up` flow on warm and single-feature-change scenarios, and strictly faster than the current flow on the cross-project-collision scenario.

H1 is falsifiable: any scenario where treatment exceeds the 1.5x bound, or where `--progress=plain` output contains zero `CACHED` lines across two consecutive treatment runs, falsifies it.

Secondary hypothesis, reframed after the parallel bug investigation (`cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`) confirmed `containers/buildah#6503` is real and current:

> H2: The defensive `RUN chmod 1777 /tmp` workaround in `Dockerfile.test`, by itself, is sufficient to prevent the `/tmp` corruption bug from breaking `apt-get` during devcontainer feature install. With chmod applied, BuildKit-enabled `devcontainer build` (i.e., without lace's `--buildkit never` flag) completes successfully.

H2 is no longer "is the bug present" — the bug is confirmed present and active.
H2 is now "is the chmod workaround sufficient by itself" — verified by the pre-test side experiment at `cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md` BEFORE the main test runs.

If H2 holds (chmod alone suffices), the main test proceeds with confidence and lace can drop `--buildkit never` as a follow-up.
If H2 fails (chmod alone is not enough), the main test is still expected to succeed (the chmod plus what the devcontainer CLI does internally may combine), but lace's `--buildkit never` flag stays load-bearing.
If H2 cannot be falsified clearly (e.g., the bug doesn't reproduce in the side experiment on this host today), the main test still proceeds; the conclusion just reframes ("on this host the bug is dormant; cannot empirically verify whether chmod is necessary").

## Test Setup

### Environment

| Component | Value |
|---|---|
| Host | Aurora (Fedora 43, kernel 6.17.12-300.fc43.x86_64) |
| CPU | 12th Gen Intel Core i7-12700K (12c/20t) |
| RAM | 62 GiB total, ~35 GiB available at test time |
| Disk | LUKS-on-LVM, 1.9 TiB ext4, ~1.2 TiB free |
| Podman | 5.7.1 |
| Buildah | 1.42.2 |
| devcontainer CLI | 0.83.0 (`/var/home/linuxbrew/.linuxbrew/Cellar/devcontainer/0.83.0/`) |
| BuildKit availability | Not separately installed; podman uses buildah natively. BuildKit semantics in this test means `DOCKER_BUILDKIT=1` plus `BUILDKIT_INLINE_CACHE=1` build args, executed via `podman build` (which has BuildKit-style frontend support) or via `devcontainer up` without the `--buildkit never` override. |

Capture `podman version`, `devcontainer --version`, and `uname -a` into the artefact at the top of the run.

### Test Project

`~/code/weft/weftwise/main`.

Targeting weftwise rather than whelm for two reasons:

1. **Observed environment match.** The author first observed the cache-busting behaviour while running weftwise's devcontainer through VS Code. Reproducing on the same project keeps the test ecologically valid.
2. **Heavier workload.** weftwise's Dockerfile includes Playwright + Chromium download, Electron binary install, and a non-fatal `pnpm build:electron` step in addition to the six-feature stack. This makes cache effects more visible: a warm build that *doesn't* engage the cache will be obviously slow (multiple minutes), and a warm build that *does* will be obviously fast (tens of seconds).

weftwise's `.devcontainer/Dockerfile` (lines 1-134) and `.devcontainer/devcontainer.json` are the inputs.
The current `FROM` line is `lace.local/node:24-bookworm` (lace-rewritten); the original is `node:24-bookworm`.
The treatment must restore the original `FROM` and bypass lace entirely.

### Dockerfile-Specific Considerations for weftwise

The weftwise Dockerfile contains structural elements the test must account for explicitly.
Each is documented here so the test can reproduce it correctly in `Dockerfile.test` and isolate the cache-engagement question from confounding rebuild triggers.

| Concern | Source | Test handling |
|---|---|---|
| `FROM lace.local/node:24-bookworm` | line 2 | Rewrite to `FROM node:24-bookworm` in `Dockerfile.test`. The treatment must *not* depend on a prior `lace prebuild` run. |
| `build.context": ".."` | devcontainer.json line 13 | Preserve. Build context is the project root, not `.devcontainer/`. The treatment's devcontainer.test.json must use the same context. |
| **`RUN chmod 1777 /tmp` (defensive workaround, NOT in weftwise's current Dockerfile)** | new addition | **Insert before the apt-get layer in `Dockerfile.test`.** Documented in `cdocs/devlogs/2026-03-26-podman-buildkit-tmp-fix.md`: rootless podman's overlay driver corrupts `/tmp` permissions from `1777` to `755` when BuildKit's `RUN --mount=type=bind` mounts under `/tmp`, breaking `apt-get`'s GPG verification. The chmod restores the sticky bit before the apt-get layer reads from `/tmp`. Standard podman-rootless workaround; not lace-specific. See parallel investigation report `cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md` for upstream verification. |
| `apt-get install` with ~30 packages incl. Playwright + Electron deps | lines 25-55 | Keep verbatim. This layer is cache-cooperative; it should engage the cache cleanly under treatment. **V3 verification target: should show `CACHED` on warm runs.** |
| `mkdir -p /usr/local/share/npm-global && chown -R node:node /usr/local/share` | lines 65-66 | Keep verbatim. Lightweight; included for completeness. |
| `mkdir -p /workspaces /build && chown -R ${USERNAME}:${USERNAME} /workspaces /build` | lines 70-71 | Keep verbatim. The `/build` directory is weftwise-specific (Electron build sandbox); preserve it because line 73 (`WORKDIR /build`) depends on it. |
| `WORKDIR /build` | line 73 | Keep verbatim. The Electron install steps (lines 111-112, 114-115, 118-119) run with this WORKDIR; changing it would invalidate their layer hashes. |
| `RUN echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}` + chmod | lines 95-96 | Keep verbatim. Required by sshd feature install at runtime; orthogonal to cache test. |
| `USER ${USERNAME}` | line 99 | Keep verbatim. All subsequent RUN steps execute as `node`; this is part of the cache key for everything below. |
| `ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global` + `ENV PATH=...:/usr/local/share/npm-global/bin` | lines 102-103 | Keep verbatim. Env layers; cheap and cache-stable. |
| `RUN pnpm install electron@$ELECTRON_VERSION && node node_modules/electron/install.js` | lines 111-112 | Keep verbatim. Heavy download (~150 MB Electron binary). Cache-cooperative as long as `ELECTRON_VERSION` arg is unchanged. **Heavy enough that a cache miss here produces a clearly distinguishable wall-time signal. V3 verification target: this layer's `CACHED` vs. rebuild state is the load-bearing signal for "is the cache real."** |
| `RUN pnpm install playwright@$PLAYWRIGHT_VERSION && npx playwright install chromium` | lines 114-115 | Keep verbatim. ~110 MB Chromium download. Same cache-cooperative profile as Electron. **V3 verification target: same as Electron — the heavy download wall-time delta is the most legible cache-engagement signal.** |
| `COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./` + `pnpm install --frozen-lockfile` | lines 118-119 | Keep verbatim. Cache-busts when the lockfile changes; the test must assert `git status --porcelain` reports no changes to these three files between runs. |
| `COPY --chown=node:node . .` | line 125 | **Major cache-bust hotspot.** This layer copies the entire project source. Any uncommitted change in the working tree busts this layer and every layer after it. The test setup must assert `git diff --quiet && git diff --cached --quiet` (clean working tree) before each run; otherwise control and treatment may produce non-comparable timings due to source diff alone. |
| `RUN pnpm build:electron 2>&1 | tee /tmp/electron_build.log || (echo "WARNING..." && true)` | lines 129-130 | Keep verbatim. Non-fatal. Re-runs whenever `COPY . .` busts. The test should record this layer's wall time as a separate datum because it dominates fresh-cache scenarios. |
| `customizations.lace.workspace = { layout: bare-worktree, mountTarget: /workspaces/weftwise }` | devcontainer.json lines 56-59 | weftwise uses lace's bare-worktree layout. The treatment bypasses lace, so it must inject equivalent `workspaceMount` and `workspaceFolder` fields manually. See "Required `devcontainer.json` Changes" below for the synthesized values. |
| `customizations.lace.repoMounts` (clauthier) | devcontainer.json lines 75-77 | Drop in the treatment. The test does not exercise repo mounts; this is out of scope. |
| `customizations.lace.validate` (ssh key file existence) | devcontainer.json lines 78-86 | Drop in the treatment. Validation is a lace concern, not a cache concern. |
| `customizations.vscode.extensions` (~10 extensions) | devcontainer.json lines 21-33 | Keep optionally. Extension install is post-build and does not affect feature-cache measurement; keeping them produces a more realistic VS Code reopen timing in the optional confirmation step but adds noise to CLI timings. The test plan keeps them in the treatment config and excludes their install time from the comparison. |
| `containerEnv.CLAUDE_CONFIG_DIR = "${lace.mount(claude-code/config).target}"` | devcontainer.json line 109 | **Lace template syntax.** The treatment cannot resolve this without lace. Replace with the literal path the claude-code feature exposes (`/home/node/.claude`). |

The principle: `Dockerfile.test` preserves the layer structure of the original Dockerfile so that cache-engagement signals are visible against weftwise's actual workload.
The treatment's `devcontainer.test.json` strips lace-specific orchestration but keeps everything that affects feature install timing.

### Feature Set

weftwise's `prebuildFeatures` (devcontainer.json lines 87-94) is six features.
For the treatment, these are moved to top-level `features`:

```jsonc
"features": {
  "ghcr.io/devcontainers/features/git:1": { "version": "latest" },
  "ghcr.io/devcontainers/features/sshd:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/neovim:1": {},
  "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
}
```

This matches weftwise's prebuildFeatures verbatim.
The first two are upstream `devcontainers/features`; the next three are weftwise-published features the author actually consumes; the last is `eitsupi/nushell`.
weftwise gets `node` from the base image (`FROM node:24-bookworm`), not from a feature, so the upstream `devcontainers/features/node:1` is intentionally not added.

> NOTE(opus/lace/prebuild-cache-rethink): wezterm-server is the feature flagged in the source-analysis report (`cdocs/reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md`) as the one entanglement that uses the asymmetric prebuild-features-to-appPort injection path. For this test, the wezterm-server feature is included in the feature set so the cache mechanics are tested under the actual workload, but the treatment config does *not* attempt to reproduce the appPort injection — it sets a static `appPort` if needed, mirroring what a post-deletion lace would do.

### Registry Choice

A localhost OCI registry started for the test:

```sh
podman run -d --name lace-test-registry -p 5000:5000 docker.io/library/registry:2
```

Rationale:

- `BUILDKIT_INLINE_CACHE` and `build.cacheFrom` are designed around registry semantics; an OCI registry is the simplest implementation that satisfies the mechanism.
- A local registry is reproducible and disposable: `podman rm -f lace-test-registry` cleans up entirely.
- Alternatives considered: a content-addressed local OCI layout under `~/.cache/` would avoid a process, but `devcontainer build --cache-to type=local,dest=...` interactions with `cacheFrom` are less battle-tested than registry-backed cache and would make a negative result harder to interpret. Registry choice keeps "did the mechanism work?" decoupled from "did we configure a niche backend right?"
- Registry runs on `localhost:5000`; insecure-registry config is required (see Phase 1 setup).

### Cache Image Path

`localhost:5000/lace-empirical-test/weftwise-cache:latest` for the primary cache image.
For Scenario D1 (per-project caches), the synthetic projectB uses `localhost:5000/lace-empirical-test/projectB-cache:latest`.
For Scenario D2 (shared cache), both weftwise and synthetic projectB use `localhost:5000/lace-empirical-test/shared-cache:latest`.

### Working-Tree Cleanliness Precondition

Before any run, in `~/code/weft/weftwise/main`:

```sh
test -z "$(git status --porcelain)" || { echo "DIRTY working tree; abort"; exit 1; }
```

If the working tree is dirty, the `COPY . .` layer at Dockerfile line 125 will produce different content hashes between control and treatment, and the timings will not be comparable.
The author should commit, stash, or `git stash --include-untracked` any in-flight work before starting Phase 2.
Test files (`Dockerfile.test`, `devcontainer.test.json`) should be created in `.devcontainer/` and the test should run from that committed state, restoring after.

## Control: Current Lace Flow

The control measures `lace up` as it ships today, with the existing `prebuildFeatures` set in weftwise's `.devcontainer/devcontainer.json`.

### Commands

```sh
# Reset state for cold scenarios
podman rmi -f lace.local/node:24-bookworm 2>/dev/null
podman rmi -f $(podman images -q "localhost/vsc-weftwise-*") 2>/dev/null
rm -rf "$HOME/code/weft/weftwise/main/.lace/prebuild"

# Run with timing
cd "$HOME/code/weft/weftwise/main"
/usr/bin/time -v lace up 2>&1 | tee /tmp/lace-test/control-{scenario}.log
```

### Timings to Capture

From the lace log at `.lace/logs/<latest>.log` and `/usr/bin/time -v` output:

- Total wall time (`Elapsed (wall clock) time` from `time -v`).
- `lace prebuild` phase duration (parse from the log "Building prebuild image" to "Prebuild complete").
- `devcontainer up` phase duration (LACE_RESULT timestamps minus prebuild end).
- Image build time inside `devcontainer up` (from the `[N/M]` step markers if visible).
- First `podman run` time vs. attached `postCreateCommand` time (postCreateCommand starts after devcontainer reports the container is created).

### Expected Results

Based on the 2026-05-05 incident log and the 2026-05-06 successful rebuild run, scaled for weftwise's heavier Dockerfile (Electron + Playwright add ~60-90s of download on cold layers vs. whelm's lighter setup):

| Scenario | Expected wall time |
|---|---|
| A: cold (no cache, no images) | ~5-7 min: ~90s prebuild (full feature install) + ~3-4 min workspace image build (Electron + Playwright + pnpm install + COPY . . + build:electron) + ~30s container start + postCreate. |
| B: warm (no changes) | ~5-15s: lace pipeline (~5s) + `devcontainer up` short-circuit on existing container. |
| C: single feature changed | ~2-3 min: lace prebuild rebuilds (most layers cached by feature install order), workspace image rebuilds (likely re-running Electron build since FROM layer changed). |
| D: cross-project collision | ~3-5 min: rebuild from scratch on shared-tag overwrite. |

Numbers are estimates from the corpus, not measurements; the test's job is to replace them.

## Treatment: Upstream-Cache-Only Flow

The treatment removes `prebuildFeatures` from `customizations.lace` and adds the same features to top-level `features`, with `build.cacheFrom` populated.

### Required `devcontainer.json` Changes

Create `~/code/weft/weftwise/main/.devcontainer/devcontainer.test.json` (do not modify the original; the original is restored simply by deleting the test file):

```jsonc
{
  "name": "weftwise-test",
  "build": {
    "dockerfile": "Dockerfile.test",
    "context": "..",
    "cacheFrom": ["localhost:5000/lace-empirical-test/weftwise-cache:latest"],
    "args": {
      "BUILDKIT_INLINE_CACHE": "1",
      "TZ": "America/Los_Angeles",
      "USERNAME": "node"
    }
  },
  "remoteUser": "node",
  // Synthesize bare-worktree workspace layout that lace would normally inject from
  // customizations.lace.workspace = { layout: bare-worktree, mountTarget: /workspaces/weftwise }.
  // The test bypasses lace, so these must be set explicitly. Source: 2026-05-06-prebuildfeatures-removal-impact-analysis.md
  // confirms workspace handling is prebuild-agnostic; replicating it here just avoids relying on lace.
  "workspaceMount": "type=bind,source=${localWorkspaceFolder},target=/workspaces/weftwise/main",
  "workspaceFolder": "/workspaces/weftwise/main",
  "features": {
    "ghcr.io/devcontainers/features/git:1": { "version": "latest" },
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/neovim:1": {},
    "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
  },
  "containerEnv": {
    "NODE_OPTIONS": "--max-old-space-size=4096",
    // Replace `${lace.mount(claude-code/config).target}` with the literal path
    // the claude-code feature exposes. Source: weftwise's running container shows
    // claude-code mounts at /home/node/.claude.
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  }
}
```

Create `~/code/weft/weftwise/main/.devcontainer/Dockerfile.test` as a copy of the existing `.devcontainer/Dockerfile` with **two** changes:

```dockerfile
# Change 1: Was `FROM lace.local/node:24-bookworm` (line 2); restore the original FROM.
FROM node:24-bookworm

# ... (ARGs and ENVs preserved verbatim, lines 4-15) ...

# Change 2: NEW LINE inserted before the apt-get layer (line 25 in the original).
# Standard rootless-podman workaround for the BuildKit /tmp corruption bug.
# See cdocs/devlogs/2026-03-26-podman-buildkit-tmp-fix.md and the parallel investigation
# report at cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md.
RUN chmod 1777 /tmp

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ...
```

Everything else in the Dockerfile is preserved unchanged: the apt-get install of system + Playwright deps (lines 25-55), corepack pnpm install (lines 61-62), git-delta install (lines 76-79), passwordless sudo (lines 95-96), `USER node` switch (line 99), npm env vars (lines 102-103), `RUN pnpm install electron@$VERSION` + `node node_modules/electron/install.js` (lines 111-112), Playwright + Chromium install (lines 114-115), the `COPY` layers (lines 118, 125), and the non-fatal `pnpm build:electron` (lines 129-130).

The reason for preserving the structure: the cache-engagement question is about whether `BUILDKIT_INLINE_CACHE` reuses *real* layers under weftwise's actual workload, not about whether a stripped-down Dockerfile caches.

> NOTE(opus/lace/prebuild-cache-rethink): The `chmod 1777 /tmp` insertion is itself a finding worth flagging. It is one line, applied at the top of any user's Dockerfile, and unblocks BuildKit + feature install on rootless podman. If the empirical test passes and lace moves to delete `prebuildFeatures`, lace should either inject this line automatically into user Dockerfiles (one option) or document it prominently as "the one-line podman setup step every user needs." The chmod was not in lace's project-level guidance prior to this proposal; the test plan surfaces it.

### Commands

```sh
# Reset
podman rmi -f $(podman images -q "vsc-weftwise-test-*") 2>/dev/null
podman rmi -f localhost:5000/lace-empirical-test/weftwise-cache 2>/dev/null

# Cold run with cache export
cd "$HOME/code/weft/weftwise/main"
DOCKER_BUILDKIT=1 /usr/bin/time -v devcontainer up \
  --workspace-folder . \
  --config .devcontainer/devcontainer.test.json \
  --docker-path "$(which podman)" \
  --build-no-cache=false \
  --cache-to "type=registry,ref=localhost:5000/lace-empirical-test/weftwise-cache:latest,mode=max" \
  2>&1 | tee /tmp/lace-test/treatment-{scenario}.log

# After cold run, push the workspace image to seed the cache image:
podman tag <built-image-sha> localhost:5000/lace-empirical-test/weftwise-cache:latest
podman push --tls-verify=false localhost:5000/lace-empirical-test/weftwise-cache:latest
```

> NOTE(opus/lace/prebuild-cache-rethink): The exact `--cache-to`/`--cache-from` flag syntax depends on whether `devcontainer up` 0.83.0 forwards them to `podman build` or whether they need to be set via `BUILDKIT_INLINE_CACHE` build args + `cacheFrom` in `devcontainer.json` only. The first treatment run should verify which path the CLI takes by inspecting `--progress=plain` output. If `devcontainer up` does not forward `--cache-to`, the workaround is a manual `podman tag` + `podman push` after the build.

### Undo After the Test

```sh
rm "$HOME/code/weft/weftwise/main/.devcontainer/devcontainer.test.json"
rm "$HOME/code/weft/weftwise/main/.devcontainer/Dockerfile.test"
rm -rf /tmp/lace-test-projectB
podman rm -f lace-test-registry
podman rmi -f $(podman images -q "vsc-weftwise-test-*")
podman rmi -f $(podman images -q "vsc-projectB-test-*") 2>/dev/null
podman rmi -f localhost:5000/lace-empirical-test/weftwise-cache
podman rmi -f localhost:5000/lace-empirical-test/projectB-cache 2>/dev/null
podman rmi -f localhost:5000/lace-empirical-test/shared-cache 2>/dev/null
```

The original weftwise config is untouched (only test files are added in `.devcontainer/`).
whelm is read for control measurements only; nothing in whelm is modified.

### Timings to Capture

Same five timings as control (wall, prebuild-equivalent, image build, container start, postCreate).
For treatment, "prebuild-equivalent" means the time from `devcontainer up` start to "image built" (no separate phase).

### Expected Results

Scaled for weftwise's heavier Dockerfile:

| Scenario | Expected wall time (theory) |
|---|---|
| A: cold | Comparable to control cold (~5-7 min); both have no cache to use. Treatment may be slightly slower because lace's prebuild-then-up split is replaced by a single longer pipeline. |
| B: warm | Fast (~15-45s) if `BUILDKIT_INLINE_CACHE` engages: most layers `CACHED` including Electron + Playwright + COPY + build:electron, only metadata refresh and feature-install-script idempotence checks. Slow (~5-7 min) if it does not. |
| C: single feature changed | ~60-90s if cache reuses up to the changed feature's layer (PR #382 measured ~32s on a much lighter Dockerfile); ~3-5 min if cache does not engage past the changed feature. |
| D: cross-project collision | Treatment uses a per-project cache image, so there is no collision; expected ~30-60s if cache works, full rebuild (~5-7 min) if not. |

## Scenarios

Each scenario runs both control and treatment.
Record before/after state (`podman images`, `podman ps -a`, `podman volume ls`).

### Scenario A: Cold Start, No Cache

> BLUF: Worst-case path; both control and treatment should be slow; the question is "is treatment dramatically slower than control?"

Setup:

```sh
podman system prune -a -f --volumes  # full reset
rm -rf "$HOME/code/weft/weftwise/main/.lace/prebuild"
```

Run (in `~/code/weft/weftwise/main`):

1. Control: `lace up`. Record wall time.
2. Reset (same prune).
3. Treatment: `devcontainer up --config .devcontainer/devcontainer.test.json`. Record wall time.

Record: total wall, image build wall, feature install wall (parse from progress output), Electron + Playwright download wall (separate datum), `pnpm build:electron` wall, container start wall.

### Scenario B: Warm Start, Unchanged Config

> BLUF: The most user-visible scenario; this is what the author hits 90% of the time. **This is the load-bearing scenario for the "delete prebuild" decision.**

Setup:

```sh
# Both prior runs (Scenario A) leave their respective caches populated.
# Stop the containers but keep images.
podman ps --filter "name=weftwise" -q | xargs -r podman stop
```

Run (in `~/code/weft/weftwise/main`):

1. Control: `lace up`. Record wall time.
2. Treatment: `devcontainer up --config .devcontainer/devcontainer.test.json`. Record wall time.

Verify in the output that `--progress=plain` shows `CACHED` markers across the heavy layers (Electron, Playwright, `pnpm install`, `COPY . .`, `pnpm build:electron`).

Record: total wall, count of `CACHED` lines in build output, count of feature install lines, whether Electron + Playwright re-downloaded.

### Scenario C: Single Feature Change

> BLUF: The "I added one tool" workflow; tests whether the cache reuses layers up to the changed feature.

Setup:

Edit one feature's options in both configs to force a cache miss on that feature only.
Pick `nushell:0` (a small download, ~10s install) so the test focuses on cache reuse rather than feature install cost.

```jsonc
// In both weftwise/.devcontainer/devcontainer.json prebuildFeatures, and in devcontainer.test.json features:
"ghcr.io/eitsupi/devcontainer-features/nushell:0": { "version": "latest" }  // was {}
```

Run (after Scenario B leaves caches populated):

1. Control: `lace up`. Record wall.
2. Treatment: `devcontainer up --config .devcontainer/devcontainer.test.json`. Record wall.

Record: total wall, which features rebuilt vs. cached (from `--progress=plain`), whether the post-feature Electron + build:electron layers re-ran (they should *not* if the feature install order places nushell after the heavy layers).

> NOTE(opus/lace/prebuild-cache-rethink): The `installsAfter` ordering in the spec means changing `nushell` may invalidate every feature installed after it AND every Dockerfile layer that follows the feature install (in weftwise's case: nothing, since features run after the FROM-line bake). Record the count of features that rebuilt as a separate datum from total wall.

### Scenario D1: Cross-Project Collision (per-project cache images)

> BLUF: Tests whether treatment with per-project cache images eliminates the collision class. The result is largely tautological by design — per-project caches *cannot* collide — but the timings still tell us the absolute cost (or lack thereof) of "switching projects."

Setup:

The second project for D1 is **a synthetic minimal fixture** at `/tmp/lace-test-projectB/`, not whelm.
whelm's project-level prebuildFeatures are `lace-fundamentals + ./features/sprack` (both lace-specific); the treatment side bypasses lace, so those can't be tested.
A synthetic fixture is the cleanest way to produce a genuine layer-chain divergence:

```sh
mkdir -p /tmp/lace-test-projectB/.devcontainer
cat > /tmp/lace-test-projectB/.devcontainer/devcontainer.test.json <<'EOF'
{
  "name": "projectB-test",
  "build": {
    "dockerfile": "Dockerfile.test",
    "context": ".",
    "cacheFrom": ["localhost:5000/lace-empirical-test/projectB-cache:latest"],
    "args": {
      "BUILDKIT_INLINE_CACHE": "1",
      "TZ": "America/Los_Angeles",
      "USERNAME": "node"
    }
  },
  "remoteUser": "node",
  "workspaceMount": "type=bind,source=${localWorkspaceFolder},target=/workspaces/projectB",
  "workspaceFolder": "/workspaces/projectB",
  "features": {
    "ghcr.io/devcontainers/features/git:1": { "version": "latest" },
    "ghcr.io/devcontainers/features/sshd:1": {}
  }
}
EOF

cat > /tmp/lace-test-projectB/.devcontainer/Dockerfile.test <<'EOF'
FROM node:24-bookworm
ARG TZ
ARG USERNAME=node
ENV TZ="$TZ"
ENV DEVCONTAINER=true
RUN chmod 1777 /tmp
RUN apt-get update && apt-get install -y git curl sudo && rm -rf /var/lib/apt/lists/*
RUN echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} && chmod 0440 /etc/sudoers.d/${USERNAME}
USER ${USERNAME}
WORKDIR /workspaces
EOF
```

projectB intentionally has just **two features** (`git`, `sshd`) against the same `FROM node:24-bookworm`.
This produces a genuine collision-shape: weftwise has six features ending in feature-install layers that projectB doesn't have; projectB has two features that are a strict subset, but the layer chain diverges in install order (weftwise's `installsAfter` ordering will be different).

For control side D1, the equivalent is the original whelm project: weftwise and whelm share `FROM node:24-bookworm` (after lace's rewrite) and their prebuildFeatures sets differ (six vs two-plus-lace-specifics), reproducing the original 2026-05-05 incident shape.

Cache images:
- weftwise treatment: `localhost:5000/lace-empirical-test/weftwise-cache:latest`
- projectB treatment: `localhost:5000/lace-empirical-test/projectB-cache:latest`

Run (start from Scenario B's warm state for weftwise):

1. Control, project A (weftwise): `lace up` in `~/code/weft/weftwise/main`. Record wall.
2. Control, project B (whelm): `lace up` in `~/code/apps/whelm`. Record wall.
3. Control, back to project A (weftwise): `lace up`. Record wall.
   This is the failure case: in the current scheme, step 3 must rebuild because step 2 overwrote the shared `lace.local/node:24-bookworm` tag.
4. Treatment, project A (weftwise) using weftwise-cache: `devcontainer up`. Record wall.
5. Treatment, project B (synthetic projectB) using projectB-cache: `devcontainer up --workspace-folder /tmp/lace-test-projectB --config /tmp/lace-test-projectB/.devcontainer/devcontainer.test.json`. Record wall.
6. Treatment, back to project A (weftwise) using weftwise-cache: `devcontainer up`. Record wall.
   In the treatment scheme, step 6 should be fast: weftwise-cache is untouched by step 5.

Record: wall time per step. The diagnostic measurement is `step 3 wall - step 1 wall` (control thrash cost) vs. `step 6 wall - step 4 wall` (treatment thrash cost; should be near-zero by construction).

> NOTE(opus/lace/prebuild-cache-rethink): D1 mostly confirms a design statement, not an empirical claim — per-project cache images cannot collide by construction. The reviewer flagged this as "between unlike mechanisms." D1 is kept because the absolute thrash-cost numbers are still informative (e.g., even if treatment thrash is zero by design, the *baseline rebuild cost* of switching projects is worth measuring). The genuine empirical question lives in D2.

### Scenario D2: Shared-Cache Treatment (the real cache-mechanism question)

> BLUF: Tests whether `BUILDKIT_INLINE_CACHE` handles divergent feature sets gracefully when both projects share a single cache image. This is the load-bearing test for whether *content-addressed* cache reuse actually works upstream, and answers "can we get the cross-project sharing benefit of the current scheme without the collision?"

Setup:

Both weftwise and the synthetic projectB use the **same** cache image: `localhost:5000/lace-empirical-test/shared-cache:latest`.
Modify the `cacheFrom` field in both treatment configs:

```jsonc
// In weftwise/.devcontainer/devcontainer.test.json:
"cacheFrom": ["localhost:5000/lace-empirical-test/shared-cache:latest"]
// Same change in /tmp/lace-test-projectB/.devcontainer/devcontainer.test.json
```

Also set `--cache-to` on each build to push to the shared image.

Run (start from a clean cache state for the shared-cache image):

```sh
podman rmi -f localhost:5000/lace-empirical-test/shared-cache 2>/dev/null
# Reset registry by clearing /var/lib/registry/docker/registry/v2/repositories/lace-empirical-test/shared-cache in the registry container
podman exec lace-test-registry rm -rf /var/lib/registry/docker/registry/v2/repositories/lace-empirical-test/shared-cache 2>/dev/null
```

1. Treatment, project A (weftwise) cold, seeding shared-cache: `devcontainer up` with `--cache-to type=registry,ref=localhost:5000/lace-empirical-test/shared-cache:latest,mode=max`. Record wall and the V3 `CACHED` count (should be ~0).
2. Treatment, project B (synthetic projectB) using shared-cache: `devcontainer up` with same `--cache-to`. Record wall. **This is the load-bearing measurement:** if BUILDKIT_INLINE_CACHE works for divergent feature sets sharing a cache, projectB should reuse the base + apt + node layers (~all the heavy ones up to feature install), and only diverge at the feature install steps. Expected: substantially faster than projectB cold from scratch.
3. Treatment, project A (weftwise) re-run using shared-cache: `devcontainer up`. Record wall and V3 count. **This is the OTHER load-bearing measurement:** in the control's analogous case, project B's push overwrote project A's tag and forced a rebuild. Does BUILDKIT_INLINE_CACHE preserve A's cache hints in the registry blob store even after B's push, or does B's push "pollute" the cache from A's perspective?

Three possible outcomes for step 3:
- **Cache holds**: A's re-run is fast, comparable to Scenario B warm. BUILDKIT_INLINE_CACHE is content-addressed enough that B's push didn't invalidate A. *This is the optimal outcome: shared caching works.*
- **Partial cache**: A's re-run reuses some layers but rebuilds others. The cache hints in the registry favor B's manifest; A only retrieves shared blobs.
- **Cache poisoned**: A's re-run is comparable to A's cold run. B's push effectively overwrote A's cache hints, reproducing the collision class under a different mechanism. *This would be a strong signal that per-project caches are the only correctness-safe option.*

Record: wall per step, V3 `CACHED` count per step, blob store size in the registry (`podman exec lace-test-registry du -sh /var/lib/registry`).

> NOTE(opus/lace/prebuild-cache-rethink): D2 is the actual question we want to answer. D1 is a sanity check that per-project caches are isolated; D2 is whether shared caches can replicate the *intended* benefit of the current scheme (cross-project layer sharing) without its bug.

## Cache-Engagement Verification

Three verifications, each with example expected output:

### V1: BuildKit is actually engaged

```sh
DOCKER_BUILDKIT=1 podman build --progress=plain -f .devcontainer/Dockerfile.test \
  --cache-from localhost:5000/lace-empirical-test/weftwise-cache:latest \
  -t weftwise-test:probe . 2>&1 | head -30
```

Expected output contains lines like:
```
#5 [internal] load metadata for docker.io/library/node:24-bookworm
#5 ... CACHED
```

If output does *not* contain `[internal]` or `CACHED` markers, BuildKit is not engaged and the test is invalid.
If output is the legacy `STEP 1/19: ...` format, BuildKit is not engaged.

### V2: Cache image is being read

```sh
podman pull --tls-verify=false localhost:5000/lace-empirical-test/weftwise-cache:latest
podman inspect localhost:5000/lace-empirical-test/weftwise-cache:latest \
  --format '{{json .Config.Labels}}' | jq .
```

Expected: a non-empty `Labels` map including `BUILDKIT_INLINE_CACHE` markers or `containerd.io/snapshot/...` annotations indicating the image was built with inline cache export.

### V3: Cache hits show up in build output

```sh
DOCKER_BUILDKIT=1 podman build --progress=plain ... 2>&1 | grep -c "CACHED"
```

Expected for warm Scenario B: a number close to the total step count (e.g., 25-30 CACHED lines for weftwise's Dockerfile, which has ~16 RUN steps + Electron/Playwright/COPY/build:electron + 6 features = ~30+ total steps).
A count of 0 means cache did not engage.
A count between 1 and 5 means partial engagement; investigate which step invalidated the chain.

### V4: Image history shows feature layers

```sh
podman history $(podman images -q "vsc-weftwise-test-*" | head -1) | head -30
```

Expected: layers labelled with feature install commands (`COPY --from=...` for feature content, `RUN /tmp/dev-container-features/...`).

## Failure Modes to Watch For

Each entry has the observable signal that flags it.

### F1: BuildKit `/tmp` corruption (the lace `--buildkit never` workaround case)

**Signal:** `apt-get update` fails with `gpg: failed to start the dirmngr` or `Permission denied` on `/tmp/apt-key-gpghome.*`. Specifically the bug at `up.ts:1308-1311` describes `RUN --mount=type=bind` corrupting `/tmp` from `1777` to `755`.
**Action if seen:** H2 is falsified for this host. The treatment cannot run with BuildKit, which means upstream `BUILDKIT_INLINE_CACHE` is unavailable and the test is *infeasible* (not failed). Document and stop.
**Mitigation to try first:** disable any `RUN --mount=type=bind` in feature install scripts (likely none in the chosen feature set; verify with `podman build --progress=plain` output).

### F2: `--buildkit never` propagation

**Signal:** `devcontainer up` 0.83.0 might still pass `--buildkit never` if it detects podman, defeating the test. Check with `podman ps --format '{{.Command}}'` during a build, or `set -x` on a wrapper script around `podman`.
**Action:** if `devcontainer up` is forcing `never`, run the build manually via `podman build` with explicit BuildKit flags. The test then measures `podman build` time + manual feature install, not `devcontainer up`. This makes the test less ecologically valid but still answers H1.

### F3: `installsAfter` reordering invalidating cache between runs

**Signal:** Scenario B (warm, no changes) shows few `CACHED` markers. Diff the `--progress=plain` output between two consecutive identical runs; if the step order differs, ordering is non-deterministic.
**Action:** record as a finding. This would be a fundamental obstacle to upstream caching working: even with `BUILDKIT_INLINE_CACHE`, non-deterministic ordering invalidates layers.

### F4: Podman vs. Docker semantic differences

**Signal:** `cacheFrom` works differently in podman than in docker; specifically podman may not accept `type=registry,mode=max` syntax. Check stderr for "unknown flag" or "unsupported cache type."
**Action:** fall back to inline cache only (`BUILDKIT_INLINE_CACHE=1` build arg, no `--cache-to` flag, then `podman push` after build).

### F5: Insecure registry configuration

**Signal:** `podman push` to `localhost:5000` fails with TLS errors.
**Action:** add `[[registry]] location = "localhost:5000"` with `insecure = true` to `~/.config/containers/registries.conf` for the duration of the test.

### F6: Feature install scripts that genuinely re-run regardless of cache

**Signal:** Even with `CACHED` markers visible, total wall time on warm runs does not decrease. Look for feature install scripts that include `Date.now()` analogues, e.g., `RUN curl ... | sha256sum | tee /tmp/check-$(date +%s)`.
**Action:** identify the culprit feature and exclude it from the test. Note in the artefact.

## Success and Failure Criteria

Time budgets per scenario.
Treatment is "comparable" if within 1.5x of control; "fast" if better than control; "slow" if worse than 1.5x.

| Scenario | Control budget (target) | Treatment must be ≤ | Treatment ideal |
|---|---|---|---|
| A: cold | 7 min | 10.5 min (1.5x) | within 60s of control |
| B: warm | 30s | 45s (1.5x) | within 10s of control (i.e., near-zero `devcontainer up` work despite the heavy weftwise Dockerfile) |
| C: single feature change | 3 min | 4.5 min (1.5x) | < control (cache reuses more than lace's monolithic prebuild) |
| D1: per-project (step 6 - step 4) | step 3 - step 1 (control thrash) | < step 3 - step 1 | step 6 ≈ step 4 (cache untouched, by construction) |
| D2: shared cache, step 3 (A re-run after B push) | n/a (no control analogue) | < 2x of D2 step 1 (cold weftwise) | ≈ D2 step 1 (B's push didn't pollute A's cache) |

### Pass criteria (all must hold)

- B is within budget (treatment within 1.5x of control on warm).
- C is within budget (treatment within 1.5x of control on single-feature-change).
- D1: treatment thrash strictly less than control thrash (expected to hold by construction; failure here indicates a deeper issue).
- **D2: step 3 (weftwise re-run after projectB push) is comparable to step 1 (weftwise cold). If shared cache is genuinely content-addressed, B's push should not invalidate A's layers.**
- V3 confirms `CACHED` count > 0 in at least Scenarios B, C, and D2 step 2.

### Fail criteria (any one falsifies H1)

- B exceeds 1.5x control.
- C exceeds 1.5x control.
- D1 treatment thrash >= control thrash.
- **D2 step 3 is comparable to D2 step 1 cold (cache was poisoned by B's push). This would mean shared-cache caching reproduces the collision class under a different mechanism — the conclusion would shift from "delete prebuild and use shared cache" to "delete prebuild but require per-project caches for correctness."**
- V3 shows zero `CACHED` markers across two consecutive treatment warm runs.

### Infeasible criteria

- F1 (`/tmp` corruption) reproduces. H2 is falsified; the test cannot run; lace's `--buildkit never` is still load-bearing for podman users.

## Output Artefact

A markdown file `cdocs/reports/2026-05-XX-empirical-test-upstream-feature-cache-results.md` with the following structure:

```markdown
---
first_authored: ...
type: report
state: live
status: review_ready
tags: [prebuild, empirical_test, upstream_cache, validation]
---

# Empirical Test Results: Upstream Feature Cache vs. Lace Prebuild

> BLUF: <pass | fail | infeasible>. Treatment <was|was not> within budget on <list>.

## Environment Captured
- podman: ...
- devcontainer CLI: ...
- buildah: ...
- cpu/ram: ...

## Verification Results
| Check | Result | Notes |
|---|---|---|
| V1 BuildKit engaged | <yes|no> | <output excerpt> |
| V2 cache image written | <yes|no> | <inspect output> |
| V3 CACHED count | <N> on B, <M> on C | |
| V4 layer history | <ok|missing> | |

## Timings
| Scenario | Control wall | Treatment wall | Ratio | Pass? |
|---|---|---|---|---|
| A cold | <fill> | <fill> | <ratio> | <yes/no> |
| B warm | <fill> | <fill> | <ratio> | <yes/no> |
| C 1-feat | <fill> | <fill> | <ratio> | <yes/no> |
| D1 step 3-1 (control thrash) | <fill> | n/a | | |
| D1 step 6-4 (treatment thrash) | n/a | <fill> | | <yes/no> |
| D2 step 1 (weftwise cold, shared cache) | n/a | <fill> | | |
| D2 step 2 (projectB shared cache) | n/a | <fill> | | <yes/no — should be substantially < projectB cold from scratch> |
| D2 step 3 (weftwise re-run after projectB push) | n/a | <fill> | <ratio vs D2 step 1> | <yes/no — should be ≈ D2 step 1> |

## Failure Modes Observed
- <F1/F2/F3/F4/F5/F6 if any>

## Verdict
<H1 confirmed | H1 falsified | infeasible>. <One paragraph implication for the RFP.>

## Raw Logs
- /tmp/lace-test/control-{A,B,C,D}.log
- /tmp/lace-test/treatment-{A,B,C,D}.log
```

The author can paste the table directly into the RFP discussion or into a follow-up devlog.

## Out of Scope

- **Long-term cache hygiene.** This test runs ~90 minutes; it does not exercise cache eviction, GC, or registry growth over weeks of use.
- **Multi-machine cache sharing.** The localhost registry is a stand-in for "cache works at all"; cross-machine cache (push to GHCR, pull on a second laptop) is a separate question.
- **Feature install correctness.** The test measures *speed*. It does not verify that all feature install scripts behave identically when invoked via `devcontainer up` vs. via lace's prebuild rewrite path.
- **lace-fundamentals and other lace-specific features.** These are intentionally excluded; their behaviour under upstream-cache-only is a separate question, addressable only after the generic-feature-set question is settled.
- **Network-cold scenarios.** The test assumes feature OCI artefacts are in podman's blob cache from prior pulls; a true network-cold scenario would dwarf cache effects with download time.
- **postCreateCommand timings.** These are post-build and are equivalent in both control and treatment, so they are recorded but not part of the pass/fail decision.

## Implementation Phases

### Phase 1: Preparation (~25 min)

1. Verify the working tree is clean in both projects:
   ```sh
   for d in "$HOME/code/weft/weftwise/main" "$HOME/code/apps/whelm"; do
     cd "$d" && test -z "$(git status --porcelain)" || echo "DIRTY: $d"
   done
   ```
   Stash or commit any uncommitted changes before proceeding.
2. Verify environment versions; capture `podman version`, `devcontainer --version`, `buildah --version`, `uname -a` to `/tmp/lace-test/env.txt`.
3. Configure insecure registry in `~/.config/containers/registries.conf`.
4. Start localhost registry: `podman run -d --name lace-test-registry -p 5000:5000 docker.io/library/registry:2`.
5. Create `/tmp/lace-test/` directory for logs.
6. Create `Dockerfile.test` (with `chmod 1777 /tmp` workaround applied) and `devcontainer.test.json` in weftwise (primary target). Per the "Dockerfile-Specific Considerations for weftwise" table, ensure all the structural elements are preserved.
7. Create synthetic minimal projectB at `/tmp/lace-test-projectB/` for Scenario D1 treatment side (git + sshd features, FROM node:24-bookworm, with chmod workaround).
8. **Capture VS Code's `devcontainer` CLI invocation** per Phase 4 instructions: open weftwise in VS Code, trigger "Reopen in Container," read the Dev Containers output channel, record the exact CLI flags. Update the test's treatment commands if VS Code uses flags the test plan doesn't.
9. Record current `podman images` and `.lace/prebuild/metadata.json` snapshots for both projects.

### Phase 2: Baseline Runs (Control) (~30 min)

Run Scenarios A, B, C, D in sequence using `lace up`.
weftwise's heavier Dockerfile (Electron + Playwright + build:electron) makes each run longer than whelm's, so allow ~30 min for the four control runs.
Capture each run's wall time and the lace log path.
After each run, record:
- `podman images --format '{{.Repository}}:{{.Tag}} {{.Size}} {{.Created}}'`
- `podman ps -a --filter name=weftwise --format '{{.Names}} {{.Status}}'`
- `.lace/logs/<latest>.log` path

### Phase 3: Treatment Runs (~50 min)

Five scenarios using `devcontainer up --config devcontainer.test.json`:
- Scenarios A, B, C as defined (cold / warm / single-feature-change).
- Scenario D1 (per-project caches, weftwise vs synthetic projectB).
- Scenario D2 (shared cache, weftwise vs synthetic projectB). The most informative scenario; takes longer because it requires multiple weftwise builds.

Capture wall time, `--progress=plain` output, and verification check results (V1-V4) after each.
Specifically for Scenario A treatment, capture the *first* run output verbatim - this is the only run where cache cannot help, and it confirms `BUILDKIT_INLINE_CACHE` is being written for the next run to read.

For Scenario D2, capture all three steps' V3 `CACHED` count and the registry blob store size before and after each step.

### Phase 4: Verify VS Code's Underlying Invocation Matches the Test (~10 min, Phase 1 only — not a measurement)

Move this work to Phase 1 preparation: the test plan needs the CLI commands used by the test to mirror what VS Code's Dev Containers extension actually invokes under the hood.
If VS Code passes different flags than our test (e.g., a different cache-to syntax, or an extra `--build-arg`), the test's conclusion about "the cache mechanism works" wouldn't carry over to the originally-observed VS Code environment.

The author specifically opted *not* to do a final VS Code reopen verification, but asked instead that the test's CLI commands be informed by what VS Code actually sends.

To gather:

1. Start VS Code with `code --log trace ~/code/weft/weftwise/main` from a terminal.
2. Trigger "Reopen in Container" once (from a clean state with no running container).
3. Open the Dev Containers output channel (View → Output → "Dev Containers").
4. Capture the full `devcontainer` CLI invocation line. It will look like `devcontainer up --workspace-folder ... --config ... --docker-path ... [flags...]`.
5. Diff the captured flags against the test plan's treatment invocation. Add or adjust the test's flags so the two match (modulo the test's `--cache-to` for cache export).

What to look for specifically:
- Does VS Code pass `--build-no-cache`? If yes, BuildKit cache wouldn't engage and the original cache-busting observation is fully explained by this flag, not by upstream cache mechanics.
- Does VS Code pass `--remove-existing-container`? Affects warm-start scenarios.
- Does VS Code set any cache-related build args (`BUILDKIT_INLINE_CACHE`, `BUILDKIT_PROGRESS`)?
- Does VS Code use `--mount-workspace-git-root` or other workspace-mount flags that change the build context?

This is a research step, not a verification step.
The test plan does not include a Phase 4 confirmation run in VS Code; that was explicitly opted out by the author.
The output of this step is one of:
(a) "VS Code matches our test invocation; no changes needed."
(b) "VS Code passes [flag X]; we should mirror it in the test."
(c) "VS Code passes [flag X] which would explain the original observation without invoking the upstream cache question; the test framing should account for this."

### Phase 5: Report (~15 min)

Write `cdocs/reports/2026-05-XX-empirical-test-upstream-feature-cache-results.md` with the table above filled in.
Include verdict and one-paragraph implication: does the data support deleting `prebuildFeatures` and `lace prebuild` (RFP P_minimum / P5 / P6), keeping them as-is, or taking an intermediate path (e.g., per-project tags, P1)?

### Phase 6: Cleanup

Delete the test files, drop the registry container, prune the test images.
The weftwise and whelm `.devcontainer/` directories are restored to their pre-test state with no manual diffing required (only test files are added; the originals are untouched).

## Estimated Total Wall Time

- Phase 1: 25 min (incl. VS Code invocation capture and synthetic projectB setup)
- Phase 2: 30 min (weftwise's Dockerfile makes each control run substantial)
- Phase 3: 50 min (five scenarios incl. D2's three-step shared-cache probe)
- Phase 4 (merged into Phase 1): 0 min
- Phase 5: 15 min (report writing)
- Phase 6: 5 min (cleanup)

Total: ~125 minutes; roughly half is supervised attention, the other half is build wall-clock.
