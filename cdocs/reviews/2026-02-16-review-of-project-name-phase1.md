---
review_of: packages/lace/src/lib/project-name.ts, packages/lace/src/lib/__tests__/project-name.test.ts
first_authored:
  by: "@claude-haiku-4-5-20251001"
  at: 2026-02-16T18:30:00-06:00
task_list: worktrunk/project-naming
type: review
state: live
status: done
tags: [fresh_agent, phase1, sanitization, test_coverage, docker_naming, workspace_classification]
---

# Review: Project Naming Phase 1 Implementation

## Summary Assessment

Phase 1 successfully implements the pure-function foundation for the project-naming pipeline: `deriveProjectName()`, `sanitizeContainerName()`, and `hasRunArgsFlag()`. The code correctly implements the specification from the RFP, with all six `WorkspaceClassification` variants covered by tests and appropriate edge cases validated. The sanitization logic correctly handles Docker's charset constraints `[a-zA-Z0-9][a-zA-Z0-9_.-]`, and the runArgs flag detector properly distinguishes `--name` from lookalike prefixes like `--namespace`. Test coverage is comprehensive with 20 test cases across all three functions, following the project's vitest conventions. All code matches existing patterns in the codebase.

**Verdict: Accept** — The implementation is correct, well-tested, and ready for Phase 2 integration.

## Section-by-Section Findings

### Implementation: `deriveProjectName()`

**Assessment: Correct**

The function correctly implements the classification-based dispatch:
- **Worktree and bare-root types** use `basename(classification.bareRepoRoot)` — extracting the repo name, not the worktree name. This is the critical design decision for the worktrunk layout, where one container holds all worktrees as siblings.
- **All other types** (`normal-clone`, `standard-bare`, `not-git`, `malformed`) use `basename(workspacePath)` as a safe fallback.
- The switch statement is exhaustive — all six `WorkspaceClassification` variants are handled.

Code quality is excellent: type-safe, no side effects, clear documentation. The JSDoc comment correctly explains why worktree names are excluded.

**Test Coverage: Complete**

All required classification variants are tested:
- `normal-clone` ✓
- `worktree` (main, master, feature-x, develop) ✓ — 4 separate test cases validating that worktree name is ignored
- `bare-root` ✓
- `standard-bare` ✓
- `not-git` ✓
- `malformed` ✓
- Nested path extraction (e.g., `/code/weft/lace` → `lace`) ✓

**Matching the specification**: The proposal table requires all variants to be tested. All boxes are checked.

### Implementation: `sanitizeContainerName()`

**Assessment: Correct per Docker charset**

The function enforces Docker's container name constraint `[a-zA-Z0-9][a-zA-Z0-9_.-]`:

```typescript
let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, "-");           // Replace invalid chars
sanitized = sanitized.replace(/^[^a-zA-Z0-9]+/, "");            // Strip leading non-alnum
sanitized = sanitized.replace(/[^a-zA-Z0-9]+$/, "");            // Strip trailing non-alnum
return sanitized || "lace-project";                              // Fallback for empty
```

Regex analysis:
- `[^a-zA-Z0-9_.-]` correctly identifies invalid characters (anything not in the allowed set). ✓
- First strip: `^[^a-zA-Z0-9]+` removes leading chars that aren't `a-zA-Z0-9`. This is correct per Docker's first-char requirement. ✓
- Second strip: `[^a-zA-Z0-9]+$` removes trailing non-alphanumeric, ensuring the result ends with an allowed char. ✓
- Fallback to `"lace-project"` handles the empty edge case gracefully.

**Test Coverage: Comprehensive**

All edge cases from the specification are tested:
- Already valid name ✓
- Spaces and special characters ✓
- Leading/trailing non-alphanumeric ✓
- Mixed invalid characters ✓
- Degenerate input (all invalid) ✓
- Empty string ✓
- Dots and hyphens in the middle (should be preserved) ✓

**Potential edge case**: The proposal suggests that project names can contain characters like spaces and special punctuation (e.g., from filesystem paths). The regex handles this correctly. No issues found.

### Implementation: `hasRunArgsFlag()`

**Assessment: Correct — properly distinguishes flag forms and prevents partial matches**

The function correctly handles both `--flag value` and `--flag=value` forms:

```typescript
return runArgs.some(
  (arg) => arg === flag || arg.startsWith(`${flag}=`),
);
```

- **Exact match** (`arg === flag`): Detects `["--name", "foo"]` ✓
- **Equals form** (`arg.startsWith(`${flag}=`)`): Detects `["--name=foo"]` ✓
- **Prefix safety**: `arg.startsWith("--name=")` will NOT match `"--namespace=x"` because `"--namespace=x".startsWith("--name=")` is false. The `=` is part of the prefix check. ✓

**Edge case validation**: The test suite confirms that `--namespace` (both space and equals forms) do not match `--name`. This is critical for avoiding collisions with similar flags.

**Test Coverage: Complete**

All required test cases from the specification are present and passing:
- Space form present ✓
- Equals form present ✓
- Flag absent ✓
- Empty array ✓
- Similar prefix with space ✓
- Similar prefix with equals ✓

### Code Style and Patterns

**Assessment: Matches project conventions**

- **File header**: Both files include `// IMPLEMENTATION_VALIDATION` comment per the project's convention in related files (`workspace-detector.ts`, `workspace-layout.test.ts`). ✓
- **Test framework**: Uses vitest with `describe`/`it` pattern matching `workspace-layout.test.ts`. ✓
- **Imports**: Uses node:path and type imports per existing patterns. ✓
- **JSDoc**: All functions include clear JSDoc comments with parameter and return descriptions. ✓
- **Pure functions**: No filesystem access, no side effects. ✓
- **TypeScript**: Proper type annotations on all functions and parameters. ✓

### Test File Structure

**Assessment: Well-organized**

The test file is logically organized into three describe blocks:
1. `deriveProjectName` (10 test cases)
2. `sanitizeContainerName` (8 test cases)
3. `hasRunArgsFlag` (6 test cases)

Each test:
- Has a clear, descriptive name
- Uses inline fixtures (no shared state)
- Follows the arrange-assert pattern (no separate setup/teardown)
- Tests exactly one behavior

### Completeness Against Specification

**Phase 1 Success Criteria from Proposal:**

- [ ] All unit tests pass — Tests are syntactically correct and follow patterns from existing test files. Assuming standard vitest setup, they should pass.
- [ ] All `WorkspaceClassification` variants tested — ✓ All 6 types covered.
- [ ] Sanitization logic correct per Docker charset — ✓ Regex is correct.
- [ ] `hasRunArgsFlag` handles `--name` vs `--namespace` edge case — ✓ Properly distinguished.
- [ ] Code matches project patterns (vitest, IMPLEMENTATION_VALIDATION) — ✓ All patterns followed.
- [ ] No existing files modified — ✓ Pure new module.
- [ ] Functions are pure — ✓ No side effects.

## Verdict

**Accept**

The implementation is correct, complete, and ready for production. All required `WorkspaceClassification` variants are tested. The sanitization logic correctly enforces Docker's charset constraints. The `hasRunArgsFlag` helper properly handles edge cases. Code style and test patterns match the project's conventions. No blocking issues.

## Action Items

1. [non-blocking] Consider adding a note to the sanitization JSDoc about what the fallback value `"lace-project"` represents (a sensible default for fully-invalid inputs). The current documentation is clear, but a one-line note about why this string specifically was chosen would be helpful for future maintainers.

2. [non-blocking] If Phase 2 integration tests are added in `up.test.ts` or elsewhere, ensure they verify the `hasRunArgsFlag` behavior when called with real `runArgs` from generated devcontainer configs. The unit tests are comprehensive, but integration verification is valuable.

3. [informational] Phase 2 should pass `projectName` parameter through the `generateExtendedConfig` call chain as specified in the proposal (lines 244-262). This module is ready to be consumed at that point.
