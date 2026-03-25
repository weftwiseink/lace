---
review_of: cdocs/proposals/2026-03-25-lace-user-json-rollout.md
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T10:15:00-07:00
task_list: lace/user-json-rollout
type: review
state: live
status: done
tags: [fresh_agent, verification_checklist, chezmoi, feature_ordering, dotfiles]
---

# Review: Lace user.json Rollout and Cross-Project Verification

## Summary Assessment

This proposal targets a concrete gap: nushell and neovim were removed from `prebuildFeatures` during the lace-fundamentals migration but not yet added to `user.json`, leaving the current container without both tools.
The document is well-structured and covers the major concerns (target config, chezmoi order-of-operations, feature install ordering, verification checklist).
The most important finding is that the feature install ordering concern is identified but the mitigation (`installsAfter`) is left as a WARN without a concrete resolution path, and the verification checklist has several gaps that could let a broken environment slip through.
The proposal is close to acceptance but needs the ordering mitigation elevated from advisory to a concrete action item, and a few checklist additions.

**Verdict: Revise.**

## Section-by-Section Findings

### BLUF and Objective

The BLUF is accurate and appropriately scoped.
The five objective bullets are clear and testable.
No issues here.

### Background / Current State

The current state description is accurate and useful.
The `nu: not found` / `nvim: not found` framing makes the gap immediately concrete.

The `user.json` shown has `"name": "mjr"` / `"email": "mjr@weftwiseink.com"` which the proposal correctly flags as needing to change to `micimize` / `rosenthalm93@gmail.com`.
However, the `"defaultShell": "/usr/bin/nu"` in the existing file implies that was already set, yet the current state shows `default shell: /bin/bash`.
The proposal does not explain this discrepancy - if `defaultShell` is already set but nushell isn't installed, what happens?
Is the `chsh` call failing silently?
This would be useful context for readers and for diagnosing Phase 3 failures.

**Non-blocking:** Add a sentence explaining the current shell mismatch (defaultShell already set, but binary not present leads to silent chsh failure or ignored preference).

### Target user.json

The proposed JSON is clean and complete for the stated goals.
The git identity note is appropriate.

One gap: `containerEnv` sets `EDITOR` and `VISUAL` but there is no `SHELL` env var.
The WARN in the feature ordering section mentions `SHELL=/usr/bin/nu` in `containerEnv` as a fallback when `chsh` fails.
Yet the proposed `user.json` does not include it.
If the feature ordering problem occurs (nushell installs after `chsh` runs), the fallback mitigation described in the WARN is not actually present in the proposed config.
These two sections are inconsistent.

**Blocking:** Add `"SHELL": "/usr/bin/nu"` to `containerEnv` in the target `user.json`, or explicitly decide not to include it and update the WARN to reflect that decision.

### devcontainer.json Cleanup

The section correctly identifies that there is nothing to remove from `prebuildFeatures` (already cleaned up).
The git-delta deferral is reasonable and clearly marked optional.
No issues.

### Chezmoi Integration

The three preconditions are correct.
The proposal states that `lace-fundamentals/dotfiles` mount override is "already done" in `settings.json` - this is stated as a precondition with no verification step in the checklist.

The proposal does not address what happens when chezmoi `run_once` scripts for starship and carapace fail.
Phase 3 mentions "may need `CHEZMOI_CONTAINER=1` guard" but the proposal does not define what that guard looks like or whether the dotfiles repo currently has it.
A reader implementing Phase 2 who hits this failure would need to go investigate the dotfiles repo independently.

**Non-blocking:** Add a NOTE clarifying whether the dotfiles repo already has container guards on `run_once` scripts, or whether that is work that needs to happen as part of Phase 3.

The proposal also does not address the chezmoi templating concern for nushell configs that may reference host-specific paths.
Phase 3 mentions `.chezmoi.hostname` templating, but the proposal gives no guidance on how pervasive the issue is or whether the current dotfiles already handle it.
If nushell `config.nu` references a path that only exists on the host (e.g., `~/code/personal/`), the shell will start with errors.

**Non-blocking:** Add a clarifying note on whether current dotfiles require host-specific path templating and whether any such templating is already present.

### Feature Install Ordering

The WARN correctly identifies the risk: `chsh` may run before nushell binary is installed if devcontainer CLI reorders features.
The mitigation (`installsAfter`) is called out.

However, the mitigation is left as a parenthetical suggestion inside the WARN body rather than an action item or implementation phase.
If this concern is real enough to WARN about, it should be real enough to fix before declaring Phase 2 success.
The current Phase 3 "Fix issues" section does mention it, but only as a reactive fallback - the proposal treats feature ordering as a "discover at rebuild time" problem rather than addressing it proactively.

The `installsAfter` field should be added to the lace-fundamentals feature as part of Phase 1 (or as a new explicit Phase 0), not discovered and fixed in Phase 3.
The WARN also mentions a `containerEnv` fallback (`SHELL=/usr/bin/nu`) but as noted above, it is not in the proposed `user.json`.

**Blocking:** Elevate the `installsAfter` mitigation to an explicit implementation step (Phase 1 or new Phase 0) with a success criterion, rather than leaving it as a reactive Phase 3 fix.
The proposal as written will likely fail Phase 2 verification on first attempt and require a Phase 3 fix that was known in advance.

### Verification Checklist

The checklist is thorough in some areas (shell, editor, git identity, dotfiles, SSH, mounts, tools) but has specific gaps.

**Shell environment gaps:**
- There is no check that nushell itself loads without errors (e.g., `nu -c "version"` or inspecting stderr on shell start).
A broken nushell config may cause nushell to launch with error output before the prompt appears.
- The check `$env.config.show_banner` is too specific to a particular dotfiles setting; a more portable check would be `nu --version` and verifying the `$env.config` table is populated.

**Chezmoi gaps:**
- No check that `chezmoi apply` ran without errors (exit code, no error output).
The dotfiles mount path in `settings.json` is listed as a precondition but there is no checklist item to verify it is correctly configured before rebuild.

**Feature ordering gap:**
- No checklist item verifying that `chsh` succeeded (e.g., `getent passwd node | cut -d: -f7` already covers this - but it would fail silently if `chsh` was skipped).
The proposal should add: `[ ] Check container build logs for chsh warning about nushell binary not found`.

**Cross-project gap:**
- The cross-project verification step says "rebuild a DIFFERENT lace-managed project" but does not specify which project.
For an implementor, naming a concrete second project (e.g., the dotfiles devcontainer) would make this actionable.
- No check for what happens when `user.json` has `"defaultShell": "/usr/bin/nu"` but the referenced feature is not in the merged prebuildFeatures (e.g., the other project already has nushell declared separately - does it deduplicate correctly?).

**Non-blocking:** Add: `[ ] Container build logs show no chsh failure warnings`.
**Non-blocking:** Name the second project for cross-project verification.
**Non-blocking:** Add a chezmoi apply exit-code check (e.g., `chezmoi apply --dry-run` or checking init script output).

### Implementation Phases

Phase 1 (update user.json) and Phase 2 (rebuild and verify) are well-defined.
Phase 3 (fix issues) is underspecified - it is a reactive catch-all rather than a structured plan for the known likely failures.
Given the WARN about feature ordering and the chezmoi `run_once` guards, Phase 3's known issues are predictable enough to pre-plan.

Phase 4 (git-delta) is correctly deferred and marked optional.

**Non-blocking:** Consider restructuring Phase 3 into named sub-items matching the known likely failures from the WARN and chezmoi integration sections, with success criteria for each.

### Open Questions

All three open questions are reasonable.
Question 3 (dotfiles mount in `user.json` vs `settings.json`) is the most architecturally significant - the writable mount deferral is correctly noted.

No issues with the open questions section.

## Verdict

**Revise.**

Two blocking issues prevent acceptance:

1. The `containerEnv` in the target `user.json` is missing `SHELL=/usr/bin/nu`, which is the stated fallback when `chsh` fails due to feature ordering - the WARN and the proposed config are inconsistent.
2. The feature ordering mitigation (`installsAfter` on lace-fundamentals) is identified but treated as a Phase 3 reactive fix rather than a Phase 1 proactive step.
The proposal is likely to fail Phase 2 on first attempt for a reason the author already knows about.

The non-blocking items (shell error check, chezmoi apply verification, naming the second project) would improve implementation confidence but are not required for acceptance.

## Action Items

1. [blocking] Add `"SHELL": "/usr/bin/nu"` to `containerEnv` in the target `user.json`, or explicitly decide against it and remove the WARN's mention of it as a fallback.
2. [blocking] Elevate the `installsAfter` mitigation from a parenthetical WARN note to an explicit Phase 1 (or new Phase 0) implementation step with a success criterion: "lace-fundamentals `devcontainer-feature.json` declares `installsAfter: [nushell feature]`".
3. [non-blocking] Add a sentence in the Background section explaining the current state discrepancy: `defaultShell` is already `/usr/bin/nu` in user.json but nushell is not installed, resulting in the silent chsh failure or bash fallback.
4. [non-blocking] Add a NOTE in the Chezmoi Integration section on whether dotfiles `run_once` scripts already have container guards, or whether adding them is part of Phase 3 scope.
5. [non-blocking] Add checklist item: `[ ] Container build logs show no chsh failure for nushell binary`.
6. [non-blocking] Add checklist item: `[ ] chezmoi apply completed without errors (check init script output or lace logs)`.
7. [non-blocking] Name a concrete second project in the cross-project verification checklist item.
8. [non-blocking] Clarify whether current nushell dotfiles reference host-specific paths that would need chezmoi templating inside containers.
