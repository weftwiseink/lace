---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T22:00:00-08:00
task_list: lace/workspace-validation
type: report
state: live
status: complete
tags: [validation, worktree, workspace, executive-summary, implementation-report]
---

# Workspace Validation & Layout: Executive Report

> BLUF: The workspace validation and layout feature set is fully implemented, tested (675 tests, +81 from baseline), reviewed (4 rounds, 0 blocking findings outstanding), and self-hosted on lace's own devcontainer. The system adds two declarative config blocks (`customizations.lace.workspace` and `customizations.lace.validate`) that run as Phase 0 in the `lace up` pipeline, eliminating four lines of error-prone manual config for bare-repo worktree users and catching missing host resources before container creation. No legacy code paths remain; the feature is ready for merge to main.

## Context / Background

Lace's devcontainer config pipeline already handled mount template resolution, feature injection, and metadata fetching. But two pain points remained:

1. **Bare-repo worktree setup was manual and fragile.** Users adopting the nikitabobko bare-repo worktree pattern had to manually coordinate `workspaceMount`, `workspaceFolder`, `postCreateCommand` (safe.directory), and VS Code's `git.repositoryScanMaxDepth`. Getting any one wrong produced silent misconfiguration or opaque Docker errors.

2. **Missing host resources caused cryptic failures.** Devcontainers depending on host-side SSH keys or credential directories would fail deep in the Docker build/mount process with unhelpful error messages.

The accepted proposal ([`cdocs/proposals/2026-02-15-workspace-validation-and-layout.md`](../proposals/2026-02-15-workspace-validation-and-layout.md)) designed a two-part solution: generative workspace layout and assertive host validation, both declarative and opt-in via `customizations.lace`.

## Key Findings

### What Was Built

Three new modules, one CLI flag, and documentation:

| Component | Purpose | Tests |
|-----------|---------|-------|
| `workspace-detector.ts` | Filesystem-only git layout classification (worktree, bare-root, normal-clone, standard-bare, not-git, malformed) | 16 |
| `workspace-layout.ts` | Config auto-generation: workspaceMount, workspaceFolder, postCreateCommand, VS Code settings | 29 |
| `host-validator.ts` | Host-side precondition validation (file existence with tilde expansion) | 23 |
| Integration tests | `runUp()` pipeline tests for all three features | 13 |
| `--skip-validation` | CLI escape hatch that downgrades errors to warnings | Covered in integration |
| README docs | Schema reference for workspace + validate blocks | N/A |

**Total: 81 new tests across 4 new test files + 1 existing integration test file.**

### Architecture

Both features run as **Phase 0** in `up.ts`, inserted after config file reading but before `structuredClone` (so mutations propagate through the pipeline):

```
Phase 0a: Workspace layout detection + config mutation
Phase 0b: Host validation (fileExists checks)
  ... existing pipeline ...
Phase N+1: Inferred mount validation (post-template-resolution)
```

Inferred mount validation runs after template resolution as a late-stage check: it scans all resolved bind-mount `source=` paths (including `workspaceMount`) and warns about missing directories. This catches misconfigured mounts that passed earlier validation because they used templates.

### Design Decisions

- **Filesystem-only detection**: No dependency on the `git` binary. Parses `.git` file contents directly. This works in CI, minimal containers, and environments where git isn't installed.
- **Never clobber user values**: If `workspaceMount` or `workspaceFolder` is already set in the devcontainer config, it is preserved. Auto-generation only fills absent fields.
- **Typed result objects**: `WorkspaceLayoutResult` and `HostValidationResult` use discriminated unions for status, not string matching.
- **Flexible input formats**: `validate.fileExists` accepts both `{ path, severity, hint }` objects and bare string paths.
- **`--skip-validation` follows existing patterns**: Mirrors the existing `--skip-metadata-validation` flag — downgrades errors to warnings without suppressing output.

### Self-Hosting

Lace's own `.devcontainer/devcontainer.json` now uses both features:

```jsonc
"customizations": {
  "lace": {
    "workspace": {
      "layout": "bare-worktree",
      "mountTarget": "/workspace"
    },
    "validate": {
      "fileExists": [{
        "path": "~/.ssh/lace_devcontainer.pub",
        "severity": "error",
        "hint": "Run: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ''"
      }]
    }
  }
}
```

The manual `workspaceMount`, `workspaceFolder`, and `postCreateCommand` entries are commented out with an explanation for contributors without lace.

## Test Scenarios

### Running the full test suite

```bash
cd packages/lace
npx vitest run         # 675 tests, ~23s
```

### Running workspace-specific tests

```bash
cd packages/lace
npx vitest run src/lib/__tests__/workspace-detector.test.ts   # 16 tests
npx vitest run src/lib/__tests__/workspace-layout.test.ts     # 29 tests
npx vitest run src/lib/__tests__/host-validator.test.ts       # 23 tests
npx vitest run src/commands/__tests__/up.integration.test.ts  # Full integration (incl. 13 new)
```

### Canned CLI smoke test (bare-repo layout)

```bash
# Create a temp bare-repo worktree structure
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/project/.bare/worktrees/main"
echo "gitdir: ./.bare" > "$TMPDIR/project/.git"
mkdir -p "$TMPDIR/project/main"
echo "gitdir: ../.bare/worktrees/main" > "$TMPDIR/project/main/.git"

# Write a devcontainer.json with workspace layout
mkdir -p "$TMPDIR/project/main/.devcontainer"
cat > "$TMPDIR/project/main/.devcontainer/devcontainer.json" << 'JSON'
{
  "image": "node:20",
  "customizations": {
    "lace": {
      "workspace": { "layout": "bare-worktree" }
    }
  }
}
JSON

# Run lace up (dry run)
cd "$TMPDIR/project/main"
npx lace up --dry-run 2>&1

# Verify generated config
cat "$TMPDIR/project/main/.lace/devcontainer.json" | jq '{workspaceMount, workspaceFolder}'

# Cleanup
rm -rf "$TMPDIR"
```

### Host validation smoke test

```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.devcontainer"
cat > "$TMPDIR/.devcontainer/devcontainer.json" << 'JSON'
{
  "image": "node:20",
  "customizations": {
    "lace": {
      "validate": {
        "fileExists": [
          { "path": "/nonexistent/file", "severity": "error", "hint": "Create it" }
        ]
      }
    }
  }
}
JSON

# Should fail with validation error
cd "$TMPDIR" && npx lace up 2>&1 | grep -i "validation"

# Should succeed with --skip-validation (downgrades to warning)
cd "$TMPDIR" && npx lace up --skip-validation 2>&1 | grep -i "warn"

rm -rf "$TMPDIR"
```

## Branch History

| Commit | Description |
|--------|-------------|
| `99e0953` | Initial proposal |
| `be494f3` | Expanded implementation guide |
| `64fe923` | R1 blocking fixes (status field, idempotency, excludeWorktree) |
| `313b0a7` | R2 acceptance |
| `4baa971` | Finalized proposal devlog |
| `832d005` | **Phase 1**: Workspace detection + auto-layout (+49 tests) |
| `a89eb8a` | **Phase 2**: Host validation framework (+27 tests) |
| `afbafa6` | **Phase 3**: Inferred mount validation + docs (+5 tests) |
| `8f86629` | **Phase 4**: Self-host on lace devcontainer |
| `04fbb00` | Final cleanup (unused import, misleading comment) |
| `e2243dc` | Finalized implementation devlog |

## Recommendations / Next Steps

1. **Merge to main.** The feature is complete, tested, and self-hosted. No blockers remain.

2. **LocalEnv expansion in validate paths.** Currently `validate.fileExists` supports `~` expansion but not `${localEnv:VAR}` syntax. This was flagged as non-blocking in the Phase 2 review. Adding this would align with devcontainer.json conventions for environment-dependent paths.

3. **Worktree-aware features (future).** The workspace detector opens the door to deeper worktree integration: shared cache volumes across worktrees, worktree-specific settings, or a `lace worktree` subcommand. These are out of scope for this branch but the detection infrastructure is in place.

4. **Mount validation UX refinement.** Inferred mount validation currently emits warnings for missing bind-mount sources. Consider whether some of these should be errors by default (e.g., `workspaceMount` source missing is likely fatal).

5. **Additional layout types.** The `layout` field currently supports `"bare-worktree" | false`. Other patterns (e.g., monorepo with nested workspaces) could be added as new layout types without changing the architecture.
