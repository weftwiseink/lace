---
review_of: cdocs/devlogs/2026-02-05-plugin-docker-user-lookup-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:30:00-08:00
task_list: lace/wezterm-plugin
type: review
state: live
status: done
tags: [self, implementation, code_review, correctness, plugin]
---

# Review: Plugin Docker User Lookup Implementation

## Summary Assessment

This devlog documents a clean, surgical implementation of Docker-based SSH username lookup in the lace.wezterm plugin. The implementation faithfully follows the approved proposal (domain re-registration approach), makes exactly four targeted changes totaling +16 net lines, and passes syntax validation. The devlog is well-structured with clear before/after code, structural verification checklist, and honest acknowledgment of the testing gap. One non-blocking concern: the implementation was committed without runtime testing against a live container, which is acceptable given the constraints but should be noted as a risk.

**Verdict: Accept** with minor non-blocking suggestions.

## Section-by-Section Findings

### Objective

Clear and accurate. Correctly identifies the problem (hardcoded `node` username), the solution (domain re-registration at connect time), and the upstream proposal reference. No issues.

### Implementation Notes

The "Approach: Domain Re-Registration" section is concise and explains the key insight (Lua table reference semantics) that makes this work. The "Why Not ConnectToUri" section is a useful decision record. Both are accurate per the proposal.

### Changes Made

All four changes are documented with exact line numbers, before/after code blocks, and rationale. Verified against the actual git diff:

- **Change 1 (StrictHostKeyChecking)**: Correct. The `accept-new` value is appropriate -- it accepts unknown host keys on first connection but rejects changed keys, which is the right security posture for ephemeral devcontainers where host keys rotate on rebuild.

- **Change 2 (Function signature)**: Correct. `config` is placed before `opts` which follows the existing convention in the codebase (`setup_port_domains(config, opts)`, `setup_keybindings(config, opts, picker_event)`).

- **Change 3 (Domain username override)**: Correct. The loop uses `ipairs` over `config.ssh_domains`, which iterates the integer-indexed entries in order. The `break` after finding the match is an appropriate optimization since domain names are unique. The defensive `domain_found` tracking with `log_warn` fallback is good practice. The `log_info` on every successful connection provides useful diagnostics without being noisy.

  One subtle correctness point worth noting: the override mutates the domain entry permanently for the process lifetime. If the user connects to project A (user `vscode`), then project A's container is rebuilt with user `node`, and the user connects again via the picker, the override will correctly update to `node` because `discover_projects()` runs fresh each time the picker opens. This is correct behavior -- the mutation is idempotent and always reflects the latest discovery.

- **Change 4 (Call site)**: Correct. The `config` variable is available as the first parameter of `apply_to_config`.

**(non-blocking)** The devlog says "Also refactored the `SwitchToWorkspace` block to use the already-computed `domain_name` variable." This is accurate but understates the value -- it eliminates a redundant string concatenation and ensures the domain name used in the override loop and the connection are guaranteed to be identical. Good micro-improvement.

### Verification

The Lua syntax check (`luac -p`) is the right tool and produces a clean result. The structural verification checklist is thorough -- it covers signature consistency, guard preservation, untouched functions, and line count delta. All claims verified against the diff.

**(non-blocking)** The verification section does not include runtime testing output. The devlog honestly acknowledges this in "Remaining Work" (container on port 2222 is outside the lace range). This is acceptable -- the proposal's Phase 5 explicitly defers end-to-end testing to post-launcher-elimination. However, the devlog's `status: wip` is arguably more accurate than `done` until runtime testing completes.

### What This Unblocks

Accurately describes the downstream impact. The dotfiles container `vscode` user scenario is the primary motivation and is now supported. The "multi-user container support" framing is also correct -- this generalizes beyond the dotfiles case.

### Remaining Work

Three items listed are all legitimate:
1. Manual testing requires a lace-range container (documented constraint).
2. WezTerm config path fix is correctly scoped out (chezmoi/dotfiles concern).
3. Push to origin is appropriately deferred.

## Code Review of the Diff

Reviewed the complete diff (`git diff HEAD~1..HEAD` in lace.wezterm) and the final state of `plugin/init.lua` (307 lines).

**Correctness**: The domain override loop at lines 180-193 correctly:
- Computes `domain_name` from `project.port` (which comes from `discover_projects()` Docker query)
- Iterates the same `config.ssh_domains` table that `setup_port_domains` populated
- Matches on `domain.name == domain_name` (string equality, which is reliable since domain names are formatted identically: `"lace:" .. port`)
- Sets `domain.username = project.user` before the `SwitchToWorkspace` action that reads it
- Preserves all other domain fields (remote_address, ssh_option, multiplexing, remote_wezterm_path)

**No regressions identified**: The `_registered_events` and `_domains_registered` guards are untouched. `discover_projects()` is unmodified. Port range constants are unchanged. The `SwitchToWorkspace` action structure is preserved with only the `DomainName` value sourced from the local variable.

**Edge case**: If `config.ssh_domains` contains non-lace domains (added by other plugins or user config), the `ipairs` loop will iterate over them harmlessly -- the name match will skip them. No risk of corrupting other SSH domain entries.

## Verdict

**Accept.** The implementation is a faithful, minimal realization of the approved proposal. Code is correct, well-commented, and defensive. The testing gap is acknowledged and appropriately deferred per the proposal's phasing. No blocking issues found.

## Action Items

1. [non-blocking] Consider updating devlog `status` from `wip` to `done` only after Phase 5 runtime testing completes, or add a note clarifying that `wip` reflects the testing gap.
2. [non-blocking] After runtime testing passes, update the proposal status to `implemented` (or `evolved` if the proposal needs a follow-up for any discovered issues).
