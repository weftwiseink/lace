---
first_authored:
  by: "claude-opus-4-6"
  at: 2026-02-14T12:10:00-06:00
task_list: lace/settings
type: devlog
state: live
status: done
tags: [settings, cleanup]
---

# Remove legacy ~/.lace/settings.json fallback: Devlog

## Objective

Remove the `~/.lace/settings.json` fallback from settings discovery per accepted proposal `cdocs/proposals/2026-02-14-remove-legacy-settings-path.md`. Clean up all references.

## Plan

1. Remove legacy fallback branch from `findSettingsConfig()` in `settings.ts`
2. Update JSDoc comment on the function
3. Clean up dead test scaffolding (`mockHome/.lace` creation in settings.test.ts)
4. Update README.md references (3 locations)
5. Run tests, verify, commit

## Testing Approach

Existing test suite — no new tests needed. The legacy path was never tested (tests use `LACE_SETTINGS` env var). Verification: full test pass + grep for stale references.

## Implementation Notes

Straightforward removal. The legacy branch was lines 85–89 of `settings.ts`. The test file had dead scaffolding that created `mockHome/.lace/` but never put a `settings.json` in it (and couldn't mock `homedir()` anyway), so that was removed too.

Both review non-blocking items addressed:
- Cleaned up `mockHome/.lace` dead scaffolding in test
- Verified no stale `~/.lace/settings` references remain in `packages/lace/src/`

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/settings.ts` | Removed legacy fallback branch (4 lines) and updated JSDoc |
| `packages/lace/src/lib/__tests__/settings.test.ts` | Removed dead `mockHome/.lace` scaffolding |
| `packages/lace/README.md` | Removed 3 references to `~/.lace/settings.json` |

## Verification

**Tests:**
```
 Test Files  21 passed (21)
      Tests  488 passed (488)
   Duration  22.59s
```

**Stale reference check:**
```
grep "\.lace.*settings|legacy.*settings|~/.lace/settings" packages/lace/src/ → No matches found
```
