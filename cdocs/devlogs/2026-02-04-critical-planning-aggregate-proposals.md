---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:55:00-08:00
type: devlog
state: live
status: complete
tags: [planning, wezterm, dotfiles, implementation]
---

# Critical Planning: Aggregate Proposal Analysis

## Objective

Review all four wezterm/dotfiles-related proposals in aggregate to:
1. Identify dependencies between proposals
2. Determine implementation order
3. Decide which proposals can proceed without additional user review
4. Flag the multi-project refactor for user review (as explicitly requested)

## Proposals Under Review

| Proposal | Status | Complexity |
|----------|--------|------------|
| Plugin Proper Packaging (`wezterm-plugin-proper-packaging.md`) | ACCEPTED | Low |
| Multi-Project Support (`multi-project-wezterm-plugin.md`) | NEEDS REVISION | High |
| Project Picker (`wezterm-project-picker.md`) | ACCEPTED | Medium |
| Neovim/WezTerm Migration (`nvim-wezterm-config-migration.md`) | ACCEPTED | Low |

## Dependency Analysis

### Dependency Graph

```
Plugin Packaging (new repo)
    |
    v (optional - plugin works with file:// too)
All Other Proposals

Multi-Project Refactor
    |
    v (required for full functionality)
Project Picker (needs multi-project to show multiple projects)

Neovim/WezTerm Migration
    |
    v (no dependencies)
Independent - can proceed now
```

### Detailed Analysis

#### 1. Plugin Proper Packaging (`wezterm-plugin-proper-packaging.md`) - ACCEPTED

**Dependencies:** None

**What it does:**
- Creates new GitHub repo `weftwiseink/lace.wezterm`
- Moves `config/wezterm/lace-plugin/` to the new repo
- Updates dotfiles to load plugin via GitHub URL instead of `file://`

**Blocking others?** No. Other proposals can work with either `file://` or `https://` plugin loading.

**Recommendation:** CAN PROCEED INDEPENDENTLY

**Note:** This is a straightforward migration involving:
- Creating a new GitHub repo
- Copying files
- Updating URLs in dotfiles

#### 2. Multi-Project Support (`multi-project-wezterm-plugin.md`) - NEEDS REVISION

**Dependencies:** None (foundational change)

**What it does:**
- Implements hash-based dynamic port allocation
- Creates project registry in `~/.config/lace/settings.json`
- Adopts `lace:<project>` domain naming
- Replaces per-project keybindings with unified picker
- Major refactor to lace CLI and wezterm plugin

**Blocked by:** Nothing

**Blocking others:** Project Picker (partially - see below)

**User requested:** EXPLICIT MANUAL REVIEW REQUIRED

**Recommendation:** DO NOT LAUNCH - Awaiting user review

#### 3. Project Picker (`wezterm-project-picker.md`) - ACCEPTED

**Dependencies:** PARTIAL dependency on Multi-Project Support

**Analysis of the dependency:**

The Project Picker proposal specifies:
- Projects configured in `~/.config/lace/settings.json` under `wezterm.projects`
- Picker shows all registered projects with status indicators
- Connects to selected project's SSH domain

**The critical question: Does it work with only one project?**

YES, it can work with a single project. The picker reads from `settings.json`, and even with one project:
- Leader+P would show one project in the picker
- User could select it and connect
- The picker value is in providing a unified UI, even for single-project use

HOWEVER, the proposal heavily relies on the `settings.json` project registry structure, which is being designed in the Multi-Project proposal. The two proposals define overlapping configuration schemas:

| Multi-Project Proposal | Project Picker Proposal |
|------------------------|------------------------|
| `settings.projects.<name>.sshPort` | `settings.wezterm.projects.<name>.sshPort` |
| `settings.projects.<name>.status` | (detected via SSH probe) |
| `settings.projects.<name>.workspacePath` | `settings.wezterm.projects.<name>.repoPath` |

**This is a CONFLICT that needs resolution before implementation.**

**Recommendation:** DO NOT LAUNCH YET - Schema conflict with Multi-Project proposal needs resolution

#### 4. Neovim/WezTerm Config Migration (`nvim-wezterm-config-migration.md`) - ACCEPTED

**Dependencies:** None

**What it does:**
- Copies neovim config from lace to dotfiles
- Cleans up lace wezterm.lua to be minimal plugin demo
- Removes `config/nvim/` from lace after migration

**Blocking others?** No

**Blocked by?** No - Works with current plugin location (`file://`)

**Recommendation:** CAN PROCEED INDEPENDENTLY

## Schema Conflict Analysis

The Multi-Project and Project Picker proposals define overlapping but different schema structures for the project registry:

**Multi-Project proposal (`settings.projects`):**
```json
{
  "plugins": { ... },
  "projects": {
    "lace": {
      "workspacePath": "/home/user/code/weft/lace",
      "sshPort": 2547,
      "sshKey": "~/.ssh/lace_devcontainer",
      "username": "node",
      "containerWorkspace": "/workspace",
      "status": "running"
    }
  }
}
```

**Project Picker proposal (`settings.wezterm.projects`):**
```json
{
  "plugins": { ... },
  "wezterm": {
    "projects": {
      "lace": {
        "displayName": "Lace",
        "sshPort": 2222,
        "sshUser": "node",
        "sshKey": "~/.ssh/lace_devcontainer",
        "workspacePath": "/workspace",
        "mainWorktree": "lace",
        "repoPath": "~/code/weft/lace"
      }
    }
  }
}
```

**Key differences:**
1. Location: `settings.projects` vs `settings.wezterm.projects`
2. Path naming: `workspacePath` (host) vs `repoPath` (host) + `workspacePath` (container)
3. Port source: Multi-Project derives from hash, Picker expects explicit
4. Status: Multi-Project stores it, Picker detects it

**Resolution needed:** These proposals need to agree on a single schema before either can be implemented.

## Final Recommendations

### Proceed with Implementation

| Proposal | Rationale |
|----------|-----------|
| Plugin Proper Packaging | No dependencies, straightforward, ACCEPTED |
| Neovim/WezTerm Migration | No dependencies, straightforward, ACCEPTED |

### Hold for User Review

| Proposal | Rationale |
|----------|-----------|
| Multi-Project Support | User explicitly requested manual review |
| Project Picker | Schema conflict with Multi-Project needs resolution |

## Implementation Order (for approved proposals)

1. **Neovim/WezTerm Migration** - Can start immediately, no external dependencies
2. **Plugin Proper Packaging** - Can start immediately, requires GitHub repo creation

These two can run in parallel as they touch different files and systems.

## Blocking Issues Summary

1. **Schema conflict between Multi-Project and Project Picker proposals** - Must be resolved before either can be implemented

2. **User review required for Multi-Project** - As explicitly requested

## Recommended Next Steps

1. Launch `/implement` for `nvim-wezterm-config-migration.md` - straightforward file migration
2. Launch `/implement` for `wezterm-plugin-proper-packaging.md` - repo creation and migration
3. Wait for user to review Multi-Project proposal and provide feedback
4. After Multi-Project review: reconcile schema with Project Picker, then implement both together
