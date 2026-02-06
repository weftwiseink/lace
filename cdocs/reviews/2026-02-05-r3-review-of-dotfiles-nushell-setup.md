---
review_of: cdocs/proposals/2026-02-05-dotfiles-nushell-setup.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:15:00-08:00
task_list: dotfiles/nushell-migration
type: review
state: archived
status: done
tags: [rereview_agent, nushell, shell_config, user_feedback_verification, tone, sequencing]
---

# Review: Nushell Configuration Setup for Dotfiles (Round 3)

## Summary Assessment

This proposal has been substantially reworked based on user feedback. The revision successfully transforms the document from a cautious "evaluate nushell alongside bash" framing into a decisive "nushell is the daily driver" setup guide. All six user feedback items have been applied: Python/venv considerations are fully removed, blesh visual mode concerns are gone, nushell is confirmed as installed at v0.110.0, the archive migration is correctly treated as a prerequisite, the tone is action-oriented, and the rollback plan is appropriately simplified. The prior round 2 blocking issue (history record partial overwrite) was also fixed. The document is tighter and more focused. One new minor concern about a stale revision log entry, and a few non-blocking consistency observations. Verdict: **Accept**.

## Prior Review Status (Round 2)

Round 2 identified 1 blocking and 9 non-blocking issues. Status in this revision:

| # | Issue | Status |
|---|-------|--------|
| 1 | [blocking] `$env.config.history` full-record overwrite | **Fixed** -- now uses individual field assignments |
| 2 | [non-blocking] Gotcha 3 env scoping correction | **Fixed** -- correctly describes blocks vs closures |
| 3 | [non-blocking] Cache hostname in env.nu | **Fixed** -- `$env._HOSTNAME` cached in env.nu |
| 4 | [non-blocking] .chezmoiignore path correction | **Fixed** -- entire .chezmoiignore section removed (no longer relevant) |
| 5 | [non-blocking] Chezmoi install script shebang ordering | **Fixed** -- shebang is first line in the Chezmoi Integration section |
| 6 | [non-blocking] Rollback Scenario 2 manual rm | **Fixed** -- rollback simplified; includes `rm -rf` instruction |
| 7 | [non-blocking] Auto-venv test use virtualenv | **N/A** -- all venv content removed per user feedback |
| 8 | [non-blocking] Carapace cache command bash redirection | **Fixed** -- Step 1.3 uses bash `>` redirection |
| 9 | [non-blocking] OSC 133 attribution to nushell not starship | **Fixed** -- correctly credits nushell shell_integration |
| 10 | [non-blocking] PATH verification deprecated $it | **Fixed** -- uses explicit closure syntax |

All issues from round 2 are resolved or made moot by the scope changes.

## User Feedback Verification

The revision was driven by six specific user feedback items. Verification of each:

### 1. Bash already archived before this proposal executes

**Applied correctly.** The BLUF states "The legacy bash configuration has already been archived." Prerequisites list the archive migration as complete. Background section references `archive/legacy/bash/` paths throughout the archived shell stack table. Phase 1 prerequisite explicitly states "The archive migration is complete." No references to active bash config at top-level `bash/` paths remain. The "Why Not Replace Bash Entirely" section from the prior version is gone, replaced by "Decision 1: Nushell as Primary, Bash for Scripting."

### 2. Nushell is the primary shell, not an experiment

**Applied correctly.** The BLUF opens with "Set up nushell as the primary interactive shell, replacing the archived bash/ble.sh setup." Decision 1 is titled "Nushell as Primary, Bash for Scripting." There is no "evaluation period" framing. Phase 1 includes setting `default_prog` in wezterm.lua as Step 1.6 -- this is part of the initial setup, not deferred. The three-phase structure (tiptoeing -> comfort parity -> enhancement) has been collapsed to two phases (full setup -> enhancements). The rollback plan is a clean two-sentence affair.

### 3. Nushell is now installed

**Applied correctly.** The "Nushell Availability" section that listed installation options is gone. The "Nushell Version" section shows `0.110.0` from an actual `nu --version` run. Step 1.1 in the old version was "Install Nushell" -- this is gone. The chezmoi run_once script was renamed from `install-nushell` to `install-carapace` and no longer contains nushell installation logic. Phase 1 starts at "Create Chezmoi Directory Structure."

### 4. Python/virtualenv/venv removed

**Applied correctly.** The hooks.nu section now contains only the full-history pre_execution hook -- the auto-venv env_change.PWD hooks are gone. The feature mapping table no longer lists "Auto-venv on cd." Decision 6 (overlay-based venv activation) is removed. The "Venvs Without activate.nu" edge case is removed. The Gotcha 1 from the prior version (overlay use parse-time) is removed (it was only relevant for venv activation). Open question 7 about activate.nu is removed. The auto-venv test plan items in Phase 2 verification are gone. The NOTE about virtualenv shipping activate.nu is gone.

### 5. Blesh visual mode concerns removed

**Applied correctly.** The Reedline Vi-Mode Limitations section no longer lists "No visual mode selection (ble.sh supports this)" as a gap. Instead, the mitigation references WezTerm copy mode (`Alt+C`) as sufficient. Gotcha 4 (bash features that do not translate) no longer has a "Visual mode in vi (ble.sh)" row. Open question 5 about ble.sh equivalence is removed.

### 6. Account for archive migration being complete

**Applied correctly.** The Starship Integration section explicitly notes: "The existing `dot_config/starship.toml` (which was NOT archived -- it remains active) is shared between bash and nushell." It also notes the archived duplicate can be ignored. The rollback plan references `archive/legacy/bash/` as the location of the bash config that `~/.bashrc` still sources. No conflict with active bash config is assumed.

## Section-by-Section Findings

### Frontmatter / Revisions

**Non-blocking:** The first revision entry (at `2026-02-05T23:00:00-08:00`) says "Reworked proposal to assume archive migration is complete: bash config files are at archive/bash/, not top-level paths." The path should say `archive/legacy/bash/` (with the `legacy/` segment) to match the actual archive structure documented in the archive migration proposal. This is cosmetic -- the revision log is historical documentation, not executable -- but it could cause confusion if someone reads the revision entry and tries to find files at `archive/bash/`.

### BLUF / Prerequisites

Well-structured. The shift from listing nushell as "not currently installed" to listing it under "Prerequisites (already complete)" with the exact version is clean. The "New dependency" callout for carapace is appropriately separated.

### Proposed Solution: hooks.nu

The hooks file is now pleasantly minimal -- just the full-history pre_execution hook. The `$env._HOSTNAME` cached in env.nu is correctly used here. The `++=` append pattern is correct. No concerns.

### Proposed Solution: completions.nu

**Non-blocking:** The `carapace _carapace nushell | save -f ~/.cache/carapace/init.nu` in env.nu generates the carapace init to a cache file, while completions.nu sets its own external completer. Gotcha 3 correctly notes that the config.nu version wins. However, the carapace init in the vendor autoload directory may also attempt to set the completer (depending on carapace's generated output). This is fine since completions.nu runs later, but it means every startup is writing a cache file to disk that is immediately superseded. A comment in env.nu explaining why this is intentional (carapace needs the bridge file even though completions.nu overrides the completer registration) would help future maintainers understand the layering.

### Feature Mapping Table

**Non-blocking:** The table still lists "Auto-venv on cd" in the original bash column -- wait, actually it does not. Let me recheck. Confirmed: the feature mapping table correctly omits auto-venv. The table is accurate and complete for the revised scope.

### Rollback Plan

Clean and appropriately minimal. Two steps: change wezterm.lua, bash is already functional. The optional cleanup (`rm -rf` for nushell config) is included as a non-essential follow-up. This is a significant improvement over the prior three-scenario rollback.

### Open Questions

Reduced from 7 to 3. The removed questions (default shell timing, reedline maturity, ble.sh equivalence, activate.nu availability) were all correctly identified as no longer relevant given the decisive framing. The remaining three (carapace availability, devcontainers, startup performance) are genuinely open.

### Implementation Phases

The collapse from three phases to two is well done. Phase 1 is substantive -- it includes everything (colors, completions, hooks, utils, keybindings) rather than deferring them. Step 1.6 (set WezTerm default) is correctly placed at the end of Phase 1, after verification, rather than deferred to Phase 3. Phase 2 is appropriately aspirational -- exploring nushell-native patterns and custom completions.

### Document Length

The document went from approximately 1686 lines to approximately 1211 lines. The reduction comes primarily from removing the auto-venv machinery, collapsing phases, simplifying the rollback plan, and removing resolved open questions. The proposal is more focused as a result.

## Verdict

**Accept.** All user feedback items have been correctly applied. All blocking issues from round 2 are resolved. The document is internally consistent, the tone matches the user's intent (decisive daily-driver setup), and the technical content is sound. The remaining non-blocking findings are minor improvements that can be addressed during implementation if desired.

## Action Items

1. [non-blocking] Fix the revision log entry at `2026-02-05T23:00:00-08:00`: change "archive/bash/" to "archive/legacy/bash/" to match the actual archive structure.
2. [non-blocking] Consider adding a brief comment in env.nu's carapace block explaining why the cache file is generated on every startup even though completions.nu overrides the completer registration.
