---
first_authored:
  by: "claude-opus-4-6"
  at: 2026-02-14T12:00:00-06:00
task_list: lace/settings
type: proposal
state: live
status: review_ready
tags: [settings, cleanup, breaking-change]
last_reviewed:
  status: accepted
  by: "claude-opus-4-6"
  at: 2026-02-14T12:05:00-06:00
  round: 1
---

# Remove legacy ~/.lace/settings.json fallback

> BLUF: Remove the `~/.lace/settings.json` fallback from settings discovery in `packages/lace/src/lib/settings.ts`. The canonical location is `~/.config/lace/settings.json` (or `$LACE_SETTINGS`). The legacy path was scaffolded during initial implementation but has no known users. The change is 4 lines of code removal plus doc updates. No test changes required — existing tests use `LACE_SETTINGS` env var and do not exercise the legacy code path.

## Objective

Eliminate a dead code path that adds unnecessary complexity to settings discovery and creates a false impression that `~/.lace/` is a supported configuration directory.

## Background

The settings discovery order was implemented in the `2026-02-04-lace-plugins-system` proposal as:

1. `$LACE_SETTINGS` env var (strict — must exist if set)
2. `~/.config/lace/settings.json` (XDG-compliant primary)
3. `~/.lace/settings.json` (legacy/simple fallback)

The legacy path was added speculatively. All other lace user-level data (feature cache, repo clones) lives under `~/.config/lace/`, so `~/.lace/` is never created by lace itself. The README was just updated (2026-02-14) to document the full user-level data layout, and the user noted that the legacy path adds confusion without value.

## Proposed Solution

Remove the legacy fallback branch from `findSettingsConfig()` and update all documentation references.

## Important Design Decisions

### Decision: Remove without a deprecation period

**Why:** There are no known users of `~/.lace/settings.json`. Lace never creates this directory — a user would have to manually create `~/.lace/settings.json` to use it. The `$LACE_SETTINGS` env var provides a fully general override for anyone with a non-standard settings location.

## Edge Cases

### User has a ~/.lace/settings.json file

They would silently lose their settings. Mitigation: this is a pre-1.0 tool with no known users of this path. The `$LACE_SETTINGS` env var is the escape hatch.

## Implementation Phases

### Phase 1: Code and doc changes

**Files to modify:**

1. `packages/lace/src/lib/settings.ts`
   - Remove lines 85–89 (the legacy fallback branch)
   - Update the JSDoc on `findSettingsConfig()` to remove step 3

2. `packages/lace/README.md`
   - Remove `~/.lace/settings.json` from the "Settings overrides" section (line 200)
   - Remove `~/.lace/settings.json` from the file layout diagram (line 257)
   - Update the Configuration section description (line 280)

**Files NOT to modify:**

- `cdocs/` historical documents — they reflect the state at the time of writing
- Test files — no tests exercise the legacy path

**Verification:**
- `npm test` in `packages/lace` passes with no regressions
- Grep for `~/.lace` or `dotLace` or `legacyPath` in `packages/lace/src/` returns zero results
