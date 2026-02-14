---
review_of: cdocs/proposals/2026-02-14-remove-legacy-settings-path.md
first_authored:
  by: "claude-opus-4-6"
  at: 2026-02-14T12:05:00-06:00
task_list: lace/settings
type: review
state: live
status: done
tags: [self, cleanup, settings]
---

# Review: Remove legacy ~/.lace/settings.json fallback

## Summary Assessment

The proposal removes a speculative fallback path that was never used in practice. The scope is minimal (4 lines of code, 3 doc edits), the rationale is sound, and the `$LACE_SETTINGS` env var provides a general escape hatch. Accept.

## Section-by-Section Findings

### BLUF
Accurate and complete. Correctly identifies the scope and rationale.

### Background
Correctly traces the origin to the `2026-02-04-lace-plugins-system` proposal. Verified: `~/.lace/` is never created by lace — all user-level data lives under `~/.config/lace/`.

### Decision: Remove without deprecation
Sound reasoning. Pre-1.0 tool, no known users, directory never auto-created.

### Implementation Phase
**Non-blocking:** The test at `settings.test.ts:216` creates `mkdirSync(join(mockHome, ".lace"), { recursive: true })` as part of the "returns null when no settings file exists" test. This line is dead scaffolding (the test can't mock `homedir()` so `mockHome` is unused by `findSettingsConfig`). Could be cleaned up in the same pass for tidiness, but functionally irrelevant.

**Non-blocking:** The verification step says "Grep for `~/.lace`" but many source files reference the per-project `.lace/` directory or `customizations.lace` namespace. The grep pattern should be scoped to `~/.lace/settings` or the literal string `".lace", "settings.json"` to avoid false positives.

## Verdict

**Accept.** Straightforward removal of dead code. No blocking issues.

## Action Items

1. [non-blocking] Clean up dead `mkdirSync(join(mockHome, ".lace"), ...)` line in `settings.test.ts:216` while in the area.
2. [non-blocking] Scope the verification grep to `~/.lace/settings` or `".lace", "settings"` to distinguish from per-project `.lace/` references.
