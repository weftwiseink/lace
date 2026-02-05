---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-05T00:00:00-08:00
type: devlog
state: archived
status: done
tags: [wezterm, multi-project, proposal-revision, port-allocation, registry]
related_to:
  - cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
  - cdocs/proposals/2026-02-04-wezterm-project-picker.md
  - cdocs/reviews/2026-02-04-review-of-multi-project-wezterm-plugin.md
---

# Devlog: Multi-Project WezTerm Plugin Proposal Revision

## Context

The multi-project WezTerm plugin proposal underwent review and received "revision requested" status. The review identified several blocking issues that needed resolution. Additionally, the user made specific decisions about implementation details that differed from the original proposal.

## User Decisions Incorporated

### 1. Registry Path: `settings.projects` (Top-Level)

**Original proposal**: `settings.projects` (already top-level)
**Project picker proposal**: `settings.wezterm.projects` (nested)
**Decision**: Use `settings.projects` at the top level

**Rationale**: Projects are not exclusively a wezterm concern. The registry is used by:
- lace CLI for port allocation
- lace CLI for status tracking
- lace CLI for wezterm capability detection
- WezTerm plugin for domain registration

A top-level key makes this multi-purpose nature clear.

**Action**: Updated project picker proposal to use `settings.projects` instead of `settings.wezterm.projects` throughout.

### 2. Port Allocation: Sequential from 11024

**Original proposal**: Hash-based (CRC32) allocation with collision handling
**Decision**: Sequential allocation starting at port 11024

**Rationale**:
- Zero collision probability by design
- No birthday problem math required
- Simpler implementation
- 11024 is memorable (l=12, a=1, c=3, e=5 -> simplified to 11024)

**Algorithm**:
```
1. Read existing projects from registry
2. Find highest port in use (starting from 11024)
3. Assign next available (first project gets 11024, second gets 11025, etc.)
```

**Action**: Removed all hash-based allocation code and collision probability sections. Replaced with sequential allocation algorithm.

### 3. Port Configuration: `.lace/devcontainer.json`

**Original proposal**: Mechanism underspecified (flagged as blocking issue)
**Decision**: Extend `.lace/devcontainer.json` with computed `appPort`

**Implementation**:
- `lace up` writes derived port to `.lace/devcontainer.json` as `appPort`
- Docker Compose merges extended config with base devcontainer.json
- This follows existing pattern where `.lace/devcontainer.json` provides project-specific overrides

**Action**: Added explicit specification of how `lace up` configures the port.

### 4. Lua File I/O: `io.open()`

**Original proposal**: File I/O approach unspecified (flagged as blocking issue)
**Decision**: Use `io.open()` directly for reading settings.json

**Rationale**:
- `io.open()` is available in WezTerm's Lua environment
- Simpler than `wezterm.run_child_process`
- Validated in WezTerm Sidecar proposal research

**Fallback**: If `io.open()` doesn't work in a specific environment, fall back to `wezterm.run_child_process({"cat", settings_file})`.

**Action**: Added explicit code showing `io.open()` usage with fallback note.

### 5. Plugin Structure: Single `init.lua`

**Original proposal**: Multiple files (`registry.lua`, `picker.lua`, `worktree.lua`)
**Decision**: Single `init.lua` file

**Rationale**:
- WezTerm plugins require `plugin/init.lua` as entry point
- Multi-file plugins require `package.path` manipulation (complexity)
- Plugin is not large enough to warrant multi-file structure

**Action**: Removed references to separate files. Updated implementation phases to only modify `init.lua`.

### 6. Picker Filtering: Show All, Enable Wezterm-Capable

**Original proposal**: Unclear how to handle non-wezterm projects
**Decision**: Show ALL projects but only allow selecting wezterm-enabled ones

**Implementation**:
- `lace up` detects wezterm capability by checking for `wezterm-server` feature in devcontainer.json
- Stores `weztermEnabled` boolean in registry
- Picker shows all projects
- Wezterm-enabled projects can be selected normally
- Non-wezterm projects show "(no wezterm)" suffix
- Selecting non-wezterm project shows toast notification explaining why

**Rationale**: Users should see all their projects and understand why some can't be connected via wezterm.

**Action**: Added wezterm capability detection section and updated picker code.

### 7. API Transition Section

**Original proposal**: Missing (flagged as blocking issue)
**Decision**: Add comprehensive API transition section

**Coverage**:
- Current single-project API documentation
- New multi-project API documentation
- Backward compatibility implementation
- Migration steps for users

**Action**: Added "API Transition" section with code examples.

## Review Issues Addressed

| Review Item | Status | Resolution |
|-------------|--------|------------|
| Collision probability inconsistent | Resolved | Removed entirely (sequential allocation has zero collision) |
| Port mapping mechanism underspecified | Resolved | Specified `.lace/devcontainer.json` appPort pattern |
| Lua file I/O validation needed | Resolved | Specified `io.open()` with fallback |
| Workspace-to-project mapping | Resolved | Documented in edge cases (E8) |
| Multi-file plugin structure | Resolved | Changed to single init.lua |
| API transition missing | Resolved | Added comprehensive section |
| Domain overwrite explanation | Resolved | Clarified in background section |
| Duplicate sanitized names | Resolved | Added edge case E2 with suffix resolution |

## Schema Alignment

Both proposals now use the same registry schema:

```typescript
interface LaceSettings {
  plugins?: Record<string, PluginConfig>;
  projects?: Record<string, ProjectConfig>;
}

interface ProjectConfig {
  workspacePath: string;
  sshPort: number;
  sshKey: string;
  username: string;
  containerWorkspace: string;
  lastStarted?: string;
  status?: "running" | "stopped" | "unknown";
  weztermEnabled?: boolean;
  displayName?: string;
  // Project picker also uses:
  mainWorktree?: string;
  repoPath?: string;
}
```

## Files Modified

1. **`cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md`**
   - Complete revision incorporating all user decisions
   - Added revision metadata in frontmatter
   - Removed hash-based allocation
   - Added sequential allocation
   - Added wezterm detection
   - Added API transition section
   - Consolidated plugin structure
   - Updated test plan

2. **`cdocs/proposals/2026-02-04-wezterm-project-picker.md`**
   - Changed `settings.wezterm.projects` to `settings.projects` throughout
   - Updated schema to match multi-project proposal
   - Updated jq queries in CLI script
   - Updated domain naming to use `lace:<name>` format
   - Added revision metadata

3. **`cdocs/devlogs/2026-02-04-multi-project-proposal-revision.md`** (this file)
   - Documents revision decisions
   - Tracks alignment between proposals

## Next Steps

1. Run `/review` on revised multi-project proposal to verify blocking issues are resolved
2. Proceed to implementation if review passes
