---
review_of: cdocs/reports/2026-02-08-wez-into-cli-command-status.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:15:00-08:00
task_list: lace/wezterm-plugin
type: review
state: live
status: done
tags: [self, status, completeness, accuracy]
---

# Review: Status Report -- CLI Commands for WezTerm Devcontainer Connection

## Summary Assessment

This report provides a clear, well-organized survey of CLI tooling for connecting WezTerm to devcontainers. The "two generations" framing is effective and accurately captures the architectural evolution. The gap analysis (discovery, PATH, naming, startup) identifies the right issues. The report is accurate against the source documents and code it references. One factual correction needed regarding the docker user lookup proposal's archive status. Overall a strong status report that serves its purpose well.

**Verdict: Accept** with minor non-blocking suggestions.

## Section-by-Section Findings

### BLUF

Clear and comprehensive. Correctly identifies the three-part problem: port mismatch, PATH accessibility, and the "type a short command from anywhere" user mental model. No issues.

### Context / Background

Concise and appropriate. The one-week timeline framing is helpful for understanding the velocity of change.

### Key Findings -- What Was Implemented

**Finding 1 (non-blocking): Docker user lookup proposal status.**
The report references the docker user lookup proposal (`2026-02-05-lace-wezterm-docker-user-lookup.md`) indirectly through the launcher elimination proposal. The docker user lookup proposal has `state: archived` and `status: accepted` in its frontmatter, and the plugin already implements the username override in the picker callback (lines 180-193 of `init.lua`). The report does not mention whether this feature is actually deployed. For completeness, the plugin section (finding 5) could note that docker-based username override is already implemented in the plugin code.

**Finding 2 (non-blocking): open-lace-workspace "smart mode" additions not mentioned.**
The devlogs `2026-02-02-open-lace-workspace-smart-mode-implementation.md` and `2026-02-02-open-lace-workspace-smart-mode-handoff.md` document enhancements to `open-lace-workspace` (interactive reconnect/rebuild prompts, existing-connection detection, mux-server auto-restart). These are visible in the current script but the report attributes them to the original implementation without noting the subsequent "smart mode" evolution. This is a minor completeness gap -- the report is already detailed enough for its purpose.

### Key Findings -- What Was Proposed But Not Implemented

Accurate. The deeper-integration RFP is correctly characterized as superseded by the port-scanning architecture.

### Analysis

**Finding 3 (non-blocking): Gen 1 vs Gen 2 table is excellent.**
The comparison table effectively communicates the tradeoffs. One potential addition: Gen 2's `wez-lace-into` uses `exec wezterm connect` (blocking, foreground), while Gen 1's `open-lace-workspace` backgrounds wezterm connect with `&` and `disown`. This behavioral difference affects how the command integrates into shell workflows.

**Finding 4 (non-blocking): The naming gap analysis could be stronger.**
The report suggests `wez-into` or `lace-connect` as alternatives. Worth noting that `wez-into` preserves the "wezterm" connection in the name (useful for discoverability -- "what was that wez-something command?") while `lace connect` requires the user to remember it is a lace subcommand. The user's own recollection was "wez-into-something," suggesting the `wez-` prefix has good mnemonic properties.

### Recommendations

All five recommendations are sound and well-prioritized. The port migration being highest priority is correct -- it unblocks everything else.

**Finding 5 (non-blocking): Recommendation 2 could be more specific about nushell.**
The MEMORY.md notes that nushell is the primary shell. The chezmoi deployment path should account for both nushell and bash. A nushell `def wez-into` function and a bash alias/function would both be needed.

## Verdict

**Accept.** The report is accurate, well-structured, and actionable. The non-blocking findings are minor completeness improvements that do not affect the report's utility for its intended purpose (informing a subsequent proposal for the "wez-into" command).

## Action Items

1. [non-blocking] Consider noting that the docker-based username override is already implemented in the plugin (not just proposed), to strengthen the "Gen 2 is ready" narrative.
2. [non-blocking] Consider noting the `exec` vs backgrounding behavioral difference between Gen 1 and Gen 2 in the comparison table.
3. [non-blocking] Consider mentioning nushell specifically in Recommendation 2, since it is the primary shell per project memory.
4. [non-blocking] Consider noting the "smart mode" enhancements to open-lace-workspace (2026-02-02) for historical completeness.
