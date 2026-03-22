---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T13:02:05-07:00
task_list: terminal-management/tmux-migration
type: devlog
state: live
status: review_ready
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T13:15:17-07:00
  round: 1
tags: [architecture, terminal_management, tmux, migration, lace_into]
---

# tmux Migration Implementation

> BLUF: Implemented the accepted proposal at `cdocs/proposals/2026-03-21-tmux-return-and-lace-into.md`.
> Four phases completed: tmux.conf + strip wezterm, lace-into script, nushell cleanup, wezterm-server deletion.
> Changes span two repos: dotfiles (4 commits on `backtotmux` branch) and lace (3 commits on `main`).

## Phase 1: tmux.conf in Dotfiles + Strip Wezterm

### Work Done

1. Created `dot_config/tmux/tmux.conf` in the dotfiles repo with the full config from the proposal: core settings (nushell shell, Alt-z prefix, vi mode, mouse), keybindings (Ctrl-hjkl nav, Alt-HJKL splits, Alt-np windows, Alt-c copy mode), pane titles, conditional UI for vscode/nested, and full plugin stack (TPM, sensible, yank, resurrect, continuum, thumbs, floax, catppuccin, autoreload).
2. Created `run_once_after_20-install-tpm.sh` chezmoi script for TPM bootstrapping.
3. Archived the Slate/solarized theme palette to `archive/themes/slate-solarized.lua` before stripping.
4. Stripped `dot_config/wezterm/wezterm.lua` from ~610 lines to ~70 lines: font, colors, basic window settings, shell, mouse binding. Removed all mux domains, plugins (lace.wezterm, resurrect.wezterm), ExecDomains, smart-splits IPC, Unix domain mux, session logic, keybinding callbacks, copy mode customization, status bar, and event handlers.
5. Included the `lace-split` keybinding (Alt-S) in tmux.conf during this phase rather than Phase 2, since the config was being created. The keybinding reads `@lace_port`/`@lace_user` session options to auto-SSH splits into the current session's container.

## Phase 2: Create lace-into, Delete wez-into

### Work Done

1. Created `bin/lace-into` from `bin/wez-into` with tmux-oriented `do_connect()`.
2. The new `do_connect()` creates a named tmux session with an SSH pane, stores `@lace_port` and `@lace_user` as session-level user options, handles `$TMUX` detection for `attach-session` vs `switch-client`, checks existing sessions via `tmux has-session` with port-based disambiguation, and sets `remain-on-exit on` for dead pane resilience.
3. Added SSH ControlMaster options (`ControlMaster=auto`, `ControlPath`, `ControlPersist=600`) for connection multiplexing.
4. Removed all wezterm-specific code: `XKB_LOG_LEVEL`, python3 pane listing, ExecDomain/mux domain references, three-tier connection fallback, `wezterm cli` calls.
5. Updated all help text, script name references, error messages, and dry-run output from "wez-into" to "lace-into" with tmux command format.
6. Deleted `bin/wez-into`.
7. ~600 lines of multiplexer-agnostic code carried forward unchanged: discovery, `start_and_connect`, argument parsing, picker, error handling, host key management, `LACE_RESULT` parsing.

## Phase 3: Nushell Config Updates

### Work Done

1. Deleted `scripts/wez-session.nu` (OSC 1337 IPC module for wezterm session save/restore). tmux-resurrect handles session persistence at the tmux level.
2. Removed the `source wez-session.nu` line from `config.nu`.
3. Removed the entire wezterm session restoration pre-prompt hook from `config.nu` (WEZTERM_PANE=0 check, wez-list-sessions, Wayland symlink cleanup).
4. Updated `env.nu` path comment from "wez-into prototype" to "lace-into and lace-discover".
5. Preserved `wt-clone.nu` (bare-worktree cloning, not wezterm-specific).

## Phase 4: Cleanup and Integration Testing

### Work Done

1. Deleted `devcontainers/features/src/wezterm-server/` directory (install.sh, devcontainer-feature.json, README).
2. Deleted `devcontainers/features/test/wezterm-server/` directory (7 test files).
3. Removed wezterm-server feature from `.devcontainer/devcontainer.json` prebuildFeatures.
4. Removed wezterm-server from `.devcontainer/devcontainer-lock.json`.
5. Removed wezterm-server test step from `.github/workflows/devcontainer-features-test.yaml`.
6. Removed `lace.wezterm` repoMount from `.devcontainer/devcontainer.json`.
7. Updated `packages/lace/src/commands/up.ts` comments to reference lace-into instead of wez-into.
8. Deleted `packages/lace/src/__tests__/wezterm-server-scenarios.test.ts`.
9. Cleaned up dotfiles repo `.devcontainer/devcontainer.json`: removed wezterm-server feature, mux daemon postStartCommand, and SSH authorized_keys mount.
10. Updated mounts comments in devcontainer.json to remove wezterm-server/authorized-keys references.

### Verification

Grep results for `wez-into` and `wezterm-server` in both repos:
- **Shell scripts, YAML, JSON config**: zero remaining references in both repos.
- **cdocs documents**: references remain in historical documents (proposals, devlogs, reviews). These are correct: historical documents describe the prior approach.
- **TypeScript source/tests**: references remain in `packages/lace/src/` test files that use `wezterm-server` as a test fixture for the feature-metadata system. These are part of the lace framework's feature awareness layer, not wezterm-specific runtime code.

> NOTE(opus/terminal-management): The lace package's test suite references `wezterm-server` as a feature name in test fixtures (e.g., `claude-code-scenarios.test.ts` coexistence tests, `port-allocator.test.ts`, `mount-resolver.test.ts`).
> These tests verify the feature-metadata resolution system, not wezterm itself.
> Renaming or removing these would require rewriting the test fixtures with a different feature name, which is out of scope for this migration.
> The tests will continue to pass since they use mock data, not the actual wezterm-server feature directory.

## Commits

### Dotfiles repo (`/mnt/lace/repos/dotfiles`, branch `backtotmux`)

1. `feat: add tmux.conf and strip wezterm to dumb terminal` (Phase 1)
2. `refactor: remove wezterm hooks from nushell config` (Phase 3)
3. `refactor: remove wezterm-server from dotfiles devcontainer` (Phase 4)

### Lace repo (`/workspaces/lace/main`, branch `main`)

1. `feat: create lace-into, delete wez-into` (Phase 2)
2. `refactor: delete wezterm-server feature and cleanup` (Phase 4)
