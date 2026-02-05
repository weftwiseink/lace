---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T19:00:00-08:00
task_list: lace/dotfiles-migration
type: report
state: live
status: wip
tags: [implementation-summary, dotfiles, archive, nushell, plugin, launcher, cross-proposal]
supersedes:
  - cdocs/reports/2026-02-05-dotfiles-modernization-project-assessment.md
synthesizes:
  - cdocs/devlogs/2026-02-05-archive-migration-implementation.md
  - cdocs/devlogs/2026-02-05-nushell-setup-implementation.md
  - cdocs/devlogs/2026-02-05-plugin-docker-user-lookup-implementation.md
  - cdocs/devlogs/2026-02-05-launcher-elimination-implementation.md
---

# Dotfiles Modernization: Implementation Summary

> BLUF: All four accepted proposals were implemented in a single coordinated session across two repos and six commits. The dotfiles repo moved from a cluttered multi-generation layout to a clean modern stack (nushell primary shell, lace-integrated devcontainer, legacy safely archived). Three nushell v0.110.0 syntax incompatibilities in the proposal were discovered and fixed during implementation. The 373-line workspace launcher script was deleted. End-to-end verification of the devcontainer migration is deferred until the container is rebuilt; all other verification passed. Firefox chezmoi migration remains the only deferred proposal.

## Context / Background

The dotfiles modernization workstream began as a planning session that produced five proposals to transform a cluttered dotfiles repository into a focused modern stack (chezmoi + wezterm + nvim + nushell). Four proposals were accepted through review and sequenced for implementation. A coordinator agent dispatched four background agents in two parallel waves:

- **Wave 1**: Archive Migration (dotfiles repo) + Plugin Docker User Lookup (lace.wezterm repo) -- no dependency, different repos
- **Wave 2**: Nushell Setup (dotfiles repo) + Launcher Elimination (dotfiles repo) -- different files, safe to parallelize

Each agent produced its own devlog, commits, and self-review. This report synthesizes findings from all four implementation devlogs, four self-reviews, and the coordinator's cross-phase verification.

### Source Proposals

| # | Proposal | Review Status |
|---|----------|---------------|
| 1 | Legacy Archive Migration (Clean Rewrite) | R1 accepted |
| 2 | Nushell Configuration Setup | R3 accepted |
| 3 | Docker User Lookup (lace.wezterm plugin) | R1 accepted (revisions applied) |
| 4 | Eliminate Workspace Launcher | Amended, implemented as-is |
| 5 | Firefox Chezmoi Migration | Deferred (template bug unresolved) |

## Implementation Results

### Phase 1: Archive Migration

Moved `bash/`, `vscode/`, `blackbox/`, `tmux.conf`, `init.vim`, and two chezmoi `run_once` scripts to `archive/legacy/`. Rerouted three source paths in `dot_bashrc`. Materialized two VSCode symlinks as regular files.

- **Commits**: `2ef5d95` (copy to archive), `a61ba74` (delete originals + reroute paths)
- **Net change**: 20 files created, 19 files deleted, 1 modified (`dot_bashrc`)
- **Verification**: Shell loads from new paths, starship preserved, out-of-scope dirs untouched, VSCode configs materialized
- **Self-review verdict**: Accepted. Two non-blocking documentation suggestions.

### Phase 2: Nushell Setup

Created 9 nushell configuration files (`env.nu`, `config.nu`, `login.nu`, plus 6 scripts), a carapace installer script, and set WezTerm's `default_prog` to nushell. Three syntax fixes applied during startup testing (detailed in "Unexpected Details" below).

- **Commits**: `de01d5e` (nushell config, 10 files, 396 insertions), `b2da41b` (wezterm default_prog + plugin path fix)
- **Verification**: 10/10 tests pass -- vi-mode, EDITOR, SQLite history, starship, color config, completions, aliases, utility commands, startup time 153ms (target: <500ms)
- **Self-review verdict**: Revise (one blocking finding about config loading documentation -- see "Unexpected Details"). Implementation itself is correct.

### Phase 3: Plugin Docker User Lookup

Modified the lace.wezterm plugin's `setup_project_picker()` to override the SSH domain username with the Docker-discovered container user at connection time. Added `StrictHostKeyChecking = "accept-new"` to SSH domain options.

- **Commit**: `172a059` (plugin/init.lua, +21/-5 lines, net +16)
- **Verification**: `luac -p` syntax check passes, signature consistency verified, guard preservation verified
- **Self-review verdict**: Accepted. One non-blocking note about devlog status field.
- **Testing gap**: No runtime test against a live container (current lace container is on port 2222, outside discovery range). Deferred to post-rebuild.

### Phase 4: Launcher Elimination

Changed dotfiles devcontainer port from 2223 to 22426 (lace discovery range), switched SSH key from `dotfiles_devcontainer` to `lace_devcontainer`, and deleted the 373-line `bin/open-dotfiles-workspace` launcher script.

- **Commit**: `67c0ea8` (2 files changed, 4 insertions, 377 deletions)
- **Verification**: Port in lace range confirmed, SSH key exists, mount target preserves `vscode` user, no stale references found
- **Self-review verdict**: Accepted. Two non-blocking documentation suggestions.
- **Testing gap**: Container must be rebuilt to verify end-to-end discovery and connection.

## Important Unexpected Details and Changes

This section documents deviations from proposals, edge cases, and design decisions discovered during implementation. These were extracted from all four devlogs and the coordinator's cross-phase notes.

### Nushell v0.110.0 Syntax Incompatibilities (3 issues)

The nushell proposal (R3 accepted) contained code blocks with syntax that is invalid or deprecated in nushell v0.110.0. These were caught during startup testing and fixed by the implementing agent:

1. **`char escape` does not exist** -- The proposal used `$"(char escape)[01;31m"` for LESS_TERMCAP escape sequences in `env.nu`. Nushell v0.110.0 has no named character called "escape". Fixed to `$"(ansi escape)[01;31m"`, which produces the correct ESC byte (0x1b). **7 occurrences** in env.nu.

2. **`get -i` deprecated since v0.106.0** -- The proposal's `completions.nu` used `get -i 0.expansion` for optional field access. The `-i` (--ignore-errors) flag was deprecated in v0.106.0, replaced with `-o` (--optional). Fixed to `get -o 0.expansion`. **1 occurrence** in completions.nu.

3. **`2>` is not valid nushell syntax** -- The proposal's `utils.nu` used bash-style `2> /dev/null` for stderr redirection. Nushell requires `err> /dev/null`. Fixed in `git-track-all` and `docker-clean` functions. **3 occurrences** in utils.nu.

**Lesson learned**: The proposal review rounds (R1-R3) focused on design correctness, not runtime syntax validation against the installed nushell version. Proposals containing runnable code should ideally be spot-checked against the target runtime version, or at minimum note the version they were written against.

### `nu -c` vs `nu -l -c` Config Loading Behavior

The implementing agent initially documented that nushell's `-l` (login) flag is required for config loading. The self-review caught this as **factually inaccurate**:

- Nushell loads `env.nu` and `config.nu` in **interactive mode** (when attached to a PTY), not specifically in login mode.
- The `-c` flag runs in non-interactive mode, which skips config loading entirely. This is different from `bash -c` which also skips most config, but the mechanism is different.
- `nu -l -c` happened to trigger config-like loading during testing, but the actual mechanism for normal usage is interactivity (PTY attachment), not login status.
- WezTerm's `default_prog` spawns an **interactive non-login shell** -- config files load because of the PTY, not because of any `-l` flag.
- Consequence: `login.nu` will **not** execute in normal WezTerm usage. This is harmless now (login.nu only has commented-out tmux code) but could cause confusion if login.nu is used for real logic later.

This was flagged as a blocking documentation fix in the nushell devlog's self-review. The devlog text was subsequently corrected.

### Launcher Line Count Discrepancy

The launcher elimination proposal cited 374 lines for `bin/open-dotfiles-workspace`. The actual count was **373 lines** -- the file had no trailing newline. Trivial but documented for accuracy.

### Pre-Existing Uncommitted Changes in Dotfiles Repo

The dotfiles repo had two uncommitted changes before implementation began:
- A renamed `archive/setup.sh.archive` file
- A modified `dot_config/wezterm/wezterm.lua` (plugin path fix from an earlier session)

Both were unrelated to the modernization work. The archive agent created a backup branch `pre-legacy-archive-backup` and all agents left these changes untouched. The wezterm.lua change was eventually committed alongside the nushell `default_prog` change in commit `b2da41b`.

### Domain Re-Registration Relies on Lua Reference Semantics

The plugin implementation depends on a subtle language property: Lua tables are reference types. When `setup_project_picker` receives `config`, it receives a reference to the same table WezTerm reads at connection time. Mutating `domain.username` in the picker callback changes what WezTerm sees when it processes the `SwitchToWorkspace` action. This is correct and the self-review confirmed it is idempotent (re-running `discover_projects()` on each picker open always reflects the latest container state), but it is a design decision worth documenting since it differs from a "create a new domain" approach.

### `StrictHostKeyChecking = "accept-new"` Added Opportunistically

The plugin proposal specified this SSH option, but it was implemented as part of the plugin change rather than as a separate step. The `accept-new` value accepts unknown host keys on first connection but rejects changed keys -- the right security posture for ephemeral devcontainers where host keys rotate on rebuild.

### Archive Migration Preserved Chezmoi Compatibility

The archive proposal was specifically rewritten (from a superseded original) to be chezmoi-agnostic. The implementation confirmed this: all operations were `cp`, `git rm`, `git add`, `git commit` -- no chezmoi commands used. Legacy chezmoi `run_once` scripts (blesh, tpm) were archived under `archive/legacy/chezmoi_run_once/`, preventing them from running on future `chezmoi apply`. The starship `run_once` script was correctly left at repo root since starship is shared with nushell.

### No Stale `open-dotfiles-workspace` References Found

The launcher elimination agent searched the entire dotfiles repo for references to the deleted script across all file types (`.sh`, `.json`, `.md`, `.lua`, bashrc, aliases). Only 4 self-references within the script itself were found. No external references existed -- the launcher was only ever invoked manually.

## Commit Summary

### Dotfiles Repo (`/home/mjr/code/personal/dotfiles/`, branch `weztime`)

| Hash | Phase | Message | Files Changed |
|------|-------|---------|---------------|
| `2ef5d95` | 1: Archive | archive: copy legacy files to archive/legacy/ (Phase 2) | 20 new files, +3199 |
| `a61ba74` | 1: Archive | archive: move legacy bash/tmux/vscode/blackbox to archive/legacy/ | 21 files, +3/-3202 |
| `de01d5e` | 2: Nushell | feat(nushell): add nushell configuration as primary interactive shell | 10 files, +396 |
| `b2da41b` | 2: Nushell | feat(wezterm): set nushell as default shell, update plugin config | 2 files |
| `67c0ea8` | 4: Launcher | refactor(devcontainer): migrate to lace port-range model, delete launcher | 2 files, +4/-377 |

### lace.wezterm Repo (`/home/mjr/code/weft/lace.wezterm/`, branch `main`)

| Hash | Phase | Message | Files Changed |
|------|-------|---------|---------------|
| `172a059` | 3: Plugin | feat: override SSH domain username with Docker-discovered user at connect time | 1 file, +21/-5 |

### Totals

- **6 commits** across 2 repos
- **56 files** touched (many are archive copies)
- **373 lines deleted** (launcher script alone)
- **Net new functionality**: 9 nushell config files, 1 carapace installer, 16-line plugin enhancement

## Deferred Work

### Requires Container Rebuild (Manual)

These cannot be verified until the dotfiles devcontainer is rebuilt with the new configuration:

1. **End-to-end discovery test**: Run `devcontainer up --workspace-folder ~/code/personal/dotfiles --remove-existing-container`, then verify `lace-discover` shows `dotfiles:22426:vscode:/home/mjr/code/personal/dotfiles`.
2. **Plugin picker test**: Open the WezTerm project picker and verify it connects to the dotfiles container as user `vscode` via `lace:22426`.
3. **`wez-lace-into dotfiles` test**: Verify the CLI shortcut connects correctly.

### Requires WezTerm Restart (Manual)

4. **`default_prog` activation**: WezTerm must be restarted to pick up the `default_prog = { '/home/mjr/.cargo/bin/nu' }` change.
5. **Interactive nushell verification**: Vi-mode cursor shapes, keybindings, starship prompt rendering, and `man` page LESS_TERMCAP colors should be verified in a real terminal session.

### Cleanup (Low Priority)

6. **Old SSH key removal**: Delete `~/.ssh/dotfiles_devcontainer` and `~/.ssh/dotfiles_devcontainer.pub` after confirming the lace key migration works.
7. **`dot_bashrc` stale comment**: Line 15-16 comment about "future migration" is slightly misleading post-archive but harmless.
8. **Convenience alias**: Consider adding `alias dotfiles-up='devcontainer up --workspace-folder ~/code/personal/dotfiles'` to nushell or bash config.

### Still Deferred (From Original Assessment)

9. **Firefox chezmoi migration**: Template bug (`profiles.ini` may not exist) unresolved. Existing manual symlink works. Lowest priority in the workstream.
10. **Chezmoi bootstrap**: Chezmoi has not been applied on this machine. Nushell config was deployed manually via `cp`. Future `chezmoi apply` will handle deployment going forward.

## Self-Review Findings Summary

All four implementation devlogs received self-reviews. Three were accepted outright; one (nushell) required a documentation revision.

| Phase | Verdict | Blocking Findings | Non-Blocking Findings |
|-------|---------|-------------------|----------------------|
| Archive | Accept | 0 | 2 (doc clarity on system-side changes; stale bashrc comment) |
| Nushell | Revise | 1 (config loading mode documentation) | 2 (proposal syntax errata; status field) |
| Plugin | Accept | 0 | 2 (devlog status field; proposal status update after testing) |
| Launcher | Accept | 0 | 2 (prerequisites framing; cron/systemd reference check note) |

The single blocking finding (nushell config loading documentation) was corrected: the devlog now correctly states that nushell loads config based on interactivity (PTY attachment), not login status, and that WezTerm spawns an interactive non-login shell.
