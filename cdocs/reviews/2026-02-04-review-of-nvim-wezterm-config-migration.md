---
review_of: cdocs/proposals/2026-02-04-nvim-wezterm-config-migration.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:30:00-08:00
task_list: lace/dotfiles-migration
type: review
state: archived
status: done
tags: [fresh_agent, migration, chezmoi, nvim, wezterm, cleanup]
---

# Review of Neovim and WezTerm Config Migration Proposal

## Summary Assessment

This proposal completes the personal config consolidation phase of the dotfiles migration by migrating neovim config from lace to dotfiles and cleaning up lace's wezterm.lua to be plugin-only. The proposal is well-structured with clear objectives, a thorough test plan, and accurate references to prior work. The neovim assessment report confirms the migration rationale. One minor gap exists around existing neovim config handling on the host, but this is non-blocking.

**Verdict: Accept** with minor suggestions.

## Section-by-Section Findings

### BLUF and Objective

**Finding:** Clear and accurate.

The BLUF correctly identifies this as the final phase of personal config consolidation. The dependency references are accurate and the status note about wezterm migration being already complete is helpful context.

**Status:** No issues.

### Background / Current State

**Finding:** Accurate and well-verified.

The tables correctly describe:
- Lace repo structure with nvim config at `config/nvim/`
- Dotfiles wezterm config already present at `dot_config/wezterm/wezterm.lua`
- Dotfiles nvim config missing (verified: `dot_config/nvim/` does not exist)

The "What Has Already Been Done" section accurately summarizes the prior phases with correct references to devlogs.

**Status:** No issues.

### Part 1: Neovim Config Migration

**Finding:** Straightforward file copy with appropriate modifications.

The file listing is complete (verified against `lace/config/nvim/`). The proposed header comment change is sensible.

**Minor suggestion (non-blocking):** Consider whether to strip the "matching mjr's" comments from plugin files during migration. These are internal references that may be confusing in a general dotfiles context. However, keeping them preserves the history of design decisions.

**Status:** No blocking issues.

### Part 2: Lace WezTerm Cleanup

**Finding:** The proposed minimal wezterm.lua is appropriate.

The reduction from 233 lines to ~50 lines is reasonable for a demo-only config. The proposed code correctly demonstrates plugin loading.

**Minor suggestion (non-blocking):** The proposed code references `wezterm.home_dir .. "/code/weft/lace/..."` as a fallback path. This is user-specific. Consider whether to remove the fallback entirely (since relative path should work when the file is in the lace repo) or document that users should adjust this path.

**Status:** No blocking issues.

### Part 3: Lace Neovim Decision

**Finding:** Option A (remove entirely) is the correct choice.

The rationale is sound: the neovim assessment documented no lace-specific code, and keeping duplicates creates confusion. Options B and C add complexity without benefit.

**Status:** No issues.

### Design Decisions

**Finding:** All four decisions are well-reasoned.

1. No neovim plugin extraction - Correct per assessment.
2. Full file copy, not symlink - Correct per chezmoi design.
3. Keep lazy-lock.json - Correct for reproducibility.
4. Lace wezterm as demo only - Correct to avoid canonical confusion.

**Status:** No issues.

### Test Plan

**Finding:** Comprehensive and practical.

The test plan covers:
- Pre-migration verification (chezmoi config, current nvim works)
- Migration verification (chezmoi sees files, dry-run, apply, plugin install)
- Post-cleanup verification (lace and dotfiles wezterm configs work)

**Minor gap (non-blocking):** The test plan assumes neovim is not already configured on the host. If `~/.config/nvim/` already exists with a different config, `chezmoi apply` behavior should be verified. Chezmoi will overwrite, but the user should be aware.

**Status:** No blocking issues.

### Implementation Phases

**Finding:** Well-scoped and realistic timings.

The four phases (migration, verification, cleanup, documentation) are appropriate. Time estimates (10/5/10/5 min) seem reasonable for the scope.

**Status:** No issues.

### Open Questions

**Finding:** Questions are well-framed with sensible recommendations.

1. lazy-lock.json in git - Recommendation to include is correct.
2. Platform-specific nvim config - Keeping simple is correct.
3. Container neovim config - Correctly deferred as out of scope.

**Status:** No issues.

## Additional Observations

### Consistency with Parent Proposal

The proposal correctly identifies itself as implementing the remaining parts of the parent dotfiles migration proposal. The phase numbering (this is effectively Phase 5 of the parent) is implicit but clear from context.

### Verification of Prior Work Claims

Verified claims:
- WezTerm plugin extraction is complete (`config/wezterm/lace-plugin/` exists)
- Dotfiles wezterm config exists (`dot_config/wezterm/wezterm.lua` present)
- Neovim config exists in lace (`config/nvim/` with expected files)
- Dotfiles nvim config does not exist (confirmed empty)

All claims check out.

## Verdict

**Accept**

The proposal is ready for implementation. It correctly identifies the remaining work, provides a complete test plan, and makes sound design decisions backed by prior assessment work.

## Action Items

1. [non-blocking] Consider adding a note about handling existing `~/.config/nvim/` on the host (chezmoi will overwrite).
2. [non-blocking] Consider whether to keep or strip "matching mjr's" comments in the migrated nvim config files.
3. [non-blocking] Consider removing the user-specific fallback path in the proposed lace wezterm.lua or documenting it as requiring customization.
