---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-14T15:25:00-07:00
task_list: weftwise/parallel-feature-development/multi-project-verification
type: devlog
state: live
status: review_ready
tags: [portless, multi-project, weftwise, whelm, validation]
---

# Weftwise Parallel-Dev Multi-Project Validation (F4)

> BLUF(opus/weftwise-parallel-dev/multi-project): Successful empirical proof of multi-project portless routing.
> Weftwise (`main`, `feature-x`) and whelm (`main`) all serve HTTP 200 concurrently via the SAME shared host portless on :1355 (pid 1950137), routing to DIFFERENT in-container backends on distinct host-allocated ports (weftwise -> :22427, whelm -> :22428).
> One deviation: portless had to go in `prebuildFeatures`, not `features`, because whelm's prebuilt base image bakes nushell as the node user's login shell, which breaks the standard node feature's `su -c '... && ...'` bootstrap.

## Objective

End-of-dispatch acceptance: host browser concurrently reaches `http://main.weftwise.localhost:1355/`, `http://feature-x.weftwise.localhost:1355/`, and `http://main.whelm.localhost:1355/`, all 200, all routed through one host portless singleton.

This is Phase 4 / step 9 of the round-8 weftwise parallel-feature-development proposal: the empirical "multi-project safe" proof.

## Changes

### whelm repo (`/home/mjr/code/apps/whelm`)

- `.devcontainer/devcontainer.json`:
  removed `appPort: [3000]`,
  added portless to `customizations.lace.prebuildFeatures` (rather than top-level `features`, see below),
  added a NOTE explaining the prebuild placement.
- `packages/whelm/vite.config.ts`:
  `server.port` now reads `process.env.PORT` (falls back to 3000),
  with a NOTE explaining the env-var hook.
- `scripts/dev.sh` (new, executable):
  Wraps `portless ${branch}.whelm.localhost sh -c 'exec pnpm --filter whelm exec vite --port "$PORT" --host --strictPort'`,
  derives `branch` from `git branch --show-current` with a `WHELM_BRANCH_OVERRIDE` env-var escape hatch (used here to pin the route to `main` while the working branch is `speed`).
  Whelm has no `@tanstack/devtools` event bus, so no `TANSTACK_DEVTOOLS_PORT` override is needed (unlike weftwise).
- Root `package.json` `scripts.dev` left unchanged at `pnpm --filter whelm dev` (direct vite, no portless): documented in `scripts/dev.sh` header that the portless dev path is the new script.

### lace repo

- Only this devlog added.
  No lace code changes were needed: the existing portless-alias detection (`lib/portless-alias-check.ts`) already prints `info: portless feature detected (alias=whelm); URLs at http://{branch}.whelm.localhost:1355/.` when run against the whelm workspace.

## Empirical evidence

### `lace up --rebuild` output

```
info: portless feature detected (alias=whelm); URLs at http://{branch}.whelm.localhost:1355/.
info: port-80 binding is tracked in cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md.
warn: host port 1355 is held by another process; lace up will skip alias registration. Free the port (e.g., 'lace doctor --reset' if you suspect a stale lace daemon, or 'lsof -iTCP:1355') and retry.
...
info: reusing host portless on :1355 (pid 1950137).
info: registered portless alias whelm -> :22428.
lace up completed successfully
```

> NOTE(opus/multi-project): The `warn: host port 1355 is held by another process` is misleading - the port IS held by lace's own host-portless singleton. `lace up` correctly identifies it as such in the very next phase (`info: reusing host portless on :1355 (pid 1950137).`).
> The warn appears to be emitted from a phase that pre-dates the reuse-detection logic and should either be silenced or refined when the holder is the lace-managed singleton.
> Tracking as a polish item, not a blocker.

### HTTP 200 + `x-portless: 1` on all three routes

```sh
$ curl -sI http://main.weftwise.localhost:1355/ | head -3
HTTP/1.1 200 OK
x-portless: 1
vary: Origin

$ curl -sI http://feature-x.weftwise.localhost:1355/ | head -3
HTTP/1.1 200 OK
x-portless: 1
vary: Origin

$ curl -sI http://main.whelm.localhost:1355/ | head -3
HTTP/1.1 200 OK
x-portless: 1
vary: Origin
```

### Body diff confirms distinct backends

```html
<!-- main.weftwise.localhost:1355/ -->
<!DOCTYPE html><html lang="en" data-tsd-source="/src/routes/__root.tsx:59:5"><head ...><title>Weft</title></head>...
  (TanStack Start SSR; references /src/routes/__root.tsx, mounts_provider.tsx, ...)

<!-- main.whelm.localhost:1355/ -->
<!doctype html>
<html lang="en">
  <head>
    <script type="module">import { injectIntoGlobalHook } from "/@react-refresh"; ...</script>
    <script type="module" src="/@vite/client"></script>
    ...
    <title>whelm</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

Two clearly distinct apps. Weftwise serves SSR-streamed TanStack Start; whelm serves a vite SPA shell.

### Singleton host portless on :1355

```sh
$ ss -tlnp 2>/dev/null | grep -E ":(1355|22427|22428|22429)\b"
LISTEN 0 511 *:1355  users:(("node-MainThread",pid=1950137,fd=22))   # singleton host portless
LISTEN 0 128 *:22428 users:(("pasta.avx2",pid=2248098,fd=74))         # whelm container proxy
LISTEN 0 128 *:22429 users:(("pasta.avx2",pid=2248098,fd=75))         # whelm sshd
LISTEN 0 128 *:22427 users:(("pasta.avx2",pid=1980926,fd=75))         # weftwise container proxy
```

Exactly ONE process listens on :1355.

### `portless-runtime.json` singleton record

```sh
$ cat ~/.config/lace/portless-runtime.json
{
  "pid": 1950137,
  "port": 1355,
  "startedAt": "2026-05-14T20:06:40.535Z",
  "portlessVersion": "0.13.0"
}
```

PID matches the :1355 listener.

### Per-project lace port allocations (both in 22425-22499)

```jsonc
// /home/mjr/code/weft/weftwise/main/.lace/port-assignments.json
"portless/proxyPort": { "port": 22427, "assignedAt": "2026-05-14T18:23:00.739Z" }

// /home/mjr/code/apps/whelm/.lace/port-assignments.json
"portless/proxyPort": { "port": 22428, "assignedAt": "2026-05-14T22:16:47.580Z" }
```

Distinct ports allocated from the lace pool.

### Fallback routing (404 sanity check)

```sh
$ curl -sI http://nonexistent.weftwise.localhost:1355/ | head -3
HTTP/1.1 404 Not Found
x-portless: 1
content-type: text/html

$ curl -sI http://nonexistent.unknown.localhost:1355/ | head -3
HTTP/1.1 404 Not Found
X-Portless: 1
Content-Type: text/html
```

The host portless 404s for unknown aliases (`nonexistent.unknown`) and the weftwise in-container portless 404s for unknown branches under a known alias (`nonexistent.weftwise`).
Two distinct 404 paths, both well-formed.

> NOTE(opus/multi-project): the `nonexistent.unknown` 404 has `X-Portless: 1` (capitalised) while every other response uses lowercase `x-portless: 1`.
> Likely two different code paths emit the header with different casing.
> Cosmetic, but worth a follow-up in portless itself.

## Deviations and complications

### Portless dependency forces node-feature reinstall, conflicting with prebuilt nushell SHELL

The portless devcontainer feature declares `dependsOn: ghcr.io/devcontainers/features/node:1`.
When portless is added to top-level `features` on whelm, the dev-container CLI re-runs the node feature's install during build.
The install uses `su ${USERNAME} -c "umask 0002 && . '${NVM_DIR}/nvm.sh' && nvm install ..."`.
Whelm's base image `lace.local/node:24-bookworm` (prebuilt by lace from `prebuildFeatures`) already bakes the node user's login shell to `/usr/local/bin/nu`. `su node -c '... && ...'` therefore evaluates the script under nushell, which rejects `&&`:

```
Error: nu::parser::shell_andand
  x The '&&' operator is not supported in Nushell
```

This crashes the build before portless itself runs.
Weftwise does not hit this because its base image is plain `node:24-bookworm` and the SHELL switch happens late in the feature install order.

**Resolution:** move portless to `customizations.lace.prebuildFeatures`. This bakes portless into the lace-prebuilt base image alongside the other features, ordering before the SHELL switch.

**Implication for the proposal:** the F4 step-9 "add portless feature to whelm's devcontainer.json" instruction is too narrow.
For any project whose base image is a lace-prebuilt with nushell baked, portless must be a prebuild feature.
The proposal should be updated to:
either (a) document this caveat explicitly,
or (b) have the portless feature's install script use a SHELL override (`SHELL ["/bin/dash", "-c"]` in the generated dockerfile?) so it works regardless of the user's login shell.
Option (b) is cleaner but requires a feature-level change.

### Branch override for single-tree projects

The dev script derives the route from `git branch --show-current`.
Whelm's current branch is `speed`, but the F4 verification spec calls out `main.whelm.localhost`.
Added `WHELM_BRANCH_OVERRIDE` env-var to dev.sh and invoked the script with `WHELM_BRANCH_OVERRIDE=main`.
For a single-tree project this is benign, but it does mean every whelm developer needs to either (a) accept that the route reflects their working branch, or (b) export `WHELM_BRANCH_OVERRIDE`.
Forward-compatible with a bare-worktree migration, where each worktree's `git branch --show-current` would naturally differ.

### `lace validate` warn on held :1355 is misleading

See callout in the `lace up` evidence section above.
Not a blocker for F4 but warrants a polish-pass on the validate-vs-up message ordering.

### Header casing inconsistency: `x-portless` vs `X-Portless`

See callout in the fallback-routing evidence section.
Cosmetic.

## Uncertainties for reviewer

- Is the `prebuildFeatures` placement of portless an acceptable pattern, or should the proposal mandate refactoring the portless feature to avoid the node-bootstrap conflict?
  The latter is cleaner but expands F4's scope significantly.
- The empirical proof is "two projects + one branch each + one cross-branch on weftwise (main + feature-x)".
  The proposal's "multi-project safe" claim is satisfied,
  but "N projects" (N > 2) is not exercised. Likely fine: the alias dispatcher in host portless is keyed by hostname, so no per-N branching exists.
- Did the F4 dispatch leave any cleanup debt? See git status capture below.

## Files changed (for the chunk-boundary commit)

### whelm repo

- M `.devcontainer/devcontainer.json` - move portless to prebuildFeatures, remove appPort.
- M `packages/whelm/vite.config.ts` - `server.port` reads `PORT` env.
- A `scripts/dev.sh` - portless-fronted dev wrapper.

### lace repo

- A `cdocs/devlogs/2026-05-14-weftwise-parallel-dev-multi-project-validation.md` - this devlog.

## Containers and processes left in known state

- `whelm` container: Up, vite dev server bound :4170 (portless-allocated), logs at `/tmp/whelm-dev.log` inside container.
- `weftwise` container: Up, unchanged.
- `clauthier` container: Up, unchanged.
- Host portless singleton: pid 1950137, :1355. Aliases registered: `weftwise -> :22427`, `whelm -> :22428`.
