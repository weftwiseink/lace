---
review_of: cdocs/proposals/2026-03-18-rebuild-cascading-and-config-drift.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-19T00:00:00-07:00
task_list: lace/devcontainer-lifecycle
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, cli_verification]
---

# Review: Fix `--rebuild` Cascading and Add Config Drift Detection

## Summary Assessment

The proposal correctly identifies and addresses a real bug where `lace up --rebuild` silently fails to recreate the container.
Phase 1 is well-scoped, low-risk, and directly solves the reported issue.
Phase 2 (config drift detection) is a sound design with a reasonable fingerprinting approach.

The most important finding is that `--remove-existing-container` is confirmed as a valid `devcontainer up` flag, resolving the proposal's primary open question.
Two blocking issues: the `--rebuild` CLI description needs updating (it currently says "prebuild image" only), and the fingerprint's JSON key ordering must be specified to avoid false positives.

Verdict: **Revise** on two blocking items, then this is ready for implementation.

## Section-by-Section Findings

### BLUF / Summary

Clear and accurate.
No issues.

### Objective

Well-defined.
The three goals (fix `--rebuild`, detect drift, improve `wez-into`) are appropriately scoped.

### Background

The reference to the companion report is useful.
The claim about Docker container env immutability is correct and well-stated.

### Proposed Solution: Phase 1

**[blocking] The `--rebuild` flag description in `commands/up.ts:57-58` currently reads "Force rebuild of prebuild image (bypass cache)".**
After this change, `--rebuild` will also remove the existing container.
The description must be updated to reflect the new semantics, otherwise users who read `--help` will have an incomplete understanding.
Suggest: `"Force full rebuild: rebuild prebuild image and recreate container"`.

**[non-blocking] The proposal shows the existing `RunDevcontainerUpOptions` interface inline in the "Becomes" block, but this interface already exists at `lib/up.ts:865-870`.**
The implementation should modify the existing interface rather than redefining it.
The proposal's intent is clear, but the code snippet could mislead an implementer into thinking a new interface is needed.

**[resolved] The NOTE about verifying `--remove-existing-container` support is now resolved.**
The flag is confirmed in `devcontainer up --help`: `--remove-existing-container  Removes the dev container if it already exists.  [boolean] [default: false]`.
This NOTE should be struck or marked resolved before implementation.

### Proposed Solution: Phase 2 (Fingerprint Design)

**[blocking] `JSON.stringify` does not guarantee key ordering across different JS engines or object construction patterns.**
The Edge Cases section acknowledges this ("deterministic serialization") but the code snippet uses `JSON.stringify(subset, null, 0)` without sorted keys.
The implementation must use sorted keys explicitly, e.g.:

```typescript
JSON.stringify(subset, Object.keys(subset).sort(), 0)
```

Or better, sort recursively for nested objects like `containerEnv`.
This should be specified in the code snippet itself, not deferred to edge cases.

**[non-blocking] The `RUNTIME_KEYS` list includes `postStartCommand` and `postAttachCommand` but these are re-run on container start without recreation.**
Including them in the fingerprint would trigger false positives: changing a `postStartCommand` doesn't require container recreation (it runs on every start), only `postCreateCommand` truly requires it.
Consider removing `postStartCommand` and `postAttachCommand` from `RUNTIME_KEYS`, or document the intentional over-approximation.

**[non-blocking] The fingerprint is a 16-char hex prefix of SHA-256.**
This is 64 bits of collision resistance, which is more than sufficient for this use case, but consider storing the full hash since the storage cost is negligible and it eliminates any theoretical concern.

### Phase 2 Addendum: `wez-into --start`

The approach is sound: drift warnings surface naturally through `lace up`, and the `--rebuild` passthrough to `wez-into --start` is a reasonable UX improvement.

**[non-blocking] The proposal doesn't specify where `--rebuild` goes in the `wez-into` argument parsing.**
`wez-into` has its own flag handling.
The implementation phase should note that `--rebuild` needs to be added to `wez-into`'s option parsing (likely near the `--start` flag) and documented in its usage output.

### Important Design Decisions

All four decisions are well-reasoned.
The `--remove-existing-container` vs `--rebuild` distinction is now confirmed correct.
The "warning vs auto-rebuild" decision is the right call for initial implementation.

### Edge Cases

Good coverage.
The "semantically equivalent but differently serialized" case is the most important and is correctly identified.
As noted above, the fix (sorted keys) should be in the main design, not deferred.

**[non-blocking] Missing edge case: what happens when `lace up` is run from a different working directory than the previous run?**
The fingerprint is stored in `.lace/runtime-fingerprint` (project-local), so this should be fine, but it's worth a sentence confirming.

### Test Plan

Adequate for both phases.
The integration tests are well-specified with concrete verification steps.

**[non-blocking] Consider adding a test for the sorted-keys serialization.**
Verify that two configs with the same keys in different insertion order produce the same fingerprint.

### Implementation Phases

Clear and actionable.
Phase 1 is correctly scoped as a minimal fix.
Phase 2 steps are well-ordered.

## Verdict

**Revise.**
Two blocking issues must be addressed before implementation:

1. Update the `--rebuild` flag description in `commands/up.ts` to reflect the expanded semantics (container recreation, not just prebuild).
2. Specify deterministic (sorted-key) JSON serialization in the fingerprint code snippet, not just in the edge cases section.

Both are straightforward to address.

## Action Items

1. [blocking] Update the `--rebuild` flag description in `commands/up.ts` from "Force rebuild of prebuild image (bypass cache)" to something like "Force full rebuild: rebuild prebuild image and recreate container".
2. [blocking] Replace `JSON.stringify(subset, null, 0)` with a sorted-key serialization in the `computeRuntimeFingerprint` code snippet.
3. [non-blocking] Mark the `--remove-existing-container` verification NOTE as resolved.
4. [non-blocking] Consider removing `postStartCommand` and `postAttachCommand` from `RUNTIME_KEYS` since they don't require container recreation.
5. [non-blocking] Specify where `--rebuild` fits in `wez-into`'s argument parsing in the implementation phases.
6. [non-blocking] Add a test case for deterministic serialization (same keys, different insertion order).
