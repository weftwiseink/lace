---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T10:00:00-08:00
task_list: lace/workspace-validation
type: devlog
state: live
status: done
tags: [validation, worktree, workspaceMount, proposal]
---

# Devlog: Workspace Validation & workspaceMount/workspaceFolder Support

## Objective

Design and propose a host-side validation system for lace that:
1. Validates host-system preconditions that devcontainer features/configs rely on (bare worktree layout, ~/.claude existence, SSH keys, etc.)
2. Extends lace's template system to support `workspaceMount` and `workspaceFolder` resolution
3. Provides a compact, extensible architecture that could live as baked-in validation or as a devcontainer feature

Prior art: `cdocs/reports/2026-02-13-worktree-aware-devcontainers.md` and `cdocs/reports/2026-02-13-worktree-support-executive-summary.md` — these established the single-container bare-repo worktree model as the target.

## Plan

1. **Research phase** (parallel subagents):
   - Agent A: Git worktree detection mechanics — how to reliably detect bare-repo worktree layout from host side
   - Agent B: Existing validation patterns in lace — how current validation works, extension points
   - Agent C: workspaceMount/workspaceFolder template resolution — design space for `${lace.workspace()}` or similar
2. **Synthesis**: Combine research into a unified design
3. **Write /propose**: Formal proposal with implementation phases
4. **Expand implementation plan**: Detailed testing strategy via subagent
5. **Iterate /review**: Until accepted

## Testing Approach

This is a proposal/design session — no code will be written. Testing strategy will be defined in the proposal's implementation plan.

## Implementation Notes

### Research phase (3 parallel subagents)

**Agent A — Git worktree detection**: Comprehensive filesystem-only detection algorithm. Key insight: always resolve from forward pointers (worktree `.git` → `.bare/worktrees/<name>`), never trust `git worktree list` which is unreliable when back-pointers are broken. The detection requires no `git` binary — just parsing `.git` file contents and resolving relative paths.

**Agent B — Lace validation patterns**: Mapped all existing validation in the codebase. Key findings: `customizations.lace` has no unified TypeScript interface (fields read ad-hoc by each module), adding new fields is safe (unknown fields ignored), `workspaceMount`/`workspaceFolder` are completely untouched by lace. Best insertion point is after config read, before metadata fetch.

**Agent C — Validation architecture design**: Identified the key distinction between precondition checks (fail-fast guards) and generative actions (config derivation from host state). Recommended separating `workspace` block (generative) from `validate` block (assertive). Auto-generation approach avoids new template variables. `--skip-validation` follows the `--skip-metadata-validation` pattern.

### Design decisions

1. **Filesystem-only detection** over `git rev-parse` — works without git binary, faster, deterministic
2. **Auto-generate over template variables** — `${lace.workspace.*}` would require user to write template expressions; auto-generation is zero-config
3. **User-set values always win** — consistent with port/mount auto-injection suppression
4. **Two-level severity** (error/warn) — no need for info level, keeps it simple
5. **No "auto" layout mode yet** — explicit `layout: "bare-worktree"` avoids surprising behavior; can add later
6. **Baked-in over feature** — workspace logic runs on host before container, modifies host-side config, needs no network

### Review iteration

**R1**: 3 blocking, 6 non-blocking findings. All blocking fixed:
- F1: `WorkspaceLayoutResult.status` discriminated field replaces string-matching
- F2: `mergePostCreateCommand` idempotency guard + `structuredClone` ordering note
- F3: `checkAbsolutePaths` `excludeWorktree` parameter avoids duplicate warnings

**R2**: **Accepted**. 4 non-blocking items noted for implementor (expandPath deferral, commands/up.ts detail, array-format idempotency, skip-validation scope).

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/devlogs/2026-02-15-workspace-validation-proposal.md` | This devlog |
| `cdocs/proposals/2026-02-15-workspace-validation-and-layout.md` | Main proposal |
| `cdocs/reviews/2026-02-15-review-of-workspace-validation-and-layout.md` | R1 + R2 review |

## Verification

Proposal accepted after 2 review rounds. All blocking findings resolved. Ready for implementation.
