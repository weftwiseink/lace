---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T14:05:00-07:00
task_list: weftwise/parallel-feature-development/review
type: review
state: live
status: wip
tags: [fresh_agent, round-1, architecture, test_plan, edge_cases, portless, worktree, postCreateCommand]
---

# Review of "Streamlined Parallel Feature Development for Weftwise" (Round 1)

> BLUF(opus/weftwise-parallel-dev/review): The proposal is well-structured, well-cited, and selects a defensible C+D approach from a thorough design-space report.
> However, there is one **blocking implementation issue** the design glosses over: `mergePostCreateCommand` at `workspace-layout.ts:218-252` is hard-coded to write a single `lace:workspace` key and short-circuits on subsequent calls (line 247 `if (!("lace:workspace" in obj))`), so the proposed sequence of two merges (safeDirectory then installDeps) will silently drop the second command in the object-shaped `postCreateCommand` case.
> A second material gap is that the proposal asserts portless will set `PORT=<allocated>` and expects weftwise's relaxed `vite.config.ts` to honour it, yet the portless architecture report explicitly notes vite is among the frameworks that *ignore* the `PORT` env var and require a CLI flag injection - the interaction between portless's framework-flag injection and the proposed config relaxation is undocumented and the proposal should not assume both work together without verification.
> Edge case E2 (worktrees added post-create) is the structural caveat the BLUF should acknowledge: the user-facing pitch ("`lace up`, then `portless ... pnpm dev`") only holds when all worktrees exist before `lace up`; the common "add a worktree mid-session" flow still requires a manual install step.
> Verdict: **Revise** with a small number of concrete fixes.
> No fundamental redesign required; the C+D selection is sound.

## Summary Assessment

The proposal builds cleanly on the companion report's four-candidate solution space and correctly identifies C+D as the only combination that addresses the **concurrent-worktree** primary goal.
The design surface is small (one lace flag, one feature reference, one vite line, one mount declaration), the citations are largely accurate, and the test plan mirrors a known-good empirical methodology (the legacy-builder experiment).

Two issues block acceptance without revision:

1. The `mergePostCreateCommand` extension required to compose `safeDirectory` and `installDeps` under `lace:workspace` is not actually free; the existing function rejects the second merge in the object-shaped branch.
2. The proposal does not address how the existing portless CLI flag injection for Vite (per `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md` line 208) interacts with the proposed `vite.config.ts` relaxation.

A handful of non-blocking gaps (multi-service worktree semantics for the sync-server on 42069, the legacy-builder migration sequencing, pnpm version split-brain in postCreateCommand) are worth tightening but do not require a redesign.

## Section-by-Section Findings

### Frontmatter and BLUF

- **Non-blocking:** Frontmatter is valid against `frontmatter-spec.md`. `status: review_ready` is appropriate.
- **Non-blocking:** The BLUF is dense but accurate at the technical level.
  It does, however, oversell the user experience: the "single-command, conflict-free flow" framing elides E2 (worktrees added after container creation, which still need manual install).
  Recommend adding one short clause to the BLUF acknowledging the post-create-worktree seam.

### Objective and desired user flow

- **Non-blocking:** The three friction sources are accurately characterised against the verification devlog's Findings 1 and 3.
- **Non-blocking:** The example user flow is concrete and runnable.
- **Non-blocking:** The desired user flow lists three `portless ... pnpm dev &` invocations.
  The `&` is a small UX detail; recommend noting that portless route registration is fast enough that backgrounding is optional, and that interactive tab-per-worktree (wezterm panes per the user's normal flow) is the actual expected pattern.

### Background and "Existing primitives this proposal reuses"

- **Non-blocking:** Citations to `project-name.ts`, `template-resolver.ts:226-268`, `port-allocator.ts:96-193`, `workspace-layout.ts:82-209`, and `workspace-layout.ts:218-252` all verify against the source.
  The line range for `injectForPrebuildBlock` is correct (`template-resolver.ts:226-268`).
- **Blocking (later section):** The `mergePostCreateCommand` reference at `workspace-layout.ts:218-252` is correctly located, but the proposal mischaracterises its behaviour - see findings on Part 2 below.

### Proposed Solution: Part 1 (Portless adoption)

- **Blocking:** The vite config relaxation section assumes that setting `port: Number(process.env.PORT ?? 3000)` is sufficient for portless's port allocation to take effect on a vite dev server.
  However, the portless architecture report explicitly states (line 208) that portless's CLI launcher injects **framework-specific CLI flags** for "Vite, Astro, and Angular which ignore the PORT env var."
  Two possibilities exist:
  - (a) Portless injects `--port <allocated>` via CLI flag, in which case the vite.config.ts change is redundant (the flag wins).
  - (b) Portless injects only `PORT=<allocated>` and the proposed config change is the necessary bridge, in which case the architecture report's claim about CLI flag injection is outdated.
  The proposal does not establish which is true.
  This must be verified empirically against the actual portless binary before Phase 2 lands.
  If (a), Phase 2 may be a no-op; if (b), the proposal should cite the test that confirmed it.
- **Non-blocking:** The NOTE about coexistence with the legacy-builder migration is well-placed and correct: portless is reachable from either `features` or `prebuildFeatures` slots.
- **Non-blocking:** The user-facing surface (README, lace-into banner, "use the host URL printed by portless") is appropriate.

### Proposed Solution: Part 2 (`installDeps` flag)

- **Blocking:** The proposal states that `mergePostCreateCommand` "already handles the array/object/string variations of the existing `postCreateCommand` shape" and that the new command "becomes an additional entry alongside `lace:workspace`'s existing `safeDirectory` injection."
  Reading the function at `workspace-layout.ts:218-252`, this is not quite accurate.
  The function's object branch (lines 245-251) checks `if (!("lace:workspace" in obj))` and only writes the key if absent.
  In the proposal's intended flow, `applyWorkspaceLayout` first calls `mergePostCreateCommand` with the `safeDirectory` command (line 167-172), which writes `lace:workspace` to the object.
  A subsequent call with the install loop command then hits the `"lace:workspace" in obj` guard and **silently drops the install command**.
  The proposal needs either:
  - (a) A modification to `mergePostCreateCommand` to compose multiple lace-injected commands under `lace:workspace` (e.g., via `&&` joining, or via distinct keys `lace:workspace:safe-directory` and `lace:workspace:install`).
  - (b) A redesign that emits a single combined command from `applyWorkspaceLayout` rather than two `mergePostCreateCommand` calls.
  This is a small fix but it is load-bearing for Phase 1 and must be specified explicitly.
- **Non-blocking:** The shell-loop literal (`for d in "${MOUNT_TARGET}"/*/; do ... done`) needs more defensive checks than the proposal shows.
  The loop excludes `.bare` but does not exclude `.lace/`, `.git`, `.pnpm-store/`, `.worktree-root` (the nikitabobko marker file).
  Recommend adding a robust filter: any sibling that is not a worktree directory should be skipped.
  The host-side `.pnpm-store/` mount target lives under the bare-repo root and will be visible to the loop; iterating it is harmless (`[ -f $d/package.json ]` filters it out) but the `pnpm install --frozen-lockfile` call against `/pnpm-store` would fail loudly if a stray `package.json` ever appeared there.
- **Non-blocking:** `command -v pnpm >/dev/null 2>&1 || exit 0` is mentioned in Open Questions but not in the Phase 1 command literal.
  Add it to the canonical command spec.
- **Non-blocking:** The command literal does not specify whether the install loop runs as `root` or `node`.
  `postCreateCommand` runs as the `remoteUser` (`node`), which is correct, but worth stating to remove ambiguity for the implementer.

### Proposed Solution: Part 3 (Bind-mount `.pnpm-store/`)

- **Non-blocking:** The `recommendedSource: "${localWorkspaceFolder}/../.pnpm-store"` resolution is correct given weftwise's host layout (`/home/mjr/code/weft/weftwise/.pnpm-store/` is one level up from `main/`).
- **Non-blocking:** E5 captures the uid alignment caveat reasonably.
  Worth noting that on rootless podman with user namespacing, the inside-container uid may NOT match host uid 1000 by default (podman maps to a sub-uid range).
  This may break the "permissions usually line up" assumption.
  If the implementer hits this, the workaround is `:U` on the mount (chown on mount) or a userns mapping configured in `runArgs`.
  This is worth a NOTE in E5 rather than a blocking concern, since the user's environment-specific behaviour will surface in Phase 5.

### How the three parts compose

- **Non-blocking:** The composition table is clear.
  The row "Subsequent `lace up` runs / No-op for containers and installs" is accurate only if `postCreateCommand` is genuinely not re-run by the devcontainer CLI on a no-op `lace up`.
  This is true for the current devcontainer behaviour but is worth pinning down with a test, since this is the entire reason `postCreateCommand` was chosen over `updateContentCommand` (per D2).

### Important Design Decisions D1-D7

- **Non-blocking:** D1 (portless over A) is well-argued.
  The "one wrapper word" framing is the right honest cost statement.
- **Non-blocking:** D2 (postCreate over updateContent) is sound.
  The NOTE acknowledging the idempotency-probe future is appropriate.
- **Non-blocking:** D3 (flag, not always-on) is correct given the schema breadth lace serves.
- **Non-blocking:** D4 (pnpm-only initial scope) is honest.
  The reserved schema `installDeps: "auto" | "pnpm" | "npm" | "yarn" | true | false` is forward-looking; recommend documenting in the schema comments that `true` is an alias for `"pnpm"` to avoid future breaking changes.
- **Non-blocking:** D5 is sensible.
- **Non-blocking:** D6 (naming convention) is the right place to surface multi-service worktree semantics.
  However, the proposal under-specifies the sync-server case: weftwise's sync-server on port 42069 is reached via the renderer at `/sync`, but D6 only addresses what happens if a future workflow exposes the sync-server directly to the host.
  The companion report's Q3 calls out that the sync-server is currently reached as an internal route, which is fine, but the proposal should explicitly say "the sync-server is NOT a portless route in this proposal's scope; its host exposure is follow-up work" rather than leaving it as a soft "if a future workflow."
- **Non-blocking:** D7 is appropriately deferred.

### Stories

- **Non-blocking:** Story 1 (cold start, single worktree) is accurate.
  Step 2 ("npm install of portless@latest") is correct but pins to "latest" - recommend the proposal note this as a deliberate choice and consider whether portless should be version-pinned (the companion report flags this as a release-management thread).
- **Non-blocking:** Story 2 (add worktree to running container) correctly surfaces the E2 seam.
  This is the strongest place to acknowledge the BLUF caveat.
- **Non-blocking:** Story 3 (existing weftwise installation adopts proposal) explicitly notes `appPort: [3000]` may coexist; see findings on E7 below.

### Edge Cases

- **Non-blocking:** E1 (hostname) is cosmetic; well-scoped out.
- **Blocking:** E2 (worktrees added after container creation) is the most material edge case.
  The proposal correctly flags it as an explicit non-goal, which is fair, but the **BLUF and Objective do not surface this caveat**.
  A reader who only reads the BLUF would conclude that the post-`lace up` flow handles arbitrary worktree additions.
  Recommend explicit BLUF acknowledgement: "Worktrees added after `lace up` require a one-time manual `pnpm install` per worktree (with the store mount, ~2.5s)."
  This is the kind of deviation the writing conventions explicitly require to be surfaced front-and-center.
- **Non-blocking:** E3 (portless config persistence) is correct.
- **Non-blocking:** E4 (pnpm version split-brain) is correctly resolved: `postCreateCommand` runs in a non-interactive shell, so corepack routes pnpm via `packageManager` correctly.
  The proposal should test this empirically in Phase 5 rather than asserting it, since the verification devlog Finding 4 specifically called out this as confusing for debugging.
- **Non-blocking:** E5 (pnpm-store permissions) - see Part 3 finding above; recommend a stronger NOTE for rootless podman userns.
- **Non-blocking:** E6 (multi-server per worktree) is clean.
- **Blocking (minor):** E7 (coexistence with `appPort: [3000]`) is technically correct - both mappings coexist at the docker level - but the recommendation ("keep `appPort: [3000]` during the migration period") is at odds with the test-plan success criterion that lists `<lace-allocated>:1355` AND `22425:22425` as the expected port mappings, without mentioning `3000:3000`.
  Either the test plan should include `3000:3000` as an expected mapping during the migration window, or the recommendation should be tightened: "remove `appPort: [3000]` once portless is the established workflow."
  As written, the test plan and the recommendation contradict each other.
- **Non-blocking:** E8 (`--rebuild` required) is accurate per the verification devlog's 2026-05-13 update.

### Test Plan

- **Non-blocking:** Unit test list (5 cases) is appropriate.
  Add a test for the `mergePostCreateCommand` composition issue identified above (assert that both `safeDirectory` and `installDeps` end up in the final config, in whatever shape the fix uses).
- **Non-blocking:** Integration test (portless + workspace scenario) is well-scoped.
  Recommend adding an assertion about the `lace:workspace` key shape (single string vs object with sub-keys), to lock in the fix from the Part 2 finding.
- **Non-blocking:** Empirical end-to-end measurement matrix is concrete and follows the legacy-builder experiment shape.
  Two missing measurements:
  - **Portless route registration latency under load:** what happens if three `portless web.<n> pnpm dev` invocations are launched in rapid succession?
    The companion report notes portless uses an `mkdir`-based filesystem mutex with 10s stale timeout and 20 retries at 50ms.
    The first invocation should be sub-second; later ones may serialize.
    Worth a measurement so the user knows what to expect.
  - **`PORT` env var honouring:** an explicit test that confirms vite binds the portless-allocated port (4000-4999), not 3000.
    This is the empirical answer to the Part 1 blocking question about CLI flag injection vs env-var honouring.
- **Non-blocking:** The "cold `.pnpm-store/`" measurement is good.
  Recommend pinning the cold-store budget more tightly than "≤ first-time pnpm install on bare metal × 1.5"; that is a hard number to measure objectively.
  A concrete number (e.g., "under 180s for 3 worktrees") would be easier to evaluate.

### Verification Methodology

- **Non-blocking:** The phase-by-phase verification is well-structured.
  Step 3's check "`podman exec weftwise portless --version`" is concrete and verifiable.
- **Non-blocking:** Recommend adding "Verify `mergePostCreateCommand` actually emits both commands" to Phase 1's verification (per the Part 2 finding).

### Implementation Phases

- **Non-blocking:** Phases 1, 2 parallel is sensible.
  Phase 3 depends on 2 (vite relaxation must precede portless adoption test) - this dependency is correctly stated.
  Phase 4 depends on 1 (lace flag must exist before weftwise opts in) - also correct.
- **Blocking:** Phase 1's "Files to modify" enumeration omits the change to `mergePostCreateCommand` needed to fix the composition bug identified above.
  Either Phase 1 must include a modification to `mergePostCreateCommand`, or Phase 1's "install loop merge logic" must be implemented in a way that doesn't conflict (e.g., emit a single string that runs `safeDirectory && install-loop`).
- **Non-blocking:** The proposal's claim that "phases are mostly independent" is roughly true but worth tightening: Phases 1 and 2 are independent of each other; Phases 3 and 4 each depend on prior phases; Phase 5 (validation) is by definition serial.
  A separate-implementer-per-phase model works for 1 and 2; 3 and 4 should be done by whoever did 2 and 1 respectively, since they touch the same files.

### Open Questions

- **Non-blocking:** All five questions are well-framed.
  Q4 (cross-project portless route collision) is correctly answered.
  Q5 (mount path for non-bare-worktree layouts) is correctly deferred.
- **Non-blocking:** A missing open question: "What does the proposal expect if the host-side `.pnpm-store/` contains incompatible content (e.g., from a different pnpm major version or a pnpm-store created by a different OS architecture)?"
  This is a real concern when working across host/container architecture splits or when pnpm undergoes a content-addressed store format change.
  Worth at least an Open Question entry; the answer is probably "the user clears the store and rebuilds," but it should be stated.

### Interaction with the in-flight legacy-builder migration

- **Non-blocking:** The NOTE under Part 1 about portless being reachable from either `features` or `prebuildFeatures` is the correct interaction note.
  However, the legacy-builder migration proposal explicitly states (Phase 2 substep 3) that weftwise's six `prebuildFeatures` move to top-level `features`.
  Once that lands, the proposal's instruction to add portless to `prebuildFeatures` will be temporally out of sync.
  Recommend adding sequencing guidance: "If the legacy-builder migration has landed for weftwise by the time this proposal is implemented, portless should be added to `features` (not `prebuildFeatures`).
  Otherwise, add to `prebuildFeatures` and migrate alongside the rest of weftwise's features in the legacy-builder workstream."
  As written, the proposal documents both paths but does not commit to one based on the actual migration state.

## Verdict

**Revise.**

Two blocking issues require concrete fixes:

1. `mergePostCreateCommand` composition: the function as written silently drops the second `lace:workspace` command.
2. Portless framework-flag injection vs vite config relaxation: the interaction is unspecified, and one of them (the vite change OR the portless flag injection) may be redundant.

Two further blocking-but-small issues:

3. BLUF/Objective should explicitly surface the E2 caveat (post-create worktrees still need manual install).
4. The E7 recommendation contradicts the test plan's expected port mappings.

Beyond these, the proposal is well-considered, the design is the right one given the design-space report, and the test plan is concrete.
The non-blocking suggestions are tightening, not redesign.

## Action Items

1. **[blocking]** Specify how `mergePostCreateCommand` will compose two lace-injected commands under `lace:workspace`.
   Either modify the function (e.g., allow `lace:workspace` to hold an array or `&&`-joined string) or change Phase 1's design to emit a single combined command.
   Add a unit test that asserts both commands land in the final config.

2. **[blocking]** Verify empirically whether portless injects `--port <allocated>` CLI flag for vite, or only `PORT=<allocated>` env var.
   Update Part 1 of the proposal to cite the verification and adjust the vite.config.ts recommendation accordingly.
   If portless's CLI flag injection wins, Phase 2 may be reducible to a no-op or a documentation-only change.

3. **[blocking]** Update the BLUF and Objective to surface E2 (post-create worktrees require manual install).
   The writing conventions are explicit that deviations should not be glossed over; this is a real seam in the user pitch.

4. **[blocking]** Resolve the E7 contradiction.
   Either include `3000:3000` in the test plan's expected port mappings, or tighten the E7 recommendation to "remove `appPort: [3000]` once the workflow is established and replace it with portless before measuring."

5. **[non-blocking]** Add to Phase 1's command literal:
   - `command -v pnpm >/dev/null 2>&1 || exit 0` guard.
   - A robust filter for non-worktree siblings (`.lace`, `.git`, `.pnpm-store`, `.worktree-root`).
   - An explicit note that the loop runs as `remoteUser` (`node`), not root.

6. **[non-blocking]** Strengthen E5 with a NOTE about rootless-podman userns: the host uid/container uid alignment is not guaranteed under user-namespacing.

7. **[non-blocking]** Tighten D6 to explicitly say the sync-server on 42069 is NOT a portless route in initial scope and remains accessible only via the renderer's `/sync` internal route.

8. **[non-blocking]** Add sequencing guidance for the legacy-builder migration interaction: commit to whether portless lands in `prebuildFeatures` (current) or `features` (post-migration) based on the migration state at implementation time.

9. **[non-blocking]** Add two missing empirical measurements:
   - Portless route registration latency under load (3 simultaneous registrations).
   - Explicit "vite binds 4xxx, not 3000" assertion when invoked via `portless`.

10. **[non-blocking]** Add an Open Question for incompatible host-side `.pnpm-store/` content (architecture mismatch, store format change).

11. **[non-blocking]** Replace the "≤ bare-metal × 1.5" cold-store budget with a concrete wall-time number.

12. **[non-blocking]** Add a unit test for `mergePostCreateCommand` idempotency that asserts re-running `applyWorkspaceLayout` does not double-apply the install loop (already mentioned in Test Plan §Unit item 5, but worth pinning to the composition fix from action item 1).

## Questions for the Author (multi-choice)

To help guide the revision, please pick from these options where the proposal underspecifies:

**Q1: `mergePostCreateCommand` composition fix.**
- (a) Modify `mergePostCreateCommand` to accept a `key` parameter (e.g., `lace:workspace:install`) so each lace-injected command gets its own object key.
- (b) Modify `applyWorkspaceLayout` to build a single combined command string (`<safe-directory> && <install-loop>`) and call `mergePostCreateCommand` once.
- (c) Modify `mergePostCreateCommand` to append to the existing `lace:workspace` value (`existing && command`).

**Q2: Portless framework-flag injection.**
Before Phase 2, run `portless web.test pnpm dev` in a throwaway weftwise container WITH the unrelaxed vite config. Report:
- (a) Vite binds 4xxx (portless CLI flag injection works without config change). Phase 2 collapses to documentation.
- (b) Vite binds 3000 and fails (portless does NOT inject CLI flag; config relaxation is required).
- (c) Some other behaviour (document it).

**Q3: Legacy-builder migration sequencing.**
- (a) This proposal lands AFTER the legacy-builder migration; portless goes into top-level `features` from day one.
- (b) This proposal lands BEFORE the legacy-builder migration; portless goes into `prebuildFeatures` and migrates alongside the rest.
- (c) Both authors coordinate on a single PR that does both at once.

**Q4: BLUF caveat phrasing for E2.**
- (a) Add a sentence to the BLUF: "Worktrees added after `lace up` require one manual `pnpm install` per new worktree (~2.5s with store mount)."
- (b) Add a one-line bullet to the Objective section under "desired user flow."
- (c) Leave as-is; E2's Edge Case treatment is sufficient.
  (Recommend NOT (c) per the writing conventions.)
