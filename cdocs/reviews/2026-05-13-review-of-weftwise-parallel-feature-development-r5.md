---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T20:45:00-07:00
task_list: weftwise/parallel-feature-development/review
type: review
state: live
status: done
tags: [rereview_agent, round-5, architecture, portless, host-lifecycle, sysctl, reversibility, test_plan, extractor-fix]
---

# Review of "Streamlined Parallel Feature Development for Weftwise" (Round 5)

> BLUF(opus/weftwise-parallel-dev/review): Round 5 resolves the single round-4 blocker and all eleven non-blocking polish items.
> The Phase 4 extractor branch is now explicit (lines 407-422) with an integration test (line 464) that fails if the branch is omitted.
> Subcommand naming is pinned consistently across the proposal and the decisions report; the Phase 5 matrix gains a wildcard-semantics probe (step 0) and a pnpm/corepack verification (step 4.5); the legacy-builder precondition is acknowledged in a Background NOTE; the BLUF, the mermaid diagram, the Phase 0 TTY behaviour, and the Phase 3 readiness budget are all corrected.
> No new contradictions detected; the proposal is implementation-ready.
> Verdict: **Accept.**

## Summary Assessment

This round is a clean cleanup pass on the round-4 blocker plus eleven micro-fixes.
The author treated the action items as a checklist, and the diffs land in the locations specified by the round-4 review without introducing new drift.

The blocking issue — Phase 4's `extractLaceCustomizations` would silently swallow `hostAlias` unless the extractor was widened in the same change as the interface — is resolved with the right combination of three artefacts:

1. Explicit Step 2 narrative in Phase 4 (lines 407-422) walking the implementer through the extractor narrowing.
2. A code block showing exactly the branch to add (`typeof entry.hostAlias === "boolean" || typeof entry.hostAlias === "string"`).
3. An integration test described in the Tests section (line 464) that **specifically catches the bug**: "if Step 2 above is omitted, the integration test fails because the shellout is never invoked."

This is the right shape for a load-bearing two-step: the proposal explains the trap, the code block patches the trap, and the test enforces the patch.

The eleven non-blocking polish items are all addressed with minimal added prose.
Subcommand naming in particular is now stable across the proposal Phase 0 / Phase 3 / Phase 5 / Open Questions sections and the decisions report's D8 and D10 — the round-4 review identified five locations of drift, and round 5 unifies them on `lace doctor --reset` (runtime state) and `lace doctor --uninstall` (durable state).

## Verification of Round-4 Action Items

| # | Round-4 action | Status in Round 5 | Evidence |
|---|---|---|---|
| 1 | **[blocking]** Phase 4 extractor branch + test catching the bug | **Resolved** | Lines 407-422 (Step 2 narrative + code), line 462 (extractor unit test), line 464 (integration test "specifically catches the extractor bug"). |
| 2 | Pin subcommand naming across five locations | **Resolved** | Proposal lines 181-182, 349, 497, 600 all use `lace doctor --reset` and `lace doctor --uninstall`. Report D8 line 82 uses `lace doctor --reset`; D10 line 109 uses both. No `lace clean --portless` or `lace setup --reverse` remains. |
| 3 | Phase 5 step 0 — wildcard-semantics probe | **Resolved** | Line 485, step 0: synthetic-backend probe via `python3 -m http.server` + two `curl` assertions, with explicit fallback guidance if the second curl returns 404. |
| 4 | Legacy-builder precondition NOTE in Background | **Resolved** | Lines 58-60: `NOTE(opus/weftwise-parallel-dev)` callout in Background explicitly names the legacy-builder migration as a precondition and what to do if it reverts. |
| 5 | Phase 5 step verifying pnpm/corepack routing | **Resolved** | Line 490, step 4.5: in-container `pnpm --version` check, with explicit pass/fail criteria tied to verification devlog Finding 4. |
| 6 | Phase 0 non-interactive TTY behaviour | **Resolved** | Lines 167-171: explicit three-way apply policy (interactive TTY prompt, non-interactive abort, `--yes` flag to bypass). |
| 7 | Phase 0 exit-code typo | **Resolved** | Line 169 reads "abort with exit code 1" — no more "exits 0 with status 1" typo. |
| 8 | `lookupPortDeclaration` clarified as new helper | **Resolved** | Line 438: "this is a NEW helper; it does not exist in lace today." Module location specified (`host-portless-alias.ts`). |
| 9 | Phase 0 port-80 probe bind-address note | **Resolved** | Lines 174-175: `NOTE(opus/weftwise-parallel-dev)` callout instructing the implementer to verify portless's actual bind address. |
| 10 | Mermaid alias-shellout arrow | **Resolved** | Line 100: `H_LACE -- alias --> H_P` added between the spawn arrow and the writes arrow. |
| 11 | BLUF "bundled via pnpm" → "bundled as a runtime dependency" | **Resolved** | Line 19: phrasing updated; no more "via pnpm" in the BLUF. |
| 12 | Phase 3 readiness poll budget bump | **Resolved** | Line 320: "60 retries at 100ms = up to 6s; expose `LACE_PORTLESS_READY_TIMEOUT_MS` for slow-system tuning." |

All twelve items resolved cleanly. No items partially addressed; no items left as carryover.

## Cross-Document Consistency

### Subcommand naming (the round-4 drift target)

Round 4 identified five locations where the reversal/reset command name drifted across `lace doctor --reset`, `lace doctor --uninstall`, `lace clean --portless`, and `lace setup --reverse`.
Round 5 pins both commands consistently:

| Location | Reference | Pinned? |
|---|---|---|
| Proposal Phase 0 line 181 | `lace doctor --reset` (runtime state only) | Yes |
| Proposal Phase 0 line 182 | `lace doctor --uninstall` (durable state only) | Yes |
| Proposal Phase 3 line 349 | `lace doctor --reset` | Yes |
| Proposal Phase 5 step 11 line 497 | both names with their distinct roles | Yes |
| Proposal Open Questions line 600 | both names | Yes |
| Report D8 line 82 | `lace doctor --reset` | Yes |
| Report D10 line 109 | both names with their distinct roles | Yes |

Zero residual drift. `lace clean --portless` and `lace setup --reverse` are gone everywhere.

### Decisions report ↔ proposal alignment

Spot-checked all twelve D entries against their proposal references; no orphans, no contradictions.
The proposal's Background fact 5 + Legacy-builder NOTE (lines 56-60) is consistent with the report's D2 (which references the superseded host-proxy proposal, not the legacy-builder migration; the legacy-builder dependency is purely a proposal-level Background concern).

### Round-4 review action item carryovers

All five round-3 carryovers that round 4 had flagged as "partial" or "not addressed" are now fully addressed in round 5:

- R3 action #2 (wildcard probe) → Phase 5 step 0.
- R3 action #6 (legacy-builder precondition NOTE) → Background NOTE.
- R3 action #9 (pnpm corepack verification) → Phase 5 step 4.5.

The two non-addressable R3 items (R3 action #3 docs pinning, R3 action #10 interactive panes note) remain intentional design choices the proposal has incorporated differently (lace doctor UX absorbs the docs concern; `exec portless ... pnpm dev` already works in interactive panes without explicit acknowledgement).

## Section-by-Section Findings

### BLUF and Frontmatter

- **Non-blocking:** BLUF (lines 19-22) is three sentences, scannable, accurate, and the "bundled as a runtime dependency" wording is now precise.
- **Non-blocking:** Frontmatter shows `last_reviewed.round: 4` from round 4; this review updates it to round 5.

### Background

- **Non-blocking:** The new NOTE callout at lines 58-60 cleanly handles the legacy-builder precondition without re-rendering it in the main flow. Phrasing is forward-looking ("If for any reason the migration is reverted before this proposal lands…") and tied to a specific PR-level remediation.
- **Non-blocking:** Five load-bearing facts framing remains. Fact 5's wording ("the legacy-builder migration landed") is now reinforced by the NOTE.

### Proposed Solution

- **Non-blocking:** The Mermaid diagram now shows three host-side arrows from `H_LACE`: spawn, alias, writes. The visual matches the "four moving pieces" narrative; the only piece the diagram does not visualise is the preflight check itself (since preflight runs before the diagram's depicted steady state, this is fine).

### Phase 0

- **Non-blocking:** The apply policy (lines 167-171) is well-factored as a three-bullet table: interactive default to "No", non-interactive without `--yes` aborts, `--yes` skips the prompt. This matches the recommended (a) shape from round-4 Q4.
- **Non-blocking:** The exit-code typo (round-4 line 162 "exits 0 with status 1") is corrected on line 169 to "abort with exit code 1."
- **Non-blocking:** Port-80 probe bind-address NOTE on lines 174-175 is the right shape: defer to implementation-time verification of portless's actual default.
- **Non-blocking:** Reversibility section (lines 179-193) cleanly separates runtime state from durable state with the pinned subcommand names.

### Phase 3

- **Non-blocking:** Readiness poll budget on line 320 is now 6s (60×100ms) with `LACE_PORTLESS_READY_TIMEOUT_MS` env var as the escape hatch. This addresses the round-4 concern about slow-system variance.
- **Non-blocking:** All other Phase 3 content unchanged from round 4 (which was already non-blocking).

### Phase 4

- **Non-blocking:** Step 1 / Step 2 framing at lines 391-422 is the right pedagogical structure. The implementer reads "Two distinct code locations must both be updated; missing either silently drops the new field" and immediately sees the explicit code for both locations.
- **Non-blocking:** Line 422: "Without Step 2, every `hostAlias: true` from feature manifests is dropped before the allocation loop sees it, and Phase 4 silently does nothing." This is precisely the round-4 blocking concern made explicit in-proposal.
- **Non-blocking:** Test list (lines 458-466) covers schema, extractor, helper, shellout, integration, and end-to-end. The integration test description on line 464 explicitly calls out the extractor-bug-catching property: "if Step 2 above is omitted, the integration test fails because the shellout is never invoked."
- **Non-blocking:** Acceptance criterion (line 467) names both the interface widening AND the extractor branch. Belt and braces.
- **Non-blocking:** `lookupPortDeclaration` is correctly disambiguated as a new helper on line 438.

### Phase 5

- **Non-blocking:** New step 0 (line 485) is a concrete, executable two-curl probe with explicit pass/fail semantics. If `--wildcard` semantics turn out to be unregistered-subdomain fallback rather than suffix matching, this step surfaces it before any of the worktree-level dependencies kick in. Excellent.
- **Non-blocking:** New step 4.5 (line 490) threads the pnpm/corepack verification into the matrix. The criterion ties directly to verification devlog Finding 4, so the implementer knows what "wrong" looks like.
- **Non-blocking:** Preconditions note (line 479) for step 9 is helpful: makes whelm's portless adoption explicit rather than an implicit dependency.
- **Non-blocking:** Step 11 reversal uses the pinned subcommand names.

### Open Questions

- **Non-blocking:** Q4 (lines 600-601) now uses both pinned names ("`lace doctor --reset` and `lace doctor --uninstall`"). The answer matches the in-scope-as-stubs treatment from Phase 0.

### Summary, References

- **Non-blocking:** All references resolve cleanly. The Phase 0 file list, Phase 3 file list, and Phase 4 file list are internally consistent.

### Writing Conventions

Spot checks:

- Sentence-per-line: preserved throughout. No paragraph-style packing introduced in this round.
- Brevity: each new addition (NOTE callouts, step 0, step 4.5, env-var mention) is succinct and pulls its weight.
- History-agnostic: the legacy-builder NOTE on lines 58-60 is the one place that arguably narrates history ("If for any reason the migration is reverted before this proposal lands"); this is correctly placed in a NOTE callout per the convention, not in the main flow.
- Em-dash usage: spot-checked; the document uses colons and commas for qualifying statements, with sparing ` - ` hyphens (e.g., line 17 BLUF). Compliant.
- Emojis: none added.

## Verdict

**Accept.**

The single round-4 blocker is resolved with three reinforcing artefacts (narrative, code, test). All eleven non-blocking polish items are addressed without introducing new drift. The proposal is implementation-ready.

Recommendation: bump proposal `status: implementation_ready` on accept.

## Action Items

(No remaining action items for the author.)

1. **[non-blocking, optional]** Consider whether step 4.5's verification of corepack-routed pnpm should also assert no `engine-strict` warnings in the install logs; this is a finer-grained check than the version-string assertion. Not required for accept.
2. **[non-blocking, optional]** The Phase 5 step 0 wildcard probe spawns `python3 -m http.server` backgrounded; the matrix does not specify cleanup of the synthetic backend. Suggest `kill %1` or `pkill -f "http.server 18099"` as a teardown so subsequent steps don't see a stale listener. Not blocking.
3. **[non-blocking, optional]** The `LACE_PORTLESS_READY_TIMEOUT_MS` env var is mentioned only in the Phase 3 narrative; consider surfacing it in the proposal's Open Questions or References for discoverability. Not required.

## Questions for the Author (multi-choice, non-blocking)

**Q1: Step 0 cleanup.**

The Phase 5 step 0 spawns `python3 -m http.server 18099 &` but does not specify cleanup. Pick one:

- (a) Add explicit `kill %1` / `pkill` instruction at end of step 0. Recommended for matrix re-runnability.
- (b) Leave as-is; the validation devlog captures the run once and step 0 stale backends are tolerable.
- (c) Move step 0 to a separate "pre-flight probe" subsection so its teardown is documented alongside.

**Q2: `LACE_PORTLESS_READY_TIMEOUT_MS` discoverability.**

The env var lives only in Phase 3 prose. Pick one:

- (a) Leave as-is; implementers will find it via grep.
- (b) Add a one-line mention in Open Questions or the Phase 3 acceptance criteria.
- (c) Add a small "Environment Variables" subsection at the proposal level summarising all env vars (also `PORTLESS_WILDCARD=1`).
