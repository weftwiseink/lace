---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T20:00:00-08:00
task_list: lace/weftwise-migration
type: devlog
state: live
status: done
tags: [migration, weftwise, devcontainer, incremental]
---

# Weftwise Devcontainer Lace Migration Implementation

## Current State Analysis

### Weftwise devcontainer.json (86 lines, before migration)
The current config manually specifies:
- **Workspace layout**: `workspaceMount` pointing to the bare repo parent, `workspaceFolder` at `/workspace/main`, and `postCreateCommand` for git safe.directory
- **Port mapping**: Hardcoded `appPort: ["2222:2222"]` for WezTerm SSH domain
- **Mounts**: Three bind mounts -- bash history, Claude config, SSH public key
- **Post-start**: Manual `wezterm-mux-server --daemonize` command
- **Features**: Only `git:1` and `sshd:1` (no lace features)
- **VS Code settings**: Editor config, extensions, Claude Code settings
- **Build args**: `COMMAND_HISTORY_PATH` tied to bash history mount

### Weftwise Dockerfile (186 lines, before migration)
Installs both project-specific and generic tools:
- **Project-specific (stays)**: System deps for Playwright/Electron (~30 lines), pnpm/corepack (~5 lines), git-delta (~5 lines), Electron pre-install, Playwright browser install, project dependency install and build
- **Generic (migrates to features)**: Neovim v0.11.6 (~8 lines), WezTerm 20240203 via dpkg extraction (~18 lines), runtime dir creation, SSH dir setup, Claude Code 2.1.11 (~3 lines)
- **Removed (no longer needed)**: Bash history persistence setup (~5 lines)

### Lace Features Available
All three features exist in the lace repo at `devcontainers/features/src/`:
1. **wezterm-server** (v1.3.0): Installs wezterm-mux-server, creates runtime dir, sets up SSH authorized_keys, has entrypoint for auto-start. Declares `authorized-keys` mount and `hostSshPort` port.
2. **claude-code** (v1.0.0): Installs Claude Code CLI globally via npm. Declares `config` mount for `/home/${_REMOTE_USER}/.claude`.
3. **neovim** (v1.0.0): Installs Neovim from GitHub releases. Declares `plugins` mount for persistent plugin state.

### Path Resolution
`/home/mjr` and `/var/home/mjr` resolve to the same physical path (`/var/home/mjr`). The relative path from the weftwise project root (where lace runs) to lace features is `../../lace/main/devcontainers/features/src/<feature>`. This crosses repository boundaries and depends on the specific workspace layout on disk.

**Important discovery**: Lace's `fetchFromLocalPath()` resolves feature paths relative to CWD (the project root), NOT relative to the `.devcontainer/` directory. Initial implementation used `../../../` (relative to `.devcontainer/`) which failed. Corrected to `../../` (relative to project root).

### Feature Reference Strategy
GHCR publication is NOT available. For this implementation:
- Features are referenced using local relative paths with OCI reference placeholders in comments
- Local paths (`../../lace/main/devcontainers/features/src/<feature>`) work because both repos live under the same `/home/mjr/code/weft/` parent
- Once GHCR publication is established, these should be updated to `ghcr.io/weftwiseink/lace/<feature>:1`

## Implementation Log

### Phase 1: Adopt Workspace Layout Detection
- Removed `workspaceMount`, `workspaceFolder`, `postCreateCommand` from devcontainer.json
- Added `customizations.lace.workspace` with `layout: "bare-worktree"` and `mountTarget: "/workspace"`
- Removed `COMMAND_HISTORY_PATH` build arg (was tied to bash history persistence)
- Preserved all VS Code customizations including existing `git.repositoryScanMaxDepth: 2`
- Commit: `refactor(devcontainer): adopt lace workspace layout detection`

### Phase 2: Adopt Features (with local path refs)
- Modified Dockerfile to remove:
  - Neovim install (lines 97-106)
  - WezTerm install (lines 108-125)
  - Runtime dir creation (line 128)
  - SSH dir setup (lines 130-133)
  - Claude Code install (line 160)
  - Bash history persistence (lines 76-81, build arg COMMAND_HISTORY_PATH)
  - CLAUDE_CODE_VERSION, NEOVIM_VERSION, WEZTERM_VERSION build args
- Added `# REMOVED:` comments per proposal
- Added features to devcontainer.json using local relative paths with OCI ref comments
- Removed `postStartCommand` (wezterm-server feature entrypoint handles this)
- Commit: `refactor(devcontainer): replace manual tool installs with lace features`

### Phase 3: Adopt Port Allocation
- Removed `appPort: ["2222:2222"]` from devcontainer.json
- Added comment noting host WezTerm config needs updating to use `wez-into` for dynamic port discovery
- Commit: `refactor(devcontainer): remove hardcoded appPort for lace port allocation`

### Phase 4: Adopt Mount Declarations
- Removed entire `mounts` array from devcontainer.json
- Added `customizations.lace.mounts` with `nushell-config` declaration
- Feature-injected mounts (claude-code/config, neovim/plugins, wezterm-server/authorized-keys) are auto-declared by their respective features
- Commit: `refactor(devcontainer): replace static mounts with lace mount declarations`

### Phase 5: Adopt Host Validation
- Added `customizations.lace.validate.fileExists` for the SSH key at `~/.config/lace/ssh/id_ed25519.pub`
- Includes remediation hint for key generation
- Commit: `feat(devcontainer): add lace host validation for SSH key`

### Path Fix and .gitignore
- Fixed feature paths from `../../../` to `../../` (relative to project root, not `.devcontainer/`)
- Added `.lace/` to `.gitignore`
- Commit: `fix(devcontainer): correct local feature paths and add .lace to gitignore`

## Verification Results

### lace up --skip-devcontainer-up (successful)
Ran `lace up --skip-devcontainer-up` from the weftwise project root. Output:
```
Auto-configured for worktree 'main' in /var/home/mjr/code/weft/weftwise
Fetching feature metadata...
Validated metadata for 5 feature(s)
Auto-injected port templates for: wezterm-server/hostSshPort
Auto-injected mount templates for: project/nushell-config, wezterm-server/authorized-keys, claude-code/config, neovim/plugins
Allocated ports:
  wezterm-server/hostSshPort: 22425
Resolved mount sources:
  project/nushell-config: /home/mjr/.config/nushell
  wezterm-server/authorized-keys: /home/mjr/.config/lace/ssh/id_ed25519.pub
  claude-code/config: /home/mjr/.claude
  neovim/plugins: /home/mjr/.local/share/nvim
LACE_RESULT: {"exitCode":0,"failedPhase":null,"containerMayBeRunning":false}
```

### Generated .lace/devcontainer.json verified to contain:
- `workspaceMount` pointing to bare repo root at `/var/home/mjr/code/weft/weftwise`
- `workspaceFolder` at `/workspace/main`
- `postCreateCommand` for git safe.directory
- `appPort: ["22425:22425"]` (allocated from 22425-22499 range)
- `forwardPorts: [22425]` with `portsAttributes` for silent forwarding
- Four concrete mount strings in `mounts` array
- `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` in `containerEnv`
- `hostSshPort: 22425` injected into wezterm-server feature options
- Project name label `lace.project_name=weftwise` in `runArgs`

### What still needs manual verification
- Actual container build with the reduced Dockerfile
- Feature installation via local paths during `devcontainer build`
- WezTerm mux server auto-start via feature entrypoint
- SSH connection on the allocated port
- Mount source validation (sourceMustBe checks)
- Host validation failure messages (when SSH key is missing)

## Deferred Phases

### Phase 6: Prebuilds (BLOCKED)
**Blocked on**: GHCR publication of features (`ghcr.io/weftwiseink/lace/wezterm-server:1`, `ghcr.io/weftwiseink/lace/claude-code:1`, `ghcr.io/weftwiseink/lace/neovim:1`).

Prebuilds require published OCI references because `lace prebuild` pulls features from a registry to build cached `lace.local/` images. Local path references cannot be used with the prebuild system.

**To unblock**: Establish GHCR publication pipeline for lace devcontainer features. Then add `prebuildFeatures` to `customizations.lace` in devcontainer.json.

### Phase 7: lace up Entry Point (BLOCKED)
**Blocked on**: All prior phases being verified in a real container environment, plus GHCR publication (Phase 6 dependency).

**To unblock**: Complete Phase 6, then verify end-to-end with `lace up` from a clean state. Update project documentation to reference `lace up` instead of `devcontainer up`.

## Summary

Phases 1-5 implemented in the weftwise repo on branch `implement/lace-migration` across 6 commits. The Dockerfile was reduced from 186 to ~110 lines by removing ~60 lines of generic tool installation (Neovim, WezTerm, Claude Code, SSH setup, runtime dir, bash history persistence). These are now provided by three lace devcontainer features referenced via local relative paths.

The devcontainer.json was restructured to use:
- **Workspace layout detection** (`customizations.lace.workspace`) instead of manual `workspaceMount`/`workspaceFolder`/`postCreateCommand`
- **Lace mount declarations** (`customizations.lace.mounts`) instead of static mount strings
- **Lace port allocation** (via wezterm-server feature port metadata) instead of hardcoded `appPort`
- **Host validation** (`customizations.lace.validate`) for SSH key pre-flight checks

Verification via `lace up --skip-devcontainer-up` confirmed all declarations are correctly resolved. Phases 6 (prebuilds) and 7 (lace up entry point) are deferred pending GHCR feature publication.
