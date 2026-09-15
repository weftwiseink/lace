---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-15T15:00:00-08:00
task_list: code-graph/graphify-lace-feature
type: devlog
state: live
status: wip
tags: [devcontainer_features, code_graph, tooling, architecture]
---

# Graphify lace devcontainer feature: full-send arc

> BLUF(opus/graphify-lace-feature): Overseer devlog for a `/cdocs:full-send` arc that authors, then implements, a `graphify` lace devcontainer feature.
> The feature concretely answers the weftwise code-graph RFP's #1 open question ("what is lace?"): lace is this repo's devcontainer-feature framework, and this feature is the in-container index-provisioning surface that feeds a graph-backed review/dev loop.
> Two composed overseer loops run in sequence: `/cdocs:propose-revise` (author + review/revise to accept) then `/cdocs:iterate` (implement + review to accept).

## Arc scope

Author and implement `devcontainers/features/src/graphify/` on the lace feature framework, mirroring `claude-code`/`neovim`/`blesh`:
install a pinned `graphifyy` (Python), optionally expose the MCP server + `/graphify` skill, declare a `customizations.lace.mounts` mount to persist the `graph.json` index across rebuilds, and frame graceful degradation to the grep-scoping floor when the index is stale or missing.

Driving RFP: weftwise `cdocs/proposals/2026-09-15-code-graph-review-plugin-rfp.md`.
Cross-refs: weftwise `cdocs/reports/2026-09-15-code-wiki-landscape.md`, `cdocs/devlogs/2026-09-15-code-graph-chain-checkpoint.md`, `cdocs/proposals/2026-09-14-prompt-based-review-scoping-rfp.md`.

## Overseer discipline

Thin lead: dispatch by default, fresh reviewer each round, fresh judge each invocation, durable state before compact.
Model: opus for subagents (per repo memory overseer directives).

## Arc state

- Phase 1 (propose-revise): DONE. Accepted R2 (commit a1b9a7e); accept-nits folded + `implementation_ready` (commit 9ae227e3). Proposal: `cdocs/proposals/2026-09-15-graphify-lace-devcontainer-feature.md`.
- Phase 2 (iterate): IN PROGRESS.

## Phase 2 (iterate) Brief

**Scope**: full proposal. Build `devcontainers/features/src/graphify/` (devcontainer-feature.json + install.sh + README.md) and `devcontainers/features/test/graphify/` (scenarios.json + test.sh), per the accepted proposal's Implementation Phases.

**Verification floor**: The graphify feature installs and exposes `graphify` on PATH for the NON-ROOT remote user in a `devcontainer features test` scenario build.
Failing picture: install.sh exits 0 while `graphify --version` (or the Phase-1-confirmed verify command) is unresolvable for the remote user (pipx bootstrap landed it in a root-only or unexported location), OR the lace `index` mount-target directory is missing or not owned by the remote user.
Known harness limit (from R2 review): `devcontainer features test` does NOT apply lace mounts, so mount PERSISTENCE across rebuild is a separate manual `lace up` step, not harness-verifiable; the harness DOES verify install + PATH + mount-target-dir creation/ownership (install.sh creates+chowns the dir regardless of mount).

**Model**: opus subagents. `--judge-after`: 3 (default).

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_proof | review_path | overseer_ctx_est | inline_work | notes |
|---|---|---|---|---|---|---|---|---|

## Judge Log

| judge_iteration | trigger | verdict | overseer_thinness | rationale | judge_path |
|---|---|---|---|---|---|

## Steering Log

| at | kind | target | content | applied_at_iteration |
|---|---|---|---|---|

## Dispatch/Return Events

| at | event | agent | scope |
|----|-------|-------|-------|
| 2026-09-15T15:00 | dispatch | opus proposer (/cdocs:propose) | authors cdocs/proposals/2026-09-15-graphify-lace-devcontainer-feature.md |
| 2026-09-15T15:05 | return | opus proposer | proposal authored + committed 2901ff70; pipx-into-/usr/local, exact-pin graphifyy==0.9.61, cache-mount (not repo artifact), MCP/skill/git-hook opt-in. 4 open Qs flagged (verify cmd, cache path, skill scope, MCP transport) |
| 2026-09-15T15:05 | dispatch | opus reviewer R1 (/cdocs:review) | reviews the proposal; probe the 4 open Qs |
| 2026-09-15T15:10 | return | opus reviewer R1 | REVISE, round 1. review committed 23eb222f. 3 blocking: (1) pipx-at-build-time unverified/load-bearing, add bootstrap fallback; (2) drop installSkill (clauthier plugin layer owns it); (3) MCP registration must use `claude mcp add -s user`, not ~/.claude.json edit. Framework claims + honesty discipline PASS. |
| 2026-09-15T15:10 | dispatch | opus reviser R1 (resume author a1480) | address 3 blocking findings + nits |
| 2026-09-15T15:15 | return | opus reviser R1 | revised + committed 57b47d98. B1: pipx 3-way probe w/ ensurepip+pip self-provision bootstrap + WARN; B2: installSkill removed (clauthier owns); B3: MCP pinned to `claude mcp add -s user`, stdio default. Nits addressed. |
| 2026-09-15T15:15 | dispatch | opus reviewer R2 (/cdocs:review, fresh) | verify 3 blocking fixes; full re-review |
| 2026-09-15T15:20 | return | opus reviewer R2 | ACCEPT, round 2. review committed a1b9a7e. All 3 blockers resolved; honesty + framework claims verified. 4 non-blocking nits (N1 pipx-absent Edge-Case contradiction, N2 --break-system-packages, N3 su/sudo -u wrapper, N4 status/TZ). Phase 1 done. |
| 2026-09-15T15:20 | dispatch | opus reviser accept-nits (resume author a1480) | fold N1-N4 + set status implementation_ready |
| 2026-09-15T15:22 | return | opus reviser accept-nits | committed 9ae227e3; nits folded; status implementation_ready. Phase 1 fully done. |
| 2026-09-15T15:25 | dispatch | impl-1 (general-purpose) | claims devcontainers/features/src/graphify/**, devcontainers/features/test/graphify/**; implements the feature |
| 2026-09-15T15:37 | reconcile | impl-1 (terminated, stale "waiting" msg) | Files exist; initial commit 2365ffd landed; refinements UNCOMMITTED in worktree; real `devcontainer features test --features graphify` STILL BUILDING in bg (docker buildx live). impl devlog: cdocs/devlogs/2026-09-15-graphify-lace-feature-impl.md. Resuming impl-1 to finish test + commit. |
| 2026-09-15T15:45 | evidence | overseer (log inspect) | HARNESS_EXIT=0. All 4 scenarios PASS: default_install (incl. `graphify update`→graph.json-with-nodes smoke), custom_version (0.9.60 pin), non_root_user (PATH+`--version`+cache-dir-owned by remote user), mcp_without_claude. Floor's failure-picture directly tested + passed. Log: scratchpad/harness3.log. |
| 2026-09-15T15:45 | resume | impl-1 (running, msg delivered) | finalizing: commit worktree refinements + impl devlog → review_ready + report |
| 2026-09-15T15:55 | return | impl-1 | DONE. commits 2365ffd/f5c6096/011243d; worktree clean; committed src == tested src. Floor SATISFIED (HARNESS_EXIT=0, 4/4). Phase-1 facts resolved: cache=project-local via GRAPHIFY_OUT (fixed /var/cache/graphify), index cmd `graphify update <path>`, MCP `graphify-mcp` stdio. 4 deviations (all NOTE'd); mount-persistence + MCP-happy-path + git-hook + CI-publish NOT harness-verified. |
| 2026-09-15T15:56 | dispatch | rev-1 (cdocs:reviewer, fresh) | claims cdocs/reviews/** only; review the implemented feature + empirically re-verify floor |
