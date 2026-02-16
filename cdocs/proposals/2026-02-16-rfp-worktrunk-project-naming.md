---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-16T13:00:00-06:00
task_list: worktrunk/project-naming
type: proposal
state: live
status: implementation_wip
tags: [worktrunk, lace-discover, wez-into, naming, container-naming, docker, workspace-detector]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-16T21:30:00-06:00
  round: 6
---

# Worktrunk-Aware Project Naming and Container Identity

> BLUF: `lace-discover` and `wez-into` derive project names via `basename` of the
> workspace folder, which breaks under the worktrunk layout — every project becomes
> "main". The fix: (1) a `deriveProjectName()` function that uses `classifyWorkspace()`
> to resolve `basename(bareRepoRoot)` for worktree layouts and `basename(workspacePath)`
> for everything else; (2) `lace up` injects both a `lace.project_name` Docker label
> and a `--name` on the container via `runArgs`; (3) discovery reads the label with
> `basename` fallback for pre-label containers. The worktree name is deliberately
> excluded from the project name — in the worktrunk model, the bare repo root is mounted
> into the container and all worktrees are siblings inside it, so the container represents
> the repo, not a single worktree.
>
> - Motivated By: `cdocs/devlogs/2026-02-16-worktrunk-migration-fix.md`
> - Options Analysis: `cdocs/reports/2026-02-16-project-naming-options-analysis.md`
> - Design Reference: `cdocs/reports/2026-02-16-project-naming-reference.md`

## Objective

The worktrunk convention places worktrees inside a bare repo. `basename` of the workspace
folder yields the worktree name (e.g., `"main"`), not the project name (e.g., `"lace"`).
This breaks `lace-discover`, `wez-into`'s `discover_stopped`, and produces Docker
containers with opaque auto-generated names. See the design reference for full background,
stories, edge cases, and design decision rationale.

## Proposed Solution

Three components forming a pipeline:

```
[1] deriveProjectName()          [2] lace up injects               [3] Discovery reads label
    classifyWorkspace() →            --label lace.project_name=X       docker ps → label value
    basename(bareRepoRoot) or        --name X                           fallback: basename
    basename(workspacePath)          (skip --name if user override)
```

**Component 1 — Name Derivation** (`project-name.ts`, new module):
A pure function `deriveProjectName(classification, workspacePath)`. For `worktree` and
`bare-root` types, uses `basename(bareRepoRoot)`. For all other types (`normal-clone`,
`standard-bare`, `not-git`, `malformed`), uses `basename(workspacePath)`. The `workspacePath`
parameter is only used as a fallback for types that lack `bareRepoRoot`. Also exports
`sanitizeContainerName(name)` for Docker `--name` charset compliance.

**Component 2 — Label + Name Injection** (modification to `up.ts`):
In `generateExtendedConfig()`, always inject `--label lace.project_name=<name>` (additive,
no conflict). Inject `--name <sanitized>` unless the user has already provided `--name` in
their `runArgs`. User-override detection via `hasRunArgsFlag()` helper that scans for
`--name` and `--name=` forms.

**Component 3 — Discovery Update** (modification to `lace-discover` and `wez-into`):
Read `lace.project_name` label via `docker ps --format` template. Fall back to `basename`
of `devcontainer.local_folder` for pre-label containers.

## Implementation Notes

> NOTE: This is a young project. Do not leave legacy code paths, compatibility shims,
> deprecated helpers, or `// TODO: remove` comments. If old code is replaced by new code,
> delete the old code. If a pattern is superseded, remove the old pattern entirely. Prefer
> clean breaks over backwards-compatible layering.

> NOTE: The `basename` calls in `lace-discover` (line 73) and `wez-into` (line 125) are
> the root cause. These should be replaced entirely with the label-based approach, not
> wrapped or augmented. The `basename` fallback is for pre-label containers only and should
> be clearly conditional, not the default path.

## Implementation Phases

### Phase 1: Name Derivation Function

Create `deriveProjectName()` and `sanitizeContainerName()` as a new module. This phase
is pure TypeScript with no modifications to existing files.

**New files:**
- `packages/lace/src/lib/project-name.ts`
- `packages/lace/src/lib/__tests__/project-name.test.ts`

**`deriveProjectName(classification, workspacePath)` implementation:**

```typescript
import { basename } from "node:path";
import type { WorkspaceClassification } from "./workspace-detector";

export function deriveProjectName(
  classification: WorkspaceClassification,
  workspacePath: string,
): string {
  switch (classification.type) {
    case "worktree":
      return basename(classification.bareRepoRoot);
    case "bare-root":
      return basename(classification.bareRepoRoot);
    case "normal-clone":
    case "standard-bare":
    case "not-git":
    case "malformed":
      return basename(workspacePath);
  }
}
```

**`sanitizeContainerName(name)` implementation:**

Docker container names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]`.

```typescript
export function sanitizeContainerName(name: string): string {
  // Replace invalid characters with hyphens
  let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, "-");
  // Strip leading non-alphanumeric characters
  sanitized = sanitized.replace(/^[^a-zA-Z0-9]+/, "");
  // Strip trailing non-alphanumeric characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9]+$/, "");
  // Fallback if empty
  return sanitized || "lace-project";
}
```

**Unit tests (`project-name.test.ts`):**

Follow the project's existing test conventions (vitest, `describe`/`it`, inline fixtures).
See `workspace-layout.test.ts` for patterns.

`deriveProjectName` tests — every `WorkspaceClassification` variant must be covered:

| Test | Classification | workspacePath | Expected |
|------|---------------|---------------|----------|
| normal clone | `{type:"normal-clone"}` | `/code/lace` | `"lace"` |
| worktree (main) | `{type:"worktree", bareRepoRoot:"/code/lace", worktreeName:"main", usesAbsolutePath:false}` | `/code/lace/main` | `"lace"` |
| worktree (master) | `{type:"worktree", bareRepoRoot:"/code/lace", worktreeName:"master", usesAbsolutePath:false}` | `/code/lace/master` | `"lace"` |
| worktree (feature branch) | `{type:"worktree", bareRepoRoot:"/code/lace", worktreeName:"feature-x", usesAbsolutePath:false}` | `/code/lace/feature-x` | `"lace"` |
| bare-root | `{type:"bare-root", bareRepoRoot:"/code/lace"}` | `/code/lace` | `"lace"` |
| standard-bare | `{type:"standard-bare"}` | `/code/bare-repo` | `"bare-repo"` |
| not-git | `{type:"not-git"}` | `/tmp/scratch` | `"scratch"` |
| malformed | `{type:"malformed", reason:"test"}` | `/tmp/broken` | `"broken"` |
| nested path (worktree) | `{type:"worktree", bareRepoRoot:"/code/weft/lace", worktreeName:"main", usesAbsolutePath:false}` | `/code/weft/lace/main` | `"lace"` |
| ignores worktree name | `{type:"worktree", bareRepoRoot:"/code/lace", worktreeName:"develop", usesAbsolutePath:false}` | `/code/lace/develop` | `"lace"` |

`sanitizeContainerName` tests:

| Test | Input | Expected |
|------|-------|----------|
| already valid | `"lace"` | `"lace"` |
| spaces → hyphens | `"my project"` | `"my-project"` |
| special chars → hyphens | `"my_project!"` | `"my_project"` |
| leading non-alnum stripped | `"---lace"` | `"lace"` |
| trailing non-alnum stripped | `"lace---"` | `"lace"` |
| mixed | `"--my project!--"` | `"my-project"` |
| degenerate (all invalid) | `"---"` | `"lace-project"` |
| empty string | `""` | `"lace-project"` |
| dots and hyphens in middle | `"my.project-name"` | `"my.project-name"` |

**`hasRunArgsFlag` tests** (can be in the same file or `up.test.ts` — decide based on
where the helper lands):

| Test | runArgs | flag | Expected |
|------|---------|------|----------|
| space form present | `["--name", "foo"]` | `"--name"` | `true` |
| equals form present | `["--name=foo"]` | `"--name"` | `true` |
| flag absent | `["--label", "x=y"]` | `"--name"` | `false` |
| empty array | `[]` | `"--name"` | `false` |
| similar prefix (space) | `["--namespace", "x"]` | `"--name"` | `false` |
| similar prefix (equals) | `["--namespace=x"]` | `"--name"` | `false` |

**Success criteria:**
- All unit tests pass.
- `npx vitest run packages/lace/src/lib/__tests__/project-name.test.ts` green.
- Full test suite still passes (`npx vitest run` — 690+ tests).

**Constraints:**
- Do not modify any existing files in this phase.
- Both functions must be pure (no filesystem access, no side effects).
- Do not add `// IMPLEMENTATION_VALIDATION` — that header is for existing files only if
  the project uses it as a convention; check existing test files to match.

**After completing this phase:** Commit, then iterate with a `/review` subagent focused on
the new module and its tests. Ensure all `WorkspaceClassification` variants are tested,
edge cases are covered, and the code matches the project's existing patterns. Apply
feedback and re-run tests before proceeding.

---

### Phase 2: Label + Name Injection in `lace up`

Thread the project name through the `lace up` pipeline and inject it into the generated
devcontainer.json as `runArgs` entries.

**Files to modify:**
- `packages/lace/src/lib/workspace-layout.ts`
- `packages/lace/src/lib/up.ts`

**Files to add tests to:**
- `packages/lace/src/lib/__tests__/workspace-layout.test.ts` (if `WorkspaceLayoutResult` tests exist)
- `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` (or a new
  `__tests__/up-naming.integration.test.ts` if cleaner)

**Step 2a: Extend `WorkspaceLayoutResult`**

In `workspace-layout.ts`, add a `classification` field to `WorkspaceLayoutResult`:

```typescript
export interface WorkspaceLayoutResult {
  status: "skipped" | "applied" | "error";
  message: string;
  warnings: string[];
  classification?: WorkspaceClassification;  // ← add this
}
```

In `applyWorkspaceLayout()`, the `classifyWorkspace()` call already happens at line 94.
Populate the new field from the result. For all return paths (`"skipped"`, `"applied"`,
`"error"`), include the classification if it was computed.

> NOTE: Do not duplicate the `classifyWorkspace()` call. It already runs once inside
> `applyWorkspaceLayout()`. The purpose of this extension is to expose the result that's
> currently consumed and discarded.

**Step 2b: Add `hasRunArgsFlag()` helper**

Add to `up.ts` (or to `project-name.ts` if it makes more sense as a utility — the
implementor should decide based on where it reads cleanest):

```typescript
export function hasRunArgsFlag(runArgs: string[], flag: string): boolean {
  return runArgs.some(arg => arg === flag || arg.startsWith(`${flag}=`));
}
```

**Step 2c: Thread project name into `generateExtendedConfig()`**

In `up.ts`:

1. Add `projectName?: string` to `GenerateExtendedConfigOptions` (line 563-570).

2. In `runUp()`, after the `applyWorkspaceLayout()` call (line 137), extract the
   classification from the result and compute the project name:

   ```typescript
   import { deriveProjectName, sanitizeContainerName } from "./project-name";

   // After applyWorkspaceLayout:
   const projectName = layoutResult.classification
     ? deriveProjectName(layoutResult.classification, workspaceFolder)
     : basename(workspaceFolder);
   ```

   Pass `projectName` through to `generateExtendedConfig()`.

3. In `generateExtendedConfig()`, inject the `runArgs` entries. Add this block after the
   existing mounts/symlink injection (before the file write at line 664):

   ```typescript
   // Inject project name as Docker label and container name
   if (options.projectName) {
     const runArgs = (extended.runArgs ?? []) as string[];
     runArgs.push("--label", `lace.project_name=${options.projectName}`);
     const sanitized = sanitizeContainerName(options.projectName);
     if (!hasRunArgsFlag(runArgs, "--name")) {
       runArgs.push("--name", sanitized);
     }
     extended.runArgs = runArgs;
   }
   ```

**Tests for Phase 2:**

Integration tests verifying the generated `.lace/devcontainer.json` output. Follow the
pattern in `up-mount.integration.test.ts`: create a temp workspace with a
devcontainer.json, call `runUp()` with a mock subprocess, then read the generated
`.lace/devcontainer.json` and assert on its contents.

| Test | Setup | Assert |
|------|-------|--------|
| Label and name injected | Normal workspace, no existing `runArgs` | `runArgs` contains `["--label", "lace.project_name=<name>", "--name", "<name>"]` |
| User `--name` preserved | `runArgs: ["--name", "my-custom"]` in devcontainer.json | `runArgs` contains `--label lace.project_name=X` but NOT a second `--name`; user's `--name my-custom` is preserved |
| User `--name=` preserved | `runArgs: ["--name=my-custom"]` in devcontainer.json | Same as above, equals form |
| Label always injected | `runArgs: ["--name", "my-custom"]` | `--label lace.project_name=X` still present |
| Existing runArgs preserved | `runArgs: ["--label", "other=value", "--cap-add", "SYS_PTRACE"]` | All existing entries preserved, new entries appended |
| Sanitized name differs from label | Workspace dir name with special chars | `--label` value is unsanitized, `--name` value is sanitized |
| Worktree workspace | Worktrunk workspace (bare-repo + worktree) | Project name is repo name, not worktree name |
| Classification exposed | Call `applyWorkspaceLayout()` on a worktree workspace | `result.classification` is populated with `type: "worktree"` |
| Classification on skip | Call `applyWorkspaceLayout()` with no workspace config | `result.classification` is `undefined` (no classification computed when skipping) |

**Success criteria:**
- All new integration tests pass.
- Full test suite still passes.
- Generated `.lace/devcontainer.json` includes the expected `runArgs`.

**Constraints:**
- Do not modify `lace-discover` or `wez-into` in this phase.
- Do not remove or rename any existing exports from `workspace-layout.ts`.

**After completing this phase:** Commit, then iterate with a `/review` subagent focused on
the `up.ts` and `workspace-layout.ts` changes and the new integration tests. Verify that
the classification threading is correct, that `hasRunArgsFlag` handles all forms, and that
user-provided `runArgs` are never clobbered. Apply feedback and re-run tests before
proceeding.

---

### Phase 3: Discovery Update

Replace the `basename` name derivation in `lace-discover` and `wez-into` with
label-based lookup.

**Files to modify:**
- `bin/lace-discover`
- `bin/wez-into`

**Step 3a: Update `lace-discover`**

In `discover_raw()` (line 61-64), add the `lace.project_name` label to the format
template. The current template is:

```bash
docker ps --filter "label=devcontainer.local_folder" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}'
```

Change to:

```bash
docker ps --filter "label=devcontainer.local_folder" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}\t{{.Label "lace.project_name"}}'
```

In `discover_projects()` (around line 67-116), update the `IFS` read to capture the new
field and replace the `basename` call:

```bash
# Before:
IFS=$'\t' read -r container_id local_folder ports
name=$(basename "$local_folder")

# After:
IFS=$'\t' read -r container_id local_folder ports project_name
name="${project_name:-$(basename "$local_folder")}"
```

The `${project_name:-...}` syntax uses the label value if non-empty, falls back to
`basename` for pre-label containers. Delete the old `name=$(basename "$local_folder")`
line entirely — do not leave it commented out or as a fallback alongside the new code.

**Step 3b: Update `wez-into` `discover_stopped()`**

In `discover_stopped()` (line 117-128), the current template is:

```bash
docker ps -a \
  --filter "label=devcontainer.local_folder" \
  --filter "status=exited" \
  --format '{{.Label "devcontainer.local_folder"}}'
```

Change to:

```bash
docker ps -a \
  --filter "label=devcontainer.local_folder" \
  --filter "status=exited" \
  --format '{{.Label "devcontainer.local_folder"}}\t{{.Label "lace.project_name"}}'
```

Update the parsing loop:

```bash
# Before:
| while IFS= read -r local_folder; do
    [[ -z "$local_folder" ]] && continue
    local name
    name=$(basename "$local_folder")
    printf '%s\t%s\n' "$name" "$local_folder"

# After:
| while IFS=$'\t' read -r local_folder project_name; do
    [[ -z "$local_folder" ]] && continue
    local name
    name="${project_name:-$(basename "$local_folder")}"
    printf '%s\t%s\n' "$name" "$local_folder"
```

Delete the old `name=$(basename "$local_folder")` line. Do not leave dead code.

**Tests for Phase 3:**

These are bash scripts without a formal test harness. Verification is through the
integration test approach in Phase 4. However, the implementor should verify the changes
work correctly by reading the scripts carefully and checking that:

1. The format template changes are syntactically correct (matching quotes, proper
   Go template syntax for `{{.Label "lace.project_name"}}`).
2. The `IFS` field separator matches the new tab-separated field count.
3. The fallback `${project_name:-$(basename "$local_folder")}` is correct bash syntax.
4. No references to the old `basename`-only path remain except inside the fallback.

**Success criteria:**
- `lace-discover` outputs the label-based name for labeled containers.
- `lace-discover` outputs the `basename`-based name for unlabeled containers (fallback).
- `wez-into`'s `discover_stopped()` uses the same label-based approach.
- No dead code, no commented-out old logic.
- The output format structure is unchanged (same fields, same delimiters). Only the
  `name` field value changes.
- The `path` field in discovery output is still `devcontainer.local_folder`, not derived
  from the label.
- Full test suite still passes (690+ tests).

**Constraints:**
- Do not modify the output format structure (field count, delimiters, JSON schema).
- Do not add new output fields — only change how the `name` value is derived.

**After completing this phase:** Commit, then iterate with a `/review` subagent focused on
the bash changes. The reviewer should verify Go template syntax, bash variable expansion,
IFS handling, and that no old `basename`-only code paths remain. Apply feedback before
proceeding.

---

### Phase 4: End-to-End Verification

This phase is manual verification of the complete pipeline. No code changes expected.

**Pre-verification checklist:**
- [ ] All unit tests pass: `npx vitest run`
- [ ] Build succeeds: `npm run build` (or equivalent)
- [ ] No lint errors

**Verification steps:**

1. Remove the old container (if it exists):
   ```bash
   docker rm confident_noether  # or whatever the old container name is
   ```

2. Run `lace up` from the worktrunk worktree:
   ```bash
   lace up --workspace-folder /var/home/mjr/code/weft/lace/main
   ```

3. Verify the container has the label and name:
   ```bash
   docker inspect --format '{{.Name}} {{index .Config.Labels "lace.project_name"}}' lace
   # Expected: /lace lace
   ```

4. Verify `lace-discover` outputs the correct name:
   ```bash
   lace-discover
   # Expected: lace:22425:node:/var/home/mjr/code/weft/lace/main (or similar)
   ```

5. Verify `wez-into lace` connects:
   ```bash
   wez-into lace
   ```

6. Verify `docker` commands work with the name:
   ```bash
   docker logs lace
   docker exec lace ls /workspace
   ```

7. Stop and restart via `wez-into --start`:
   ```bash
   docker stop lace
   wez-into --start lace
   ```

**Success criteria:**
- `wez-into lace` works end-to-end after worktrunk migration.
- `docker ps` shows `lace` as the container name.
- `lace-discover` outputs `lace` as the project name (not `main`).
- All existing tests pass (690+ tests).

**After completing this phase:** Commit any fixups discovered during verification. Run a
final `/review` subagent on the complete changeset (all phases). The reviewer should
verify that no legacy `basename`-only code paths remain, that all tests are present and
passing, and that the devlog is complete. Apply feedback.
