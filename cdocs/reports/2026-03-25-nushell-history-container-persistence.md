---
first_authored:
  by: "@claude-opus-4-6-20250514"
  at: 2026-03-25T11:19:00-07:00
task_list: lace/nushell-history
type: report
state: live
status: wip
tags: [lace, nushell, history, chezmoi, dotfiles]
---

# Nushell History Persistence in Lace Devcontainers

> BLUF: The simplest viable solution is a post-chezmoi init step that drops a `.nu` file into nushell's user autoload directory (`~/.config/nushell/autoload/`) inside the container.
> This file conditionally redirects history to a persistent bind-mounted path when `$env.DEVCONTAINER` is set.
> No chezmoi templating or config.nu changes are needed.
> SQLite WAL mode is confirmed active on the history database and poses a real corruption risk with naive bind mounts, but is mitigable with a container-local volume.

## Core Tension

`config.nu` is deployed by chezmoi from a shared dotfiles repo to both the host machine and lace containers.
History configuration lives in `config.nu` at `$env.config.history.*`.
Hardcoding a container-specific history path would break the host, and nushell 0.110 has no `config.history.path` setting.

## Findings by Approach

### 1. Chezmoi Templating (`config.nu.tmpl`)

Chezmoi supports `.tmpl` on any file extension, so `config.nu.tmpl` works syntactically.
Template syntax uses Go text/template (`{{ if }}`) which is file-type agnostic.

```
# would work in dot_config/nushell/config.nu.tmpl:
{{ if env "DEVCONTAINER" }}
# container-specific config
{{ end }}
```

**Verdict:** Works but couples the shared config file to container awareness.
Every nushell config edit now requires reasoning about template branching.
The `.chezmoiignore` already uses templating, so the pattern is established, but applying it to `config.nu` increases maintenance burden on a high-churn file.

### 2. Environment Variable Override (`NU_HISTORY_PATH` or similar)

No such environment variable exists in nushell 0.110.
There is no `$env.config.history.path` config key either: setting it produces `Unknown config option: $env.config.history.path`.

Confirmed by testing on nushell 0.110.0:

```
$env.config.history | columns
# => [max_size, sync_on_enter, file_format, isolation]
```

[PR #14434](https://github.com/nushell/nushell/pull/14434) ("Add `config.history.path`") was closed without merge.
[Issue #17419](https://github.com/nushell/nushell/issues/17419) ("Allow configuring history file path via config.nu") is also closed.

**Verdict:** Not available. No upstream path forward on the current nushell release.

### 3. XDG_CONFIG_HOME Override

Nushell history lives at `$XDG_CONFIG_HOME/nushell/history.sqlite3` (confirmed: `~/.config/nushell/history.sqlite3` on the host).
Setting `XDG_CONFIG_HOME` in `containerEnv` redirects the history path.

Tested: `XDG_CONFIG_HOME=/tmp/test nu -c '$nu.history-path'` returns `/tmp/test/nushell/history.txt`.

**Problem:** This also redirects the config directory itself.
Chezmoi deploys `config.nu` and `env.nu` to `~/.config/nushell/`, so changing `XDG_CONFIG_HOME` means chezmoi would need to target the new path.
This creates a circular dependency: the container needs a different `XDG_CONFIG_HOME` to isolate history, but chezmoi targets the standard path.

**Verdict:** Too many side effects. `XDG_CONFIG_HOME` is a blunt instrument.

### 4. env.nu Conditional Logic

`env.nu` runs before `config.nu` and has access to `$env.DEVCONTAINER` (set in the Dockerfile as `ENV DEVCONTAINER=true`).
However, `env.nu` is also chezmoi-managed and shared with the host.

The same templating concern from approach 1 applies: adding container-conditional logic to `env.nu` couples a shared file to container awareness.

**Verdict:** Same drawback as chezmoi templating, just in a different file.

### 5. User Autoload Directory (Recommended)

Nushell 0.100+ loads all `.nu` files from `$nu.user-autoload-dirs` (confirmed as `~/.config/nushell/autoload/` on 0.110).
Autoload files run after `config.nu` and can override `$env.config.*` settings.

> NOTE(opus/lace/nushell-history): The autoload directory is not chezmoi-managed (it's in `.chezmoiignore` via the `scripts/generated/` pattern, though `autoload/` itself is not explicitly ignored).
> This is actually an advantage: container-specific files can be dropped here without affecting the host.

The `lace-fundamentals-init` script (called from `postCreateCommand`) already runs chezmoi apply and could add a post-apply step to create an autoload file:

```nu
# ~/.config/nushell/autoload/container-history.nu
# Dropped by lace-fundamentals-init, not managed by chezmoi
if ("DEVCONTAINER" in $env) {
    # Redirect history to persistent volume
    # $env.config.history.file_format is already "sqlite" from config.nu
}
```

> WARN(opus/lace/nushell-history): The `$env.config.history.path` key does not exist in nushell 0.110.
> Autoload can override `$env.config.history.*` settings that exist (file_format, max_size, sync_on_enter, isolation), but cannot set a custom path.
> This means the autoload approach alone cannot redirect history to a different filesystem location.

This is a critical gap.
The only way to change the history file location in nushell 0.110 is to change `XDG_CONFIG_HOME` before nushell starts.

## The Real Solution: Symlink the History File

Since nushell hardcodes the history path to `$XDG_CONFIG_HOME/nushell/history.sqlite3`, the pragmatic approach is:

1. Create a persistent volume for nushell history (similar to the existing `/commandhistory` pattern for bash).
2. In `lace-fundamentals-init` (post-chezmoi-apply), symlink `~/.config/nushell/history.sqlite3` to the persistent volume.

```sh
# In lace-fundamentals-init, after chezmoi apply:
if [ "$DEVCONTAINER" = "true" ]; then
    NUSHELL_HISTORY_DIR="/commandhistory/nushell"
    mkdir -p "$NUSHELL_HISTORY_DIR"
    # Remove chezmoi-deployed empty file if present, or touch if absent
    rm -f "$HOME/.config/nushell/history.sqlite3"
    rm -f "$HOME/.config/nushell/history.sqlite3-wal"
    rm -f "$HOME/.config/nushell/history.sqlite3-shm"
    ln -sf "$NUSHELL_HISTORY_DIR/history.sqlite3" "$HOME/.config/nushell/history.sqlite3"
fi
```

> NOTE(opus/lace/nushell-history): The WAL and SHM files are created alongside the main database file.
> SQLite follows symlinks, so WAL/SHM files will be created at the symlink target directory, not the symlink source directory.
> This means the persistent volume holds all three files, which is correct.

## SQLite WAL Analysis

**Confirmed:** Nushell's history database uses WAL mode (`PRAGMA journal_mode` returns `wal`).

On the host, the history directory contains three files:

| File | Size | Purpose |
|---|---|---|
| `history.sqlite3` | 266 KB | Main database |
| `history.sqlite3-shm` | 32 KB | Shared memory map |
| `history.sqlite3-wal` | 4.2 MB | Write-ahead log |

**Bind mount concerns:**

- **Host filesystem (ext4/btrfs) bind mounts:** Safe. SQLite WAL works correctly on local filesystems exposed via Docker bind mounts. The kernel provides proper `fcntl` locking semantics.
- **NFS/network mounts:** Unsafe. [Issue #12530](https://github.com/nushell/nushell/issues/12530) documents WAL corruption on NFS. Not relevant for lace (all local).
- **Concurrent access from host and container:** Unsafe if both nushell instances write to the same database simultaneously. The symlink approach avoids this by giving the container its own database.
- **Docker named volumes:** Safe. These use the container's local filesystem.

**Recommendation:** Use a dedicated persistent directory for container history, not a shared bind mount of the host's history database.
The existing `/commandhistory` mount (already bind-mounted from `~/.config/lace/lace/mounts/project/bash-history`) can be extended to hold a `nushell/` subdirectory.

## Recommended Implementation

### Approach: Symlink + Existing `/commandhistory` Volume

**Changes required:**

1. **`lace-fundamentals-init`** (or a new step script): After `chezmoi apply`, symlink the nushell history file to `/commandhistory/nushell/history.sqlite3`. This runs at container start time, so the symlink survives container rebuilds as long as the volume persists.

2. **No changes to `config.nu`, `env.nu`, or chezmoi templates.**

3. **No new mounts needed.** The `/commandhistory` bind mount already exists and persists across container rebuilds. Adding a `nushell/` subdirectory is trivial.

### Why This Is Simplest

- Zero changes to shared dotfiles.
- Zero chezmoi templating complexity.
- Reuses existing persistent volume infrastructure.
- SQLite WAL files land on the persistent volume (symlink target), avoiding the WAL/SHM orphaning problem.
- Works with any future nushell version: if `config.history.path` lands upstream, we can migrate from symlink to config, but the symlink approach is forward-compatible.

### Limitation

- The symlink is fragile if chezmoi is re-applied inside a running container (chezmoi may overwrite the symlink with a real file). Mitigation: ensure the symlink step runs after every chezmoi apply, or add the history file to `.chezmoiignore`.

> TODO(opus/lace/nushell-history): Add `history.sqlite3*` pattern to `.chezmoiignore` in the dotfiles repo so chezmoi never manages the history file itself. This prevents chezmoi from clobbering the symlink on re-apply.

### Alternative Considered: Docker Named Volume at Config Path

Mounting a named volume at `~/.config/nushell/` would give the container its own config directory entirely.
This breaks chezmoi management of nushell config: chezmoi writes to `~/.config/nushell/` but the volume overlay hides those writes.

**Verdict:** Rejected. Breaks the chezmoi deployment model.
