---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T11:24:31-08:00
task_list: lace/bugfix
type: devlog
state: live
status: complete
tags: [postCreateCommand, devcontainer-spec, array-semantics, bugfix]
---

# Fix array postCreateCommand join bug: Devlog

## Objective

Fix a semantic bug in `generateExtendedConfig()` where an array-format `postCreateCommand` was being `.join(" ")` into a string before `&&` chaining with the lace symlink command. This changes execution semantics from direct-exec (no shell) to shell execution, which can cause quoting/expansion differences.

## Plan

1. Read the buggy code in `packages/lace/src/lib/up.ts` around line 477-481.
2. Replace the `existing.join(" ")` + `&&` chaining with the devcontainer spec's object format, preserving the original array under its own key.
3. Evaluate whether the string-format case should also be converted to object format for consistency.
4. Add an integration test covering the array-format case.
5. Run full test suite to verify no regressions.

## Testing Approach

Integration test added to the existing `up.integration.test.ts` test file within the "symlink generation" describe block. The test creates a devcontainer config with `"postCreateCommand": ["npm", "install", "--frozen-lockfile"]`, runs `lace up`, and verifies the output config uses object format with the array preserved.

## Implementation Notes

### The Bug

In `generateExtendedConfig()`, when the user's `postCreateCommand` was an array like `["npm", "install"]`, the code did:

```typescript
const existingCmd = existing.join(" ");
extended.postCreateCommand = `${existingCmd} && ${symlinkCommand}`;
```

This produced `"npm install && ln -s ..."` -- a shell string. The array format in the devcontainer spec means "execute directly without a shell," so joining with spaces changes semantics: arguments with spaces, shell metacharacters, or glob patterns would be interpreted differently.

### The Fix

Convert the array case to use the devcontainer spec's object format:

```typescript
extended.postCreateCommand = {
  "lace:user-setup": existing,  // array preserved as-is
  "lace:symlinks": symlinkCommand,
};
```

Each key in the object format runs independently. The array value retains direct-exec semantics; the string value runs through a shell (correct for the lace symlink command, which is a shell string).

### String case left as-is

The string-format `postCreateCommand` case (`"echo hello"`) uses `&&` chaining, which is semantically correct -- both sides are shell strings. Converting it to object format would break the existing test expectations and provide no semantic benefit. Kept the minimal fix.

## Changes Made

| File | Description |
|------|-------------|
| `packages/lace/src/lib/up.ts` | Replace `existing.join(" ")` with object-format postCreateCommand preserving the array |
| `packages/lace/src/commands/__tests__/up.integration.test.ts` | Add test: "preserves array-format postCreateCommand via object format" |

## Verification

**Tests (target file):**
```
 ✓ src/commands/__tests__/up.integration.test.ts (31 tests) 48ms

 Test Files  1 passed (1)
      Tests  31 passed (31)
```

**Full suite:**
```
 Test Files  21 passed (21)
      Tests  489 passed (489)
   Duration  22.91s
```

All 489 tests pass across 21 test files with zero failures. The new test verifies:
- The postCreateCommand output is an object (not a string or array).
- The `"lace:user-setup"` key holds the original array `["npm", "install", "--frozen-lockfile"]` unchanged.
- The `"lace:symlinks"` key contains the symlink command string.
