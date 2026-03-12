---
review_of: cdocs/proposals/2026-03-11-post-container-git-verification.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T21:00:00-06:00
task_list: lace/up-pipeline
type: review
state: live
status: done
tags: [rereview_agent, code-correctness, container-verification, git-extensions, docker-exec]
---

# Review (Round 2): Post-Container Git Extension Verification

## Summary Assessment

This is a round 2 review following revision of the two blocking issues from round 1.
Both blocking items have been addressed correctly: `getDetectedExtensions` now resolves the bare git directory via `resolveGitdirPointer` and `findBareGitDir` (matching the source paths), and container name resolution is handled by a new `resolveContainerName()` helper that mirrors `generateExtendedConfig` logic.
All round 1 non-blocking items were also addressed (synchronous docker exec note, E7 rewrite, T13b/T13c tests).
One new non-blocking issue surfaces: `resolveContainerName` does not handle the `--name=value` (equals-sign) form that `hasRunArgsFlag` recognizes.
Verdict: **Accept**.

## Round 1 Blocking Item Disposition

### B1: `getDetectedExtensions` Read Wrong Path

**Status: Resolved.**
The revised `getDetectedExtensions` (Detail 3) now takes `workspacePath` as a parameter and resolves the actual bare git directory:

- Reads the `.git` file via `resolveGitdirPointer(join(workspacePath, ".git"))`.
- For `worktree`: calls `findBareGitDir(pointer.resolvedPath)` to walk up from `.bare/worktrees/<name>` to `.bare`.
- For `bare-root`: uses `pointer.resolvedPath` directly (the pointer target IS the `.bare` directory).

Verified against source: `classifyWorkspaceUncached` at workspace-detector.ts:180 calls `findBareGitDir(resolvedPath)` for worktrees and passes `resolvedPath` directly for bare-root at line 199.
The proposal's helper mirrors this exactly.
The proposal also correctly notes that `findBareGitDir` (line 321) must be exported since it is currently a private function.

### B2: Container Name Not Sanitized / Custom `--name` Not Handled

**Status: Resolved.**
The revised proposal adds `resolveContainerName()` in `project-name.ts` (Detail 5) that:

1. Checks `runArgs` for `--name` and extracts the user-provided value.
2. Falls back to `sanitizeContainerName(projectName)`.

The integration code in Detail 4 now calls `resolveContainerName(projectName, configExtended)` instead of passing raw `projectName`.
Verified against source: `generateExtendedConfig` at up.ts:766-769 applies `sanitizeContainerName` and gates on `hasRunArgsFlag(runArgs, "--name")`.
The proposal's helper mirrors this.

## Round 1 Non-Blocking Item Disposition

### NB3: E7 Text Inaccuracy

**Status: Resolved.** E7 has been rewritten to correctly describe the two transformations (`sanitizeContainerName` and custom `--name` in `runArgs`) and references `resolveContainerName()`.
No longer claims `deriveProjectName()` checks `runArgs`.

### NB4: Missing Test for Custom `--name`

**Status: Resolved.** T13b (integration) and T13c (unit) added for this scenario.

### NB5: Synchronous Docker Exec Note

**Status: Resolved.** Added at the end of Detail 2 as a NOTE paragraph acknowledging the synchronous call pattern and its consistency with existing codebase conventions.

### NB6: `workspace_smoke.test.ts` Extension Stripping

**Status: Not explicitly addressed.** Phase 3 still mentions reviewing the stripping workaround but does not add specific guidance.
This is fine: the existing text ("Review ... extension-stripping workaround -- no longer necessary for the extension check") is adequate as a reminder for the implementor.

## New Findings

### `resolveContainerName` Does Not Handle `--name=value` Form

**Non-blocking.**
The proposal's `resolveContainerName` searches for `--name` as a separate argument:

```typescript
const nameIdx = runArgs.findIndex(
  (arg) => arg === "--name" || arg === "-n",
);
```

But `hasRunArgsFlag` in `project-name.ts` (line 49-52) also recognizes the equals-sign form:

```typescript
return runArgs.some(
  (arg) => arg === flag || arg.startsWith(`${flag}=`),
);
```

If a user writes `"runArgs": ["--name=my-custom"]`, `hasRunArgsFlag` will detect it and prevent lace from injecting its own `--name`, but `resolveContainerName` will not extract the custom name from the `--name=value` string.
It will fall back to `sanitizeContainerName(projectName)`, which is the wrong container name.

The fix is straightforward: add an equals-sign check to the helper.

```typescript
export function resolveContainerName(
  projectName: string,
  extendedConfig: Record<string, unknown>,
): string {
  const runArgs = (extendedConfig.runArgs ?? []) as string[];
  for (const arg of runArgs) {
    if (arg === "--name" && runArgs.indexOf(arg) + 1 < runArgs.length) {
      return runArgs[runArgs.indexOf(arg) + 1];
    }
    if (arg.startsWith("--name=")) {
      return arg.slice("--name=".length);
    }
  }
  return sanitizeContainerName(projectName);
}
```

Additionally, the proposal checks for `-n` as an alias for `--name`, but Docker's `docker run` does not have a `-n` shorthand for `--name`, and `generateExtendedConfig` only checks `"--name"`.
The `-n` check should be removed for consistency with the source.

This is non-blocking because the `--name=value` form is unusual in `devcontainer.json` `runArgs` (the JSON array format naturally separates flag and value), and `-n` is not a real Docker alias.
However, both should be corrected during implementation to match `hasRunArgsFlag` semantics exactly.

### Observation: `getDetectedExtensions` Re-reads `.git` File

**Non-blocking, informational.**
The `getDetectedExtensions` helper re-reads and re-parses the `.git` file that `classifyWorkspaceUncached` already parsed.
This is negligible overhead (single file read, cached classification means it only runs once), but worth noting that the classification cache does not cache the intermediate `pointer` object.
No change needed.

## Verdict

**Accept.**
Both round 1 blocking issues are correctly resolved.
The `getDetectedExtensions` fix accurately mirrors the source's path resolution logic for both worktree and bare-root cases.
The `resolveContainerName` helper correctly mirrors `generateExtendedConfig`'s naming logic.
The one new non-blocking finding (`--name=value` form and spurious `-n` check) is minor and can be corrected during implementation.
The overall design (post-`devcontainer up` verification via `docker exec`, `--no-cache` on force rebuild) remains sound and well-articulated.

## Action Items

1. [non-blocking] Handle `--name=value` (equals-sign) form in `resolveContainerName` to match the semantics of `hasRunArgsFlag`. Remove the `-n` check since Docker does not support it as a `--name` alias and `generateExtendedConfig` does not check for it.
2. [non-blocking] Consider adding a T13d test case for the `--name=value` form to ensure `resolveContainerName` extracts the name correctly from both `--name value` and `--name=value` patterns.
