---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-11T10:00:00-07:00
task_list: devcontainer/claude-feature-updatability
type: devlog
state: live
status: wip
tags: [devcontainer, claude_code, feature_versioning, orchestration]
---

# Full-Send: Claude Code Feature Updatability

> BLUF: Overseer devlog for the `/cdocs:full-send` on making devcontainers auto-update their Claude Code version and upgrading/sweeping the lace `claude` devcontainer feature.
> Two composed loops: `/cdocs:propose-revise` (author + review-to-accept), then `/cdocs:iterate` (implement-to-accept).

## Task

User request (verbatim intent):
- Make it possible for devcontainers to update their Claude Code version.
- Upgrade our lace `claude` feature version (it goes outdated easily; at least in weftwise it can't be updated easily).
- Possibly do an update sweep across projects (jif / whelm / clauthier / weftwise).
- Desired outcome: next time weftwise is rebuilt, it just handles the Claude Code update automatically.
- Constraint: do NOT restart any active containers.

## Overseer Discipline (inline floor)

- Dispatch by default (propose-revise: dispatch everything, even trivial; iterate: dispatch beyond trivial few-liners).
- Write durable state (this devlog) before compacting.
- Fresh reviewer each round; fresh judge each invocation (iterate).
- Model: opus for subagents (per user memory + model-tiering lead default). No `-f/--first-round` given.

## Phase 1: propose-revise

Target proposal path (assigned): `cdocs/proposals/2026-09-11-claude-code-feature-updatability.md`

### Dispatch/Return Events

| event | child | role | files claimed | at |
|-------|-------|------|---------------|-----|
| dispatch | proposer-1 | proposer (opus, /cdocs:propose) | cdocs/proposals/2026-09-11-claude-code-feature-updatability.md (+ optional supplemental report) | 2026-09-11T10:00 |
| return | proposer-1 | proposer | proposal written, committed 2a0e5c9, status review_ready; no supplemental | 2026-09-11T10:06 |
| dispatch | reviewer-1 | reviewer (opus, cdocs:reviewer) | cdocs/reviews/2026-09-11-review-of-claude-code-feature-updatability.md | 2026-09-11T10:07 |
| return | reviewer-1 | reviewer | REVISE (revision_requested); review committed 7b04711; 3 blockers | 2026-09-11T10:13 |
| dispatch | proposer-1 (resumed) | reviser | cdocs/proposals/2026-09-11-claude-code-feature-updatability.md | 2026-09-11T10:14 |
| return | proposer-1 (resumed) | reviser | revised, committed 7a5127a; all 3 blockers + 4 nits addressed; status review_ready | 2026-09-11T10:17 |
| dispatch | reviewer-2 | reviewer (opus, cdocs:reviewer, FRESH) | cdocs/reviews/2026-09-11-review-of-claude-code-feature-updatability.md (round 2 append) | 2026-09-11T10:18 |
| return | reviewer-2 | reviewer | ACCEPT (accept-with-nits); review committed efce7e2; NEW-1/NEW-2 gated by Phase 1 | 2026-09-11T10:22 |

### Proposer-1 findings (absorbed summary)

- Version frozen twice: (1) build-layer freeze — `install.sh` npm-installs `@${VERSION:-latest}` inside a cached legacy-builder layer; `lace up --no-cache` is metadata-only and `--rebuild` recreates container from cached image, so npm install never re-runs. (2) Digest-lock freeze — feature pinned by `@sha256` in `devcontainer-lock.json`.
- Recommended: move npm install into a feature-declared `postCreateCommand` (runs in fresh container, outside layer cache, re-resolves `@VERSION` each rebuild; never touches running containers). Keep build-time install as offline baseline. Delivery reuses portless proposal's republish + one-time lock-refresh two-leg pattern.
- `claude update`/native installer REJECTED as durable mechanism (writes outside mounted ~/.claude, evaporates on rebuild).
- Phases: (1) create-time hook + user-writable prefix + offline fallback; (2) version bump 1.0.1->1.1.0 + republish + README; (3) lace propagation + `--build-no-cache` escape hatch; (4) cross-project sweep jif->whelm->clauthier->weftwise (weftwise last, auth-gated); (5) reproducibility pin + optional autoUpdate toggle.
- Investigation Requested: consumer configs (jif/whelm/clauthier/weftwise) live OUTSIDE this worktree, NOT read — privilege/prefix model per-consumer unverified; lifecycle honoring of feature `postCreateCommand` on `--buildkit never` path unverified (Phase 3); postCreateCommand vs updateContentCommand left to reviewer.

### Review Rounds

| round | reviewer | verdict | review path | notes |
|-------|----------|---------|-------------|-------|
| 1 | reviewer-1 (opus) | revision_requested | cdocs/reviews/2026-09-11-review-of-claude-code-feature-updatability.md | 3 blockers; revising via proposer-1 |
| 2 | reviewer-2 (opus, fresh) | accepted | cdocs/reviews/2026-09-11-review-of-claude-code-feature-updatability.md (Round 2 section) | ACCEPT with nits NEW-1/NEW-2 (Phase-1 gated) |

**Phase 1 (propose-revise) COMPLETE.** Proposal `2026-09-11-claude-code-feature-updatability.md` accepted round 2, transitioned to `status: implementation_ready`.
Carry-forward nits for implementer: NEW-1 (`chown -R` baseline files so non-root create-time reinstall doesn't hit EACCES) and NEW-2 (relocated `NPM_CONFIG_PREFIX` bin on remote user's PATH). Both already covered by Phase-1 acceptance criteria.

#### Round 1 blockers + overseer-directed resolution

Overseer decision: adopt reviewer's recommendations for all 4 author decisions (repo-grounded, defensible; not user-scope questions). Directed proposer-1 to:
1. **Version bridge**: make the "installed-script/wrapper" path THE design: `install.sh` bakes the resolved version spec into a wrapper script the create-time hook calls (feature-option env does not reach a lifecycle-command string; `${VERSION}` would expand empty and fail-then-fall-back forever).
2. **Prefix**: `install.sh` creates/chowns a prefix and exports `NPM_CONFIG_PREFIX` via `containerEnv` so root build-time + remote-user create-time installs share it. Per-consumer empirical check stays a Phase-1 deferral; mechanism choice does not.
3. **Delivery reframing**: single-leg (republish + lock refresh); drop the portless "immediate override leg" / "no re-litigation" inheritance claim (an override on the old digest cannot conjure a new lifecycle-hook capability).
4. **Hook**: `postCreateCommand` (cache-safe; `updateContentCommand` result can be baked into a prebuild snapshot, reintroducing the freeze).
Plus nits: explicit re-run-on-recreate acceptance check with devcontainer CLI version floor (>= v0.223.0); soften "deterministic no-op" -> "idempotent reinstall"; descope `--build-no-cache` escape hatch to a brief note or RFP stub.

## 2026-09-12: Scope pivot — multi-workstream arc

User redirected after reviewing the design artifact (https://claude.ai/code/artifact/9afefd49-5989-4a19-abdc-56dafdad509f).
The single create-time-hook full-send is superseded by an arc of four workstreams.
The accepted 2026-09-11 create-time-hook proposal is **PARKED** (not withdrawn) pending workstream C's mechanism reconsideration; do not implement it now.

Model default for all workstreams: opus (medium effort intent; Agent tool cannot set effort, so opus + noted in prompts).

### Workstream register

| id | kind | scope | proposal/report path | status |
|----|------|-------|----------------------|--------|
| A | /report | Can we drop the legacy builder (`--buildkit never`)? Recent devcontainer CLI / BuildKit viability. | cdocs/reports/2026-09-12-legacy-builder-migration-viability.md | DONE (c0e2d4d): NOT-YET viable + orthogonal to freeze |
| B | /full-send | BASICS unblock: bump pinned versions of claude-code + other lace features, publish to GHCR, relock consumers (jif/whelm/clauthier/weftwise). NO deeper mechanism change. Publish+sweep AUTHORIZED by user. | cdocs/proposals/2026-09-12-feature-version-update-sweep.md | proposal ca716d1; review R1 dispatched |
| C | /propose-revise | Reconsider volume-backed install + `claude update` native installer vs npm-reinstall. Design only, review-to-accept. May supersede 2026-09-11 proposal. | cdocs/proposals/2026-09-12-claude-code-volume-native-update.md | proposal ba34a7c; verdict SOUND-w/-conditions; review R1 dispatched; superseded 2026-09-11 (confirmed OK) |
| D | /report | CONDITIONAL on C: self-update co-feature — volume-backed per-feature `autoupdate` command + `lace-update-features` aggregator in lace-friendly-feature. | cdocs/reports/2026-09-12-lace-self-update-cofeature.md | DONE (5fc5470): promising-but-DEFER. Only claude-code benefits; portless must NOT auto-update. Aggregator -> lace-fundamentals (lace-friendly-feature doesn't exist); drop-in /usr/local/share/lace/autoupdate.d/<id>. Recommends narrow /cdocs:rfp, not full proposal. Shares go/no-go gate. |

### Dispatch/Return Events (arc)

| event | child | workstream | files claimed | at |
|-------|-------|------------|---------------|-----|
| dispatch | reporter-A | A | cdocs/reports/2026-09-12-legacy-builder-migration-viability.md | 2026-09-12 |
| return | reporter-A | A | NOT-YET viable (c0e2d4d). Blocker: containers/buildah#6503 open (rootless-podman+overlay /tmp perm corruption on BuildKit feature-install path). Legacy builder chosen for CORRECTNESS not cache. Dropping it would NOT unfreeze @latest (orthogonal: layer caching freezes it either builder). Accepted create-time-hook fix is builder-agnostic. Open Q: empirical re-run not done. | 2026-09-12 |
| dispatch | proposer-B | B | cdocs/proposals/2026-09-12-feature-version-update-sweep.md | 2026-09-12 |
| dispatch | proposer-C | C | cdocs/proposals/2026-09-12-claude-code-volume-native-update.md (+ evolves 2026-09-11 on accept) | 2026-09-12 |
| return | proposer-B | B | proposal ca716d1 review_ready; 7-feature inventory; claude-code 1.0.1->1.0.2 + lace-fundamentals :1->:2 gated migration; 6 Investigation Requested items | 2026-09-12 |
| return | proposer-C | C | proposal ba34a7c review_ready. Upstream ALSO installs via npm; npm pulls SAME native binary (v2.1.198+). Native installer user-local (~/.local), auto-updates, claude update writes there. Volume over ~/.local/share/claude survives recreate -> neutralizes "evaporates" rejection. SOUND w/ conditions: per-project scope via ${devcontainerId}; VERIFY feature-native mounts honored on --buildkit never (lace mounts are bind-only, go/no-go); reproducibility regression stance; first-pop/PATH. Superseded 2026-09-11 (frontmatter edited, committed). | 2026-09-12 |
| dispatch | reviewer-B1 | B | cdocs/reviews/2026-09-12-review-of-feature-update-sweep.md | 2026-09-12 |
| dispatch | reviewer-C1 | C | cdocs/reviews/2026-09-12-review-of-claude-code-volume-native-update.md | 2026-09-12 |
| return | proposer-B (resumed) | B | revised 1dea172; relock->--config .lace/; :2 migration dropped; mechanism reframed behavior-neutral; all nits done | 2026-09-12 |
| dispatch | reviewer-B2 | B | cdocs/reviews/2026-09-12-review-of-feature-update-sweep.md (round 2 append) | 2026-09-12 |
| return | reviewer-B2 | B | ACCEPT (e4b589c). B propose-revise complete. | 2026-09-12 |
| return | reviewer-C2 | C | ACCEPT (be8773c). | 2026-09-12 |
| return | proposer-C (cleanup) | C | 2ba48a8; cosmetic nits folded; terminal frontmatter state:deferred status:implementation_ready. **C COMPLETE.** | 2026-09-12 |
| dispatch | reporter-D | D | cdocs/reports/2026-09-12-lace-self-update-cofeature.md | 2026-09-12 |
| dispatch | impl-B1 | B | Phase 1 only (verify preconditions; prepare claude-code bump; NO push, NO relock) | 2026-09-12 |
| return | impl-B1 | B | Phase 1 DONE. All 4 consumers lock claude-code at same stale digest sha256:95eabba1… v1.0.1; .lace/ authoritative+clean everywhere (up.ts:1677-1679 verified). claude-code bump 1.0.1->1.0.2 committed LOCALLY e84b45b (NOT pushed). N8: nvim/blesh/fzf all have upstream updates but recommend LEAVE (behavior-neutral); optional fzf 0.74.4 via blesh republish. weftwise .devcontainer/ divergence confirmed (portless 1.0.1 vs .lace/ 1.0.0 — leave .devcontainer alone). clauthier/weftwise dirty in unrelated runtime/untracked files only (locks clean). GHCR workflow confirmed. No blockers. | 2026-09-12 |

### B GO-PLAN (verified, awaiting user go before outward mutation)
- **Phase 2 (GATED push):** push e84b45b to lace main -> release workflow republishes claude-code, advances :1 off sha256:95eabba1…. Verify green + new :1 digest.
- **Phase 3 relock (order jif->whelm->clauthier->weftwise), always `devcontainer upgrade --config <repo>/.lace/devcontainer.json`:**
  - jif: /var/home/mjr/code/weft/jif/main (portless already 1.0.1, no-op there)
  - whelm: /var/home/mjr/code/apps/whelm (portless 1.0.0->1.0.1 in-major pickup [N6])
  - clauthier: /var/home/mjr/code/weft/clauthier/main (no portless)
  - weftwise: /var/home/mjr/code/weft/weftwise/main (portless 1.0.0->1.0.1 [N6]; GATED on final-confirm + portless sign-off [N7])
  - Overseer performs relocks (cross-repo); commit ONLY .lace/devcontainer-lock.json per repo (don't sweep dirty files); do NOT push consumer repos (their git flow).
- **Phase 4 verify:** cold scratch build jif + weftwise w/ throwaway project name (port-ledger NOTE); podman ps before/after proves no running container restarted.

### B EXECUTION RESULTS (2026-09-12) — SWEEP COMPLETE
- **Phase 2 PUSHED + PUBLISHED:** pushed lace main fa37646..a766e2c (origin git@github.com:weftwiseink/lace.git). Release workflow run 34700219344 = SUCCESS (21s). Republished claude-code:1 (1.0.2, sha256:cb42292a…) + blesh:1 (1.1.1, fzf 0.74.4, sha256:76308887…). Auto docs PR opened by workflow (README regen; user can merge at leisure).
- **Phase 3 RELOCKED all 4** via `devcontainer upgrade --workspace-folder <r> --config <r>/.lace/devcontainer.json`. KEY FINDING: `.lace/` is GITIGNORED in consumers (jif .gitignore:2 `.lace/`) — locks are LOCAL untracked artifacts, so NO commits/pushes needed; on-disk relock is exactly what `lace up` reads. Results (all 4): claude-code 1.0.1->1.0.2 @cb42292a; blesh 1.1.0->1.1.1 @76308887; portless 1.0.0->1.0.1 on whelm+weftwise (jif already 1.0.1; clauthier no portless). Also in-major re-resolved upstream git/node/sshd/bash-history (expected).
- **Phase 4 VERIFIED:** dry-run + real relock confirmed new digests in all 4 .lace locks. `podman ps` before/after IDENTICAL (whelm/jif/clauthier/weftwise/dioxus all same CreatedAt) => NO container restarted. weftwise NOT rebuilt (per user). Cached claude package updates only on each consumer's next rebuild (installs latest-at-build).
- Evidence files: /tmp/claude-1000/*podman-before.txt, podman-after.txt, jif-dryrun-stderr.txt, relock-*.log.

### USER GO (2026-09-12)
- Relock ALL FOUR incl weftwise. Constraint: do NOT rebuild weftwise now (would interrupt other work). Other containers may be rebuilt (user's choice, not part of sweep). Relock != rebuild, so weftwise relock is fine.
- ALSO bump fzf 0.74.3->0.74.4 (blesh feature republish + relock picks it up). nvim/ble.sh still LEAVE.
- Clarified to user: relock only rewrites lock; cached claude package updates only on each consumer's next REBUILD (installs latest-at-build), then re-freezes. weftwise unchanged until user rebuilds it later.
- Execution split: impl prepares code bumps (local commits, no push); OVERSEER pushes lace main + performs cross-repo relocks + commits .lace lock per repo (no consumer push). Phase 4 = lock-diff + podman ps (no forced rebuild); optional throwaway-project scratch build offered.

### Workstream status snapshot (2026-09-12)
- A: DONE (report). B: proposal accepted -> iterate Phase 1 dispatched (impl-B1). C: DONE (accepted design, deferred on go/no-go). D: report dispatched (reporter-D).
- B iterate is GATED: Phase 1 (safe: verify lock authority per consumer, whelm/repo locations+cleanliness, neovim/blesh currency; prepare bump). Phases 2-4 (GHCR publish push + cross-repo relock + weftwise) require overseer execution (cross-repo) + USER GO before first outward mutation. Carry nits N6/N7/N8.
| return | proposer-C (resumed) | C | revised a68dd9b; supersession removed (2026-09-11 back to live/implementation_ready w/ primary-fallback NOTE); all 5 nits done | 2026-09-12 |
| dispatch | reviewer-C2 | C | cdocs/reviews/2026-09-12-review-of-claude-code-volume-native-update.md (round 2 append) | 2026-09-12 |

### C review rounds
| round | reviewer | verdict | notes |
|-------|----------|---------|-------|
| 2 | reviewer-C2 (opus, fresh) | accepted | be8773c. B-1 resolved; docs mutually consistent; 5 nits folded. 2 cosmetic residual nits (R2-N1 "trilemma" mislabel; R2-N2 flip-statement repeated 3x). **C propose-revise COMPLETE.** |
| 1 | reviewer-C1 (opus) | revision_requested | e95df16. Sole blocker B-1: premature supersession (can't supersede npm while depending on it as fallback). Go/no-go INDEPENDENTLY CONFIRMED: lace passes feature `mounts` through untouched (mounts.ts bind-only, up.ts doesn't inline/strip registry-feature mounts); residual CLI+podman live-honoring untestable statically (correctly flagged). Facts doc-confirmed. Reproducibility regression acceptable. 5 nits. |

#### C Round 1 blocker + directed fix
Resume proposer-C to: (1) revert premature supersession — make volume PRIMARY-but-go/no-go-blocked and keep npm (2026-09-11) as ACCEPTED FALLBACK, both LIVE; flip npm->superseded only AFTER the feature-mount passthrough is empirically verified on the --buildkit never/podman path. Fix 2026-09-11 frontmatter: remove superseded_by, set state:live status:implementation_ready (its prior accepted state), rewrite the NOTE from "superseded" to "primary/fallback pairing pending go/no-go". (2) Nits N1 (name podman in go/no-go), N2 (state auto-update XOR exact-reproducibility triangle), N3 (BLUF "a verified passthrough" reads as done), N4 (launcher persistence: mounting over ~/.local/bin shadows contents), N5 (mark migrate-installer author-cited).

### B review rounds
| round | reviewer | verdict | notes |
|-------|----------|---------|-------|
| 2 | reviewer-B2 (opus, fresh) | accepted | e4b589c. B1+B2 resolved; .lace/ authority verified (up.ts:1677-1679); behavior-neutral. **B propose-revise COMPLETE.** Impl-carry nits: N6 (report portless whelm/weftwise as intentional in-major change), N7 (gate weftwise relock on portless-workstream sign-off, fold into weftwise final-confirm), N8 (actually do the neovim/blesh currency check, don't default to leave). |
| 1 | reviewer-B1 (opus) | revision_requested | d82cd9e. 2 blockers. |

#### B Round 1 blockers + directed fix
Resume proposer-B to:
1. **Relock target fix (systemic):** relock via `devcontainer upgrade --config <consumer>/.lace/devcontainer.json` (NOT bare `--workspace-folder`, which hits `.devcontainer/`). lace builds with `--config <consumer>/.lace/devcontainer.json` (up.ts:1679), so `.lace/devcontainer-lock.json` is authoritative. Add Phase-1 step confirming which lock each consumer's build consumes; standardize on `.lace/`. This also resolves the weftwise dual-lock (symptom of this bug; stale `.devcontainer/` lock becomes legacy cruft).
2. **Defer lace-fundamentals :1->:2 ENTIRELY** to a future SSH-decoupling workstream (out of scope for shallow sweep; :2 drops sshd from clauthier/whelm/weftwise). Reframe the sweep as: republish claude-code (new digest so @latest re-resolves at publish), then relock consumers' `.lace/` locks, which re-resolves EVERY feature's floating `:N` major tag to newest digest WITHIN the same major (sweeps up portless durability fix, fundamentals-within-:1, etc.) with NO major-version change. Make this "relock re-resolves all floating majors" explicit.
3. Nits: claude-code is an overridable `version` option defaulting to latest (not hard @latest pin); state that Phase-4 must prove the WARM-cache layer-bust (the real scenario), not just cold scratch build; note portless staleness (whelm/weftwise on feature 1.0.0 pre-1.0.1) is picked up by the relock naturally; downgrade GHCR push auth from blocker (workflow has packages: write, portless cites green run).

### Concurrency / single-writer notes
- No file overlap: A and B and C write distinct docs. C is design-only (no feature-source edits), so it does not collide with B's later implementer (which edits feature source + consumer locks).
- 2026-09-11 proposal frontmatter: only C may touch it (to mark `evolved` on accept). B does not.

## Phase 2 (original create-time-hook iterate): PARKED

Superseded by the arc above pending workstream C.

## ARC COMPLETE (2026-09-12)

| WS | Outcome |
|----|---------|
| A | Report done (c0e2d4d). Stay on legacy builder; migration not-yet-viable (buildah#6503 open) and orthogonal to the version freeze. |
| B | **DONE + implementation_accepted (R3 review 3708e4e).** Published claude-code 1.0.2 + blesh 1.1.1 (fzf 0.74.4); relocked all 4 consumers' local `.lace/` locks; portless 1.0.0->1.0.1 on whelm/weftwise. No container restarted; weftwise not rebuilt. |
| C | Accepted design (be8773c/2ba48a8), `state: deferred` on the go/no-go. npm create-time-hook (2026-09-11) stays accepted live fallback. |
| D | Report done (5fc5470): defer the self-update framework; only claude-code benefits; recommend a narrow /cdocs:rfp later. |

### Open / optional follow-ups (user's call)
- **Go/no-go test** gating C impl: does `devcontainer up --buildkit never --docker-path <podman>` honor a feature-native named-volume `mounts` entry? Empirically untested.
- Optional `/cdocs:rfp` for `lace-update-features` (aggregator in lace-fundamentals; drop-in /usr/local/share/lace/autoupdate.d/<id>).
- Auto docs PR from release workflow (README regen) — merge at leisure.
- weftwise legacy `.devcontainer/` lock cruft — optional cleanup.
- Cached Claude in jif/whelm/clauthier updates on their next rebuild; weftwise on user's later rebuild.

## Handoff (as of 2026-09-12, mid-arc)

### Completed
- Create-time-hook full-send: proposal accepted R2, then PARKED (superseded pending C). Artifact review delivered to user.
- Workstream A (legacy-builder report): DONE. Verdict not-yet-viable + orthogonal to freeze. Stay on legacy builder.
- Workstreams B & C: proposals authored, each got R1 review = revision_requested, revisions dispatched.

### Decisions Made
- Arc of 4 workstreams (A done, B full-send, C propose-revise, D report conditional-on-C).
- B is the SHALLOW sweep (relock re-resolves floating majors; NO :major changes; fundamentals :2 deferred to SSH-decoupling workstream). Publish+sweep authorized by user; weftwise last + final-confirm.
- C volume design is primary-but-go/no-go-blocked (feature-mount passthrough on --buildkit never/podman UNVERIFIED); npm (2026-09-11) stays accepted FALLBACK, live/implementation_ready; supersede npm only after go/no-go verified.
- Model: opus all workstreams.

### Open Todos / In-flight (resume via SendMessage to these live specialists)
- proposer-B (ab93ea3): revising sweep proposal per B1/B2. On return -> dispatch FRESH reviewer-B2.
- proposer-C (a41d128): revising volume proposal + reverting 2026-09-11 frontmatter. On return -> dispatch FRESH reviewer-C2.
- After B accept -> B enters iterate (implement sweep: republish claude-code, relock consumers' .lace/ locks). Cross-repo/GHCR steps route to overseer (un-isolated); weftwise final-confirm with user.
- After C accept -> dispatch workstream D report (self-update co-feature: volume-backed per-feature `autoupdate` + `lace-update-features` aggregator in lace-friendly-feature). C verdict already sound, so D is a go on C accept.
- Open technical gate for any future volume implementation: empirically verify feature-native named-volume mount honored on `devcontainer up --buildkit never --docker-path <podman>`.
