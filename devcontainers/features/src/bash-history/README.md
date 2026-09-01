# Persistent Bash History

Gives each lace devcontainer a persistent, per-project, endless, timestamped
bash history that survives container rebuilds and is never shared across
projects or with the host.

## What it does

- Declares a per-project bind mount at `/bash-history` (via
  `customizations.lace.mounts.history`). Lace auto-injects
  `${lace.mount(bash-history/history)}` into every container the feature is
  enabled in, resolving per-project to
  `~/.config/lace/<projectId>/mounts/bash-history/history` on the host. Because
  that host store lives outside the container image, history survives rebuilds;
  because `projectId` is the bare-repo-root basename, each repo gets a distinct
  store.
- Sets `containerEnv.HISTFILE = /bash-history/.bash_history` so interactive bash
  records history onto the mount even in a container that does not apply these
  dotfiles. (The dotfiles bash config sets the same value when `/bash-history`
  exists, so the two never disagree.)
- Installs **no binary**. The endless/timestamped tuning (`HISTSIZE=-1`,
  `HISTFILESIZE=-1`, `HISTTIMEFORMAT`, the explicit `history -a` flush, and the
  `/bash-history/full_history` archive) lives in the dotfiles bash config;
  cross-pane live sharing comes from the `blesh` feature's ble.sh
  (`history_share=1`). This feature only wires the mount.
- Writes a one-time, idempotent login-shell migration snippet at
  `/etc/profile.d/bash-history-migrate.sh` that copies any history left at the
  old `/commandhistory` target into `/bash-history` (without clobbering newer
  data) and drops a `.migrated` marker so it runs only once. The migration runs
  at shell time, not build time, because the bind mount is reliably present in
  an interactive login shell but not necessarily during the feature build.

## Options

None. The feature is mount-only.

## Usage

Enable via user-level lace config (`~/.config/lace/user.json`) so every
container gets it, alongside `blesh`:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/blesh:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/bash-history:1": {}
  }
}
```

### Shared-across-projects history (opt-in override)

The default is per-project isolation. To share one history across every project
instead, point the mount source at a fixed dir in `settings.json` (the source
must already exist on disk):

```jsonc
// settings.json
"mounts": { "bash-history/history": { "source": "~/.config/lace/shared/bash-history" } }
```

## Notes

- `installsAfter` orders only the build step (after `common-utils`, `blesh`, and
  `lace-fundamentals`) for determinism; the mount and migration do not depend on
  build ordering.
- Per-project means per-repo, not per-worktree: every worktree of a repo shares
  one store, so command recall works across worktrees of the same project.
