---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T12:00:00-07:00
task_list: lace/nushell-history
type: proposal
state: live
status: request_for_proposal
tags: [lace, nushell, history, mounts]
---

# RFP: Lace Nushell History Persistence

> BLUF: Nushell command history is lost when lace containers are rebuilt because history is stored in an ephemeral sqlite database inside the container. Persisting history requires bind-mounting the sqlite files to the host, but sqlite's WAL mode and nushell's config directory structure create complications that need careful design. The target is a single shared history directory at `~/.config/lace/shared/nushell/` on the host, accessible across all containers.

## Objective

Enable nushell command history to survive container rebuilds and be shared across all lace-managed containers.
History is one of the highest-value pieces of developer state: losing it on every rebuild degrades the container experience significantly.

## Scope

The full proposal should explore:

### Nushell History Internals

- Nushell stores history in `$nu.history-path`, defaulting to `~/.config/nushell/history.sqlite3`.
- SQLite WAL mode produces three files: `history.sqlite3`, `history.sqlite3-shm`, and `history.sqlite3-wal`.
- All three files must be co-located and accessible for correct operation.
- Whether `$env.NU_HISTORY_PATH` or `$env.config.history.file_path` can override the default location.

### Mount Strategies

- **Mount the entire `~/.config/nushell/` directory**: Simple, but conflicts with chezmoi-managed nushell config files inside the container. The host directory would shadow container-side config.
- **Mount only history files**: More surgical, but sqlite WAL behavior may require mounting the parent directory. Individual file bind mounts don't handle WAL/SHM file creation well.
- **Mount a dedicated history directory**: Point nushell's history to a non-default path (e.g., `/home/user/.local/share/lace/nushell-history/`) that is bind-mounted to `~/.config/lace/shared/nushell/` on the host.
- **Symlink approach**: Mount the host directory somewhere, then symlink from nushell's expected history path.

### SQLite WAL Complications

- SQLite WAL files are created and deleted dynamically. A bind mount of individual files won't see newly created WAL/SHM files.
- Directory-level mounts avoid this problem but have broader scope.
- Filesystem semantics: do overlayfs or bind mounts on the host support sqlite WAL correctly? Known issues with NFS and some FUSE filesystems.
- Concurrent access: if two containers share the same history directory, sqlite locking must work across bind mounts.

### Chezmoi Interaction

- Chezmoi manages `~/.config/nushell/config.nu`, `env.nu`, etc.
- If the whole nushell config directory is mounted from host, chezmoi's container-side files are shadowed.
- The proposal should ensure chezmoi-managed config and host-persisted history coexist cleanly.

### Host Directory Structure

- Proposed host path: `~/.config/lace/shared/nushell/`.
- "shared" indicates cross-container state (vs per-project state).
- Directory must be created on `lace up` if it doesn't exist.

## Open Questions

1. **Mount granularity**: Is a dedicated history directory (not `~/.config/nushell/`) the right approach? What is the minimal mount that handles WAL/SHM correctly?

2. **SQLite WAL over bind mounts**: Has anyone validated that sqlite WAL mode works reliably over Docker bind mounts on ext4/btrfs? Are there known failure modes?

3. **Concurrent container access**: If two containers write to the same history sqlite, does sqlite locking work correctly? Or should each container get its own history file with periodic merge?

4. **Nushell config override**: Does nushell support `$env.config.history.file_path` or an equivalent env var to redirect history to a custom location without modifying `config.nu`?

5. **Chezmoi reconciliation**: If chezmoi manages nushell config and history lives elsewhere, how does the config point to the non-default history path? Template the path in `config.nu`?

6. **Migration**: How to handle existing in-container history when this feature is enabled? Copy-on-first-mount?
