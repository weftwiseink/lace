---
review_of: cdocs/proposals/2026-02-05-dotfiles-bin-launcher-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T14:30:00-08:00
task_list: lace/dotfiles-migration
type: review
state: archived
status: done
tags: [self, architecture, parameterization, cross-project, gap-analysis]
---

# Review: Dotfiles bin/ Launcher Migration to Lace

## Summary Assessment

This proposal addresses a clear and well-documented maintenance problem: 374 lines of nearly identical bash duplicated between two projects. The analysis is thorough -- the six-difference table is verifiable against the actual source code and the phase structure comparison is accurate. The proposed solution (shell-sourceable config file + thin wrappers) is appropriately simple for the problem scope. The main concern is an incomplete accounting of differences between the two scripts and an underspecified mechanism for the critical `REPO_ROOT` override, which several phases of the script depend on. Verdict: **Revise** with two blocking issues.

## Section-by-Section Findings

### BLUF

Clear, accurate, and well-structured. Correctly frames this as tactical rather than strategic (contrasting with the port-range migration). The key dependency callout is helpful.

No issues.

### Objective

Concise and well-scoped. Objective 3 (avoiding coupling to unfinished infrastructure) is a pragmatic constraint that prevents scope creep.

No issues.

### Background: The Six Configuration Differences

**[blocking]** The table lists six differences, but a close reading of the source code reveals additional parameterized differences that are not captured:

1. **`WEZTERM_LOG_FILE`**: Lace uses `/tmp/open-lace-workspace-wezterm.log`, dotfiles uses `/tmp/open-dotfiles-workspace-wezterm.log`. This is derivable from `DOMAIN_NAME` or `SCRIPT_NAME`, but the proposal should specify how the generic script determines this value (e.g., `WEZTERM_LOG_FILE="/tmp/open-${DOMAIN_NAME}-workspace-wezterm.log"`).

2. **Troubleshooting message in dotfiles Phase E**: The dotfiles script includes an extra troubleshooting line (`err "  - ensure WezTerm config has '$DOMAIN_NAME' SSH domain configured"`) that lace does not have. The generic script should include this line since it is useful for all non-lace projects where the domain might not be pre-configured.

These are not large issues, but since the proposal's core claim is "only six differences," the accounting should be precise. Missing differences could cause subtle behavioral regressions if not addressed during implementation.

### Background: The Dotfiles Script Is Slightly Ahead

Accurate observation. The proposal correctly identifies that the generic script should adopt the dotfiles improvements (DOMAIN_NAME variable, optional WEZTERM_CONFIG_FILE). This is a good example of the fork having diverged in a beneficial direction.

No issues.

### Proposed Solution: REPO_ROOT Override

**[blocking]** Decision 6 states that when `LACE_WORKSPACE_CONF` is set, `REPO_ROOT` is derived from the config file's location (two levels up from `.lace/workspace.conf`). However, this logic is not shown in the "Configuration Resolution in `open-workspace`" code block. The code block shows config loading but does not show REPO_ROOT being re-derived.

This is critical because `REPO_ROOT` is used in at least four places in the script:
- `devcontainer up --workspace-folder "$REPO_ROOT"`
- Docker label filter: `devcontainer.local_folder=$REPO_ROOT`
- Troubleshooting messages referencing `$REPO_ROOT`
- Help line extraction offset

The current code block derives `REPO_ROOT` as `$(dirname "$SCRIPT_DIR")` at the top of the script. When invoked from dotfiles, this would point to the lace repo (since the script lives in lace's `bin/`), not the dotfiles repo. The proposal should show the complete REPO_ROOT resolution logic, including:
- When `LACE_WORKSPACE_CONF` is set: derive from config path or use `LACE_WORKSPACE_ROOT`
- When not set: use existing `$(dirname "$SCRIPT_DIR")` logic

The Edge Cases section mentions `LACE_WORKSPACE_ROOT` as a fallback, but this is not reflected in the main solution section or code blocks. The proposal should present a single coherent mechanism.

### Proposed Solution: Config File Format

The shell-sourceable approach is well-justified. The `shellcheck source=/dev/null` annotation is a nice touch showing awareness of linting.

**[non-blocking]** Consider whether the config file should set `REPO_ROOT` directly rather than relying on path derivation. This would make the mechanism explicit and avoid the edge case described in the REPO_ROOT section. For example:

```bash
# .lace/workspace.conf
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
```

This is self-resolving (BASH_SOURCE works when sourced) and eliminates any ambiguity about where the project root is.

### Proposed Solution: Lace Wrapper

The wrapper is minimal and correct. `exec` is the right choice to avoid an extra process.

No issues.

### Proposed Solution: Dotfiles Wrapper

The wrapper is well-structured with a clear error message when lace is not found. The `LACE_ROOT` environment variable escape hatch is appropriate.

**[non-blocking]** The wrapper hardcodes `$HOME/code/weft/lace` as the default. This is a user-specific path. Consider whether this should be documented as requiring customization, or whether a more discoverable default mechanism (e.g., checking if lace is on PATH) would be appropriate. Given this is a personal dotfiles repo, the hardcoded path is acceptable, but worth noting.

### Design Decisions

All six decisions are well-reasoned with clear "Decision" and "Why" structure. Decision 1 (shell-sourceable config) and Decision 5 (requiring lace checkout) are the most consequential and both are well-justified.

No issues.

### Stories

The four stories cover the key scenarios. The "New Project Adopts" story is particularly useful for validating the generality of the approach.

No issues.

### Edge Cases

Good coverage. The "Config File Overrides Unexpected Variables" case is important and the mitigation (source before internal state) is correct. The REPO_ROOT derivation edge case is acknowledged but, as noted above, the mitigation should be promoted to the main solution.

**[non-blocking]** Missing edge case: What happens if the lace `open-workspace` script is updated with new config variables that the dotfiles `workspace.conf` does not define? The answer is "defaults apply," which is the correct behavior, but worth stating explicitly to reassure readers that the config format is forward-compatible.

### Test Plan

The test plan covers the critical behavioral equivalence scenarios. The config loading tests are useful.

**[non-blocking]** The `--help` test for verifying config loading values will not actually work as written. The current `--help` implementation (`head -28 | tail -n +2 | sed`) prints the script header comments, not runtime variable values. To verify config loading, the tests would need a different mechanism (e.g., a `--debug` flag that prints resolved configuration, or simply verifying behavior end-to-end). This is a minor point since the tests are described as manual verification.

### Implementation Phases

Well-structured with clear scope, files, success criteria, and constraints per phase. The dependency chain (Phase 2 depends on Phase 1) is explicit.

**[non-blocking]** Phase 1 scope says "Copy `bin/open-lace-workspace` to `bin/open-workspace`" but should note that the copy will be modified (config loading added, hardcoded strings replaced). The current wording could be read as "copy, then modify separately" vs. "create by modifying a copy." Minor clarification.

### Open Questions

Question 1 (commit vs gitignore) is well-analyzed with a clear recommendation. Question 2 (naming) is a matter of preference; the current choice is fine. Question 3 (lace CLI absorption) correctly identifies the future direction.

No issues.

## Verdict

**Revise.** The proposal is well-constructed and the approach is sound. Two blocking issues should be addressed:

1. Complete the difference accounting (WEZTERM_LOG_FILE, extra troubleshooting line) to match the "six differences" claim, or update the claim.
2. Show the complete REPO_ROOT resolution mechanism in the Configuration Resolution code block, resolving the inconsistency between Decision 6, the Edge Cases section, and the code sample.

## Action Items

1. [blocking] Add `WEZTERM_LOG_FILE` and the extra troubleshooting line to the differences table, or show how they are derived from existing config variables in the generic script. Update the count if needed.
2. [blocking] Add REPO_ROOT override logic to the Configuration Resolution code block. Choose one mechanism (path derivation from config file, explicit `LACE_WORKSPACE_ROOT` env var, or `WORKSPACE_ROOT` in the config file itself) and present it consistently across the solution, design decisions, and edge cases sections.
3. [non-blocking] Consider adding `WORKSPACE_ROOT` as a config variable that the `.lace/workspace.conf` can set, using `BASH_SOURCE` self-resolution. This would make REPO_ROOT handling explicit rather than implicit.
4. [non-blocking] Add a forward-compatibility note in the Edge Cases section explaining that new config variables in future versions of `open-workspace` will fall back to defaults, so older `workspace.conf` files continue to work.
5. [non-blocking] Clarify that the `--help` test in the Test Plan would need a different verification mechanism, or replace with an end-to-end test description.
6. [non-blocking] Minor: Phase 1 scope should say "Create `bin/open-workspace` based on `bin/open-lace-workspace` with config loading modifications" rather than "Copy."
