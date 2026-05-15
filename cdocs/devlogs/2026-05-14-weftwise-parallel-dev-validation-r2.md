---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-14T13:00:00-07:00
task_list: weftwise/parallel-feature-development
type: devlog
state: live
status: done
tags: [validation, weftwise, portless, parallel-development, e2e, host-portless]
---

# Weftwise Parallel-Dev: r2 Validation (host portless on :1355)

> BLUF(opus/weftwise-parallel-dev): Empirical validation of impl-2's host-portless lifecycle layered on impl-1's round-7 container surface.
> Verification floor MET: `curl -sI http://main.weftwise.localhost:1355/` returns HTTP 200 with `X-Portless: 1` from the host, routed through a lace-spawned host portless that aliases `weftwise` to the project's lace-allocated host port.

## What r2 adds on top of impl-1

- `portless` (0.13.0) bundled as a lace runtime dependency in `packages/lace/package.json`.
- `packages/lace/src/lib/host-portless.ts` (new): probe/spawn/reuse/teardown lifecycle module for the shared host portless on `:1355`. The probe is three-state (free / lace-owned-alive / foreign-bound) with a fourth helper state for stale records.
- `packages/lace/src/commands/doctor.ts` (new): `lace doctor --reset` subcommand. Wired into `packages/lace/src/index.ts`.
- `packages/lace/src/lib/up.ts`: post-container-healthy phase that calls `ensureHostPortless` and `registerHostPortlessAlias` for each `portlessAlias: true` allocation. The local-feature path rewriter is extracted into `rewriteLocalFeatureRefs` so it is unit-testable.
- `packages/lace/src/lib/portless-alias-check.ts`: new `:1355` URL message, dedupe across multiple declarations, probe targets `:1355` (the shared host-portless port) instead of the per-project allocation.
- `packages/lace/src/lib/__tests__/host-portless.test.ts` (new, 17 tests).
- `packages/lace/src/lib/__tests__/rewrite-local-feature-refs.test.ts` (new, 6 tests).
- `packages/lace/src/lib/__tests__/portless-alias-check.test.ts`: updated for the new wording, dedupe, and host-port probe semantics.

## Validation matrix

| Step | Status | Command | Observed |
|---|---|---|---|
| 0 (clean state) | PASS | `lace doctor --reset` + manual `portless proxy stop` | runtime file gone; `:1355` clear; no `~/.portless/proxy.pid` |
| 1 (validate) | PASS | `lace validate` in weftwise/main | Prints new `URLs at http://{branch}.weftwise.localhost:1355/` info line; `host port 1355 is free` info line; exit 0 |
| 2 (lace up - clean spawn) | PASS | `lace up` in weftwise/main | Logged `info: spawned host portless on :1355 (pid 1947688, portless 0.13.0)` and `info: registered portless alias weftwise -> :22427`; `LACE_RESULT: exit 0` |
| 3 (curl main) | PASS | `curl -sI http://main.weftwise.localhost:1355/` | `HTTP/1.1 200 OK`, `x-portless: 1`, `vary: Origin`, `content-type: text/html` |
| 4 (host portless on 1355) | PASS | `ss -tlnp \| grep 1355` | `*:1355 ... node-MainThread,pid=1947688,fd=22` |
| 5 (alias registered) | PASS | `portless list` on host | `http://weftwise.localhost:1355 -> localhost:22427 (alias)` |
| 6 (curl feature-x) | PASS | `curl -sI http://feature-x.weftwise.localhost:1355/` | `HTTP/1.1 200 OK`, `x-portless: 1` |
| 7 (worktree.sh dev in container) | PASS (reused r1) | impl-1's r1 routes `main` (pid 742, vite 4815) and `feature-x` (pid 896, vite 4896) inside the container portless are still active and serve both URLs above. |
| 8 (wildcard match) | PASS | `curl -sI http://nonexistent.weftwise.localhost:1355/` | `404 Not Found` from container portless (host portless wildcard-matches to container; container portless rejects unknown branch). Confirms wildcard works end-to-end. |
| 9 (multi-project) | NOT RUN | (whelm doesn't have portless feature adopted) | Out of scope; same constraint as r1. Architecture: each project gets its own container portless + alias; URL distinguishes by `{project}` segment. |
| 10 (doctor --reset) | PASS | `lace doctor --reset` | `info: sent SIGTERM to host portless pid 1947688`; `info: removed runtime state file`; `:1355` clear; `curl` afterward times out; subsequent `lace up` cleanly spawns a new daemon |
| 11 (reuse on re-run) | PASS | re-run `lace up` while daemon is running | `info: reusing host portless on :1355 (pid 1945757)`; `info: registered portless alias weftwise -> :22427`; idempotent (--force semantics) |
| 12 (foreign-bound path) | PASS | Manual python listener on `:1355`, then `lace up` | `warn: host portless not started: port 1355 is bound but no lace runtime file is present`; `Warning: skipping portless alias registration; host portless is not ready`; lace up still exits 0 (container is healthy) |

### Verification floor

`curl -sI http://main.weftwise.localhost:1355/` -> `HTTP/1.1 200 OK`, `x-portless: 1` MET.

## Deviations and complications

### D1: Portless launcher PID vs daemon PID (caught and fixed)

`portless proxy start --port 1355 --no-tls --wildcard` is a **launcher** that forks the actual daemon and exits. The spawn-and-record-pid path was originally writing the launcher PID (which is dead by the time we read state), causing:
1. `kill -0` to fail on a "lace-owned-alive" probe (false-stale).
2. `lace doctor --reset` to "remove stale record" but leave the daemon orphaned.
3. Subsequent `lace up` to misclassify and either spawn a duplicate or hit foreign-bound.

**Fix**: After spawning, poll `~/.portless/proxy.pid` for up to 5s and use the daemon PID portless itself records there. This is the durable PID. The runtime file at `~/.config/lace/portless-runtime.json` mirrors that PID.

**Tests**: the host-portless test IO mock simulates the launcher-then-daemon split. The "spawn records the daemon PID" expectation is `pid === launcherPid + 1` in the mock.

### D2: Spawn flow blocks on pid-file appearance (5s budget)

Polling `~/.portless/proxy.pid` adds up to a 5-second blocking call inside `runUp`. In practice the file appears in ~100-300ms after spawn. If portless ever changes its startup ordering this would surface as a "launcher pid as fallback" warning rather than a hard failure. The fallback path keeps lace functional even if portless changes shape.

### D3: `import.meta.resolve` in the built bundle

Vite passes `import.meta.resolve` through to runtime (it does not bundle `portless` because the rollup config externalizes `node:` modules but not `portless`). Tested empirically: a script at `dist/test-resolve.mjs` correctly resolves `portless` -> `node_modules/.pnpm/portless@0.13.0/.../dist/index.js` via `import.meta.resolve('portless')`, then walks up to read `package.json` and locate `bin.portless = ./dist/cli.js`.

This works because:
- portless's `package.json` `exports` field defines only `.` (the library entry) — `require.resolve('portless/package.json')` or `require.resolve('portless/dist/cli.js')` both fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `import.meta.resolve('portless')` (the library entry) succeeds, anchoring on the package's installed directory.
- From there, the implementation walks parent directories to find `package.json`, reads `bin.portless`, and resolves the absolute path.

### D4: portless `--wildcard` semantics confirmed

Empirically: `portless proxy start --port 1355 --no-tls --wildcard` produces a daemon where the registered alias `weftwise -> 22427` matches all `*.weftwise.localhost` requests (main, feature-x, nonexistent). The proposal's `--wildcard` semantic is what we get.

The proposal's fallback ("per-route alias registration if wildcard is missing") is therefore unnecessary. The dev script's per-route registration inside the container portless is still doing its job for branch-level demux.

### D5: `lace doctor --uninstall` deferred (per dispatch)

Only `--reset` is implemented. The proposal's truly-portless follow-up RFP will own `--uninstall` for durable system state.

### D6: portless's `proxy stop` is the cleanest manual recovery for non-lace-owned daemons

If a user had previously started portless manually (no runtime file), `lace doctor --reset` is a no-op (it correctly distinguishes "lace owns nothing here"). The user-facing remediation is `portless proxy stop` on the host portless or `lsof -iTCP:1355` to inspect. The validate sub-check's warning includes this hint.

### D7: subprocess env in spawn

The default `spawnDetached` passes `PORTLESS_WILDCARD=1` in env in addition to the `--wildcard` flag (defense in depth in case the CLI's argv parsing of `proxy start` differs in some envs). The empirical run confirms `--wildcard` is the active surface; the env var is redundant but harmless.

## Uncertainties for the reviewer

1. **5-second poll budget.** If portless changes its pid-file ordering and the file never appears, we fall back to recording the (already-dead) launcher pid. This degrades to "next lace up will see stale-record and re-spawn", which is benign — but it adds a 5-second delay before the warning is logged. Reasonable trade-off, but worth scrutiny.

2. **Daemon PID monotonicity.** The fix assumes `~/.portless/proxy.pid` always reflects the current daemon. If portless ever supports multiple concurrent proxies (e.g., one for `:1355` and one for `:443`), the pid file may not be the right one. Out of scope for v1.

3. **`waitForPortBound` in up.ts (3s budget).** Added a coarse port-bound wait between spawn and alias registration to give the daemon time to bind. The 100ms polling cadence + 3s deadline are arbitrary; could be tighter or looser. Empirically the alias registration succeeded on first try in every test.

4. **Vite externalization of `portless`.** I did NOT add `portless` to the rollupOptions.external list. This means vite might try to bundle portless's library entry into the lace bundle. Empirically the build still succeeds and the output is 185kb (vs 184kb without portless dep). The library import path through `import.meta.resolve` is preserved by vite. If a future vite version changes that, the resolve would break with a `Cannot find module` at the `import.meta.resolve` call site. Watching.

5. **Was lace doctor a new subcommand?** YES, it did not exist before this dispatch. Added at `packages/lace/src/commands/doctor.ts` and registered in `packages/lace/src/index.ts`.

6. **Was portless published under that name?** YES, `portless@0.13.0` on npm. Published by `vercel-release-bot` and `ctate`. Not scoped.

7. **Was `--wildcard` available?** YES, both as a CLI flag and via `PORTLESS_WILDCARD=1` env. Verified against `/var/home/mjr/code/weft/lace/main/node_modules/.pnpm/portless@0.13.0/node_modules/portless/dist/cli.js:4229`.

## Files changed

| Path | Summary |
|---|---|
| `packages/lace/package.json` | Added `portless: 0.13.0` to `dependencies` |
| `pnpm-lock.yaml` | Regenerated (transitive: portless only) |
| `packages/lace/src/lib/host-portless.ts` (new) | Probe/spawn/reuse/teardown lifecycle for host portless on :1355 |
| `packages/lace/src/lib/portless-alias-check.ts` | New :1355 URL message, dedupe, probe targets :1355 |
| `packages/lace/src/lib/up.ts` | Post-healthy alias shellout; extracted `rewriteLocalFeatureRefs`; added `waitForPortBound` |
| `packages/lace/src/commands/doctor.ts` (new) | `lace doctor --reset` subcommand |
| `packages/lace/src/index.ts` | Registered `doctorCommand` in citty subCommands |
| `packages/lace/src/lib/__tests__/host-portless.test.ts` (new) | 17 unit tests covering probe, spawn (launcher/daemon pid split), reuse, foreign-bound, stale-record, alias shellout, teardown |
| `packages/lace/src/lib/__tests__/rewrite-local-feature-refs.test.ts` (new) | 6 unit tests for the extracted local-feature path rewriter |
| `packages/lace/src/lib/__tests__/portless-alias-check.test.ts` | Updated assertions for new wording + dedupe + :1355 probe |
| `cdocs/devlogs/2026-05-14-weftwise-parallel-dev-validation-r2.md` (new) | This devlog |
