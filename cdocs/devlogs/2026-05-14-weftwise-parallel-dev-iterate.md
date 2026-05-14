---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-14T11:15:00-07:00
task_list: weftwise/parallel-feature-development
type: devlog
state: live
status: review_ready
tags: [iterate, weftwise, portless, parallel-development, implementation]
---

# Weftwise Parallel-Dev: Iterate Loop

> BLUF(opus/weftwise-parallel-dev): Overseer-driven implement-review loop for the v1 proposal at `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md` (status: implementation_ready, accepted at round 6).
> Verification floor: by termination, the user can visit at least two concurrent dev servers in the host browser at `http://{branch}.weftwise.localhost:<host-port>/` URLs.

## Proposal under iteration

`cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md`.

Status at loop start: `implementation_ready`, round 6 accepted.

## Verification floor

> By the end of implementation, the user can visit multiple concurrent dev servers in the host browser at `http://{branch}.weftwise.localhost:<host-port>/` URLs.
> Failure picture: only one worktree's dev server is reachable, or the URLs do not resolve, or the URLs resolve but return non-200 / wrong-worktree content.

The proposal's `## Implementation Phases` Phase 4 (lines 325-357) provides a 9-step matrix that operationalizes this floor.
Loop is bound to that matrix as the empirical proof.

## Overseer constraints

The user is not doing other work on this machine. Implementers may:

- Run `lace up` / `lace up --rebuild` / `lace down`.
- Restart containers.
- Kill processes binding host ports in the 22425-22499 range.
- Edit `/home/mjr/code/weft/weftwise/main/` files (the weftwise repo).
- Edit `/var/home/mjr/code/weft/lace/main/` files (lace itself).

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_path | notes |
|---|---|---|---|---|---|
| 1 | impl-1 (general-purpose) | rev-1 (cdocs:reviewer) | accept | cdocs/reviews/2026-05-14-review-of-weftwise-parallel-dev-r1.md | All four phases applied; verification floor MET (two concurrent dev servers returning HTTP 200 simultaneously, overseer-verified post-review via live `curl`). Required four unplanned fixes: lace local-feature path rewriting (D1), portless feature entrypoint (D2), worktree.sh framework workaround (D3), vite.config relaxation (D4, explicit proposal-line-84 violation, accepted because the line-57 premise was empirically false). Non-blocking follow-ups: proposal NOTE callouts at lines 57/84, step-9 multi-project deferred, D1 path rewriter lacks targeted unit tests. |

## Judge Log

| judge_iteration | trigger | verdict | rationale | judge_path |
|---|---|---|---|---|

## impl-1 progress

### Phase 1: weftwise `scripts/worktree.sh dev`

- Added `cmd_dev` function deriving branch from `basename "$PWD"`, install-on-missing via `pnpm install --frozen-lockfile`, then `exec portless "${branch}.weftwise.localhost" pnpm dev`.
- Added `dev)` dispatcher case and updated the help text and header usage block.
- Smoke-tested error path: `cd /tmp && scripts/worktree.sh dev` correctly emits `[ERROR] No package.json in /tmp; ...` and exits non-zero. `bash -n` syntax check passes.

### Phase 2: weftwise devcontainer.json adoption

- Removed `appPort: [3000]` (the container portless replaces direct vite forwarding).
- Added the portless feature reference. The proposal documents using a path ref for unpublished features.
  - Verified `ghcr.io/weftwiseink/devcontainer-features/portless:1` is NOT published (HTTP 404 against the manifest endpoint).
  - **Deviation**: per the proposal text "use the path reference `./devcontainers/features/src/portless`", that path is rooted at the lace repo, not weftwise. The devcontainer CLI resolves feature path refs relative to the devcontainer.json file location, and the lace source tree is not available from weftwise's `.devcontainer/`. Copied the feature into `weftwise/.devcontainer/features/portless/` and referenced it as `./features/portless`. Documented inline in the devcontainer.json with a NOTE indicating the path is a transitional local-development artefact.

### Phase 3: lace `portlessAlias` metadata + `validate` extension

- `packages/lace/src/lib/feature-metadata.ts`: widened `LacePortDeclaration` with `portlessAlias?: boolean` (interface), and extended the `extractLaceCustomizations` extractor to round-trip the boolean (non-booleans -> undefined).
- `packages/lace/src/lib/portless-alias-check.ts` (new module): pure-function sub-check that iterates the feature metadata for `portlessAlias: true`, cross-references against live allocations, runs `isPortAvailable` (ownedPorts short-circuit), and returns findings + messages (info/warn lines). Decoupled from console output so the test surface is structural.
- `packages/lace/src/lib/up.ts`: imports `checkPortlessAliases` and invokes it right after `buildFeaturePortMetadata`. Emits returned messages to stdout (info -> log, warn -> warn). Wrapped in try/catch so a probe failure can never break the pipeline.
- `devcontainers/features/src/portless/devcontainer-feature.json`: added `"portlessAlias": true` to the `proxyPort` declaration.
- Tests added:
  - `feature-metadata.test.ts`: existing test updated to expect `portlessAlias: undefined` in the wezterm metadata extract; new test `"accepts boolean portlessAlias and coerces non-booleans to undefined"` covers the round-trip semantics.
  - `portless-alias-check.test.ts` (new): six scenarios covering free port, held-by-unrelated-process (warn), owned-by-this-project (no probe needed), no-portlessAlias-declared (no-op), declared-but-no-allocation (soft warn), null-metadata (skip).
- Build: `pnpm --filter lace build` passes; `tsc --noEmit` passes.
- Tests: `pnpm test --run` reports 1055 passed / 11 skipped / 0 failures. (`pnpm lint` not present in lace; `tsc --noEmit` is the type/lint gate.)

**Deviation**: the proposal's `validate` extension diff (Section 3c) talks about edits to `packages/lace/src/commands/validate.ts`. I did not modify that file because `validate` is a thin shim over `runUp` with `validateOnly: true`. Embedding the sub-check inside `runUp` (so both `lace up` and `lace validate` benefit) was the cleaner integration; the proposal's intent (run the check, emit the message) is satisfied.

### Phase 4: empirical validation

See `cdocs/devlogs/2026-05-13-weftwise-parallel-dev-validation.md` for the implementer's 9-step matrix results.

## Loop termination

Loop terminated on **accept** after one iteration.
Reviewer `rev-1` updated proposal `last_reviewed` to `accepted, by: @claude-opus-4-7, at: 2026-05-14T11:55:00-07:00, round: 7`.

### Overseer post-review live verification

The reviewer relied on transcripts and persisted state files (no Bash tool in the cdocs:reviewer agent).
The overseer re-ran the empirical floor commands directly to satisfy the user's explicit "I can visit in browser" requirement:

| Command | Result |
|---|---|
| `curl -sI http://main.weftwise.localhost:22427/` | `HTTP/1.1 200 OK`, `X-Portless: 1` |
| `curl -sI http://feature-x.weftwise.localhost:22427/` | `HTTP/1.1 200 OK`, `X-Portless: 1` |
| `podman port weftwise` | `22425/tcp -> 0.0.0.0:22425`, `22427/tcp -> 0.0.0.0:22427`; no `3000:3000` |
| `lace validate` in weftwise/main | Prints `info: portless feature detected (alias=weftwise); ...`, RFP pointer, `info: host port 22427 is free (or held by this project's container)`; exit 0 |
| `curl -s http://main.weftwise.localhost:22427/` body | Renders weftwise `<title>Weft</title>` with tanstack-start routes and vite HMR injection |

Both dev servers remain live for the user to visit in the host browser.

### Non-blocking follow-ups (reviewer)

These were called out in the review document and do NOT block accept; they are surfaced for the user to decide whether to address now or defer:

1. Proposal lines 57 and 84 need `> NOTE(...)` callouts acknowledging that D3 (no portless framework auto-injection) and D4 (vite config relaxation) were empirically required.
2. Phase 4 step 9 (multi-project) was not run; Objective 3 ("Multi-project safe") is empirically unverified.
3. D1's local-feature path rewriter in `up.ts` lacks targeted unit tests (covered only indirectly via the scenario suite).
4. Portless feature manifest description text still says "asymmetric mapping to 1355" but `install.sh` now binds the symmetric `--port "$PROXY_PORT" --no-tls`. Doc-text drift.
5. `worktree.sh dev` hard-codes weftwise-specific `--filter weft`; branch-derivation via `basename "$PWD"` is fragile from sub-package directories.
6. `portless-alias-check` prints the RFP-pointer info once per allocation (no dedupe). Cosmetic.

### Total work

- **Iterations:** 1
- **Reviews:** 1
- **Judge invocations:** 0 (accepted before `--judge-after 3` threshold)
- **Implementer deviations from proposal:** 6 (D1-D6), all justified in the review

