---
review_of: cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T14:00:00-08:00
task_list: lace/wezterm-plugin
type: review
state: archived
status: done
tags: [self, r3_scope_change, architecture, implementation_status, test_plan, consistency]
---

# Review (R3): `wez-into` -- Universal CLI for WezTerm Devcontainer Connection

## Summary Assessment

This R3 review covers a material scope change: the script moved from dotfiles (deployed via chezmoi to `~/.local/bin/`) to the lace repo (`bin/wez-into`). The amendment adds an Implementation Status section, testing methodology, troubleshooting checklist, and review requirements. The scope change itself is well-motivated and simplifies the architecture. The initial review found two blocking issues (stale embedded bash code block, stale Decision 3 text) and three non-blocking consistency issues. All five have been resolved in the same editing pass.

**Verdict: Accept** (after revisions applied).

## Section-by-Section Findings

### BLUF and R3 NOTE

The BLUF text was updated to remove the chezmoi reference. The R3 NOTE clearly explains the rationale for the move. No issues.

### Implementation Status (new section)

Well-structured and accurate. Correctly documents:
- Phase 1 partial completion with specific feature list
- Changes from the original plan
- Known issues from the `wez-into.log` test session

One observation: the section says "224 lines" which matches the actual `bin/wez-into` file (224 lines including the final newline). Accurate.

### Architecture Diagram

Updated correctly to show `lace/bin/wez-into` instead of `~/.local/bin/wez-into`.

### Command Interface

The `--dry-run` addition is correctly documented with an R3 NOTE explaining it was added during implementation.

### File Locations Table

Updated correctly. The nushell module is listed as `bin/wez-into.nu` which is a reasonable co-located path for Phase 2.

### Bash Implementation (embedded code block)

**[BLOCKING]** The embedded bash code block (lines 180-441) is the **original R2 proposal code**, not the actual implementation. The real implementation at `bin/wez-into` differs in multiple ways:

1. The embedded code includes `--start` flag handling, `resolve_workspace_path()`, and `PROJECTS_CONF` -- the actual implementation does not have any of these (Phase 3, not yet implemented).
2. The embedded code uses a `connect_project()` function -- the actual implementation uses inline logic plus a `do_connect()` helper.
3. The embedded code checks `wezterm` at startup -- the actual implementation defers the check to `do_connect()` (only when actually connecting, not for `--dry-run`/`--list`/`--status`).
4. The embedded code does not include `--dry-run` -- the actual implementation does.
5. The embedded `lace-discover` resolution uses direct `elif` checks -- the actual implementation uses a `for candidate in ...` loop with co-location as the first candidate.
6. The embedded `--status` outputs `[*] name (:port) - path` -- the actual implementation uses `printf` with aligned columns and a header row.

The proposal should either (a) update the embedded code to match the actual implementation or (b) remove the embedded code and reference the actual file instead, with a note that the code block is illustrative and the source of truth is `bin/wez-into`. Given that the implementation exists and is the source of truth, option (b) is simpler and avoids future drift.

### Decision 2

Updated correctly from "Lives in dotfiles" to "Lives in the lace repo" with a clear R3 NOTE explaining the reversal. Good.

### Decision 3: Bash primary, nushell companion

**[BLOCKING]** The Decision 3 text still references `~/.local/bin/wez-into` in two places (lines 602, 604) and explains why the bash script "must be" at `~/.local/bin/`. This rationale is stale -- the script is now at `lace/bin/wez-into`. The core decision (bash primary, nushell companion) is still valid, but the "why" paragraph needs updating to reflect that the bash script lives in `lace/bin` rather than `~/.local/bin`, and the reasoning should shift from "must work from ~/.local/bin for cross-shell compatibility" to "must be a bash script because lace/bin is on PATH for all shells, and bash works everywhere."

### Nushell Implementation (embedded code block)

**[Non-blocking]** Same concern as the bash code block -- the embedded nushell code includes `--start` logic and `resolve-workspace-path` which are Phase 3 features. Since the nushell module has not been implemented at all yet (Phase 2), this is less immediately confusing. The comment at line 449 says `use scripts/wez-into.nu *` but the File Locations table says the file will be at `bin/wez-into.nu`, not `scripts/`. The loading instruction should be updated for consistency.

### `lace-discover` Availability

Updated correctly with a clear R3 NOTE. No issues.

### Stories: Developer on a fresh machine

Updated correctly with R3 NOTE. No issues.

### Edge Cases: `lace-discover` not on PATH

Updated correctly to describe the co-location fallback. The description now matches the actual implementation's `for candidate in ...` loop.

### Test Plan

**[Non-blocking]** Test case 4 (Status mode) was updated to say "Formatted table: PROJECT, PORT, USER, PATH columns" which matches the actual implementation. Good. However, test case 8 (--start with running container) and test case 9 (--start with stopped container) are Phase 3 features. They should be annotated as "Phase 3" to avoid confusion about what is testable now versus later.

### Testing Methodology (new section)

Well-structured and practical. The six-step methodology reflects lessons learned from the test session documented in `wez-into.log`. The emphasis on verifying `lace-discover` independently first is particularly valuable given the test log showed discovery returning nothing.

### Troubleshooting Checklist (new section)

Directly addresses the known issues from the test log. The three scenarios (finds nothing, finds but connect fails, picker doesn't show) cover the most common failure modes. No issues.

### Review Requirements for Implementation Agents (new section)

Clear and actionable. No issues.

### Phase 1

Updated correctly to reflect `lace/bin/wez-into` location. The success criteria now include `--dry-run` and formatted table output. R3 NOTE explains the change. No issues.

### Phase 2

Updated correctly to place the nushell module at `lace/bin/wez-into.nu`. R3 NOTE explains the change. No issues.

### Phase 3

Updated file references to `bin/wez-into` and `bin/wez-into.nu`. No issues.

### Open Questions

Question 1's R3 supersession note uses `~~strikethrough~~` inside a strikethrough, which is a bit awkward to read but technically correct. Question 2 resolved correctly. New question 4 (multi-machine portability) is a valid concern and well-framed. No blocking issues.

## Verdict

**Accept** (after revisions applied). All blocking and non-blocking issues were resolved in the same editing pass.

## Action Items

1. [blocking] ~~Update or replace the embedded bash code block to reflect the actual implementation at `bin/wez-into`.~~ **RESOLVED.** Replaced full embedded code with a structural overview pointing to `bin/wez-into` as the source of truth.
2. [blocking] ~~Update Decision 3 text to replace `~/.local/bin/wez-into` references with `lace/bin/wez-into`.~~ **RESOLVED.** Decision 3 now references `lace/bin/wez-into` and `lace/bin/wez-into.nu` with updated rationale and R3 NOTE.
3. [non-blocking] ~~Update the nushell code block's loading comment from `use scripts/wez-into.nu *` to match the actual intended path.~~ **RESOLVED.** Comment updated to `use /path/to/lace/bin/wez-into.nu *` and an R3 NOTE added clarifying the code includes Phase 3 features.
4. [non-blocking] ~~Annotate test cases 8 and 9 (--start scenarios) as "Phase 3" in the test plan table.~~ **RESOLVED.** Both test cases now annotated with "(Phase 3)".
5. [non-blocking] ~~Consider whether the nushell embedded code block should also be annotated.~~ **RESOLVED.** R3 NOTE added above the nushell code block clarifying it includes Phase 3 features not yet implemented.
