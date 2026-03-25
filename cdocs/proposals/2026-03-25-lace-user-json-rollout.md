---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T09:30:00-07:00
task_list: lace/user-json-rollout
type: proposal
state: live
status: review_ready
tags: [lace, user_config, dotfiles, chezmoi, verification]
last_reviewed:
  status: revision_requested
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T10:15:00-07:00
  round: 1
---

# Lace user.json Rollout and Cross-Project Verification

> BLUF(opus/user-json-rollout): Populate `~/.config/lace/user.json` with the full set of user-specific tools and preferences (nushell, neovim, git-delta, git identity, default shell), move user-preference features out of the lace project's `devcontainer.json`, and verify the complete developer environment end-to-end.
> The current container is missing nushell and neovim because they were removed from `prebuildFeatures` during the lace-fundamentals migration but not yet added to `user.json`.
> Chezmoi apply runs but the managed configs (nushell, neovim, starship, tmux, wezterm) depend on their binaries being installed first.
> This proposal defines the target `user.json`, the devcontainer.json cleanup, the chezmoi apply order-of-operations, and a verification checklist covering every cross-project behavior.
>
> - **Depends on:** [user-level config implementation](2026-03-24-lace-user-level-config.md), [lace-fundamentals feature](2026-03-24-lace-fundamentals-feature.md)
> - **References:** [dotfiles repo](https://github.com/micimize/dotfiles), `~/.config/lace/settings.json`

## Objective

Establish the complete `user.json` configuration for mjr's developer environment and verify it works correctly across lace-managed containers.
After this work:
1. Every lace container has nushell as the default shell with full config applied via chezmoi.
2. Every lace container has neovim with the full lua config applied via chezmoi.
3. Git identity is `micimize` / `rosenthalm93@gmail.com` by default, overridable per-project.
4. Screenshots, starship prompt, tmux config, and git-delta are available in every container.
5. The lace project's `devcontainer.json` contains only project-specific concerns: no user-preference tools.

## Background

### Current state

The lace-fundamentals migration (completed 2026-03-24) replaced 5 feature declarations with a single `lace-fundamentals:1` reference.
Neovim and nushell were removed from `prebuildFeatures` with the intent of moving them to `user.json`.
The current container is missing both tools:

```
nu: not found
nvim: not found
starship 1.24.2   (installed via chezmoi run_once script)
delta 0.18.2      (installed via Dockerfile)
default shell: /bin/bash
```

The current `user.json` has git identity and defaultShell but no features:

```json
{
  "git": { "name": "mjr", "email": "mjr@weftwiseink.com" },
  "defaultShell": "/usr/bin/nu"
}
```

### Chezmoi managed files

The dotfiles repo at `~/code/personal/dotfiles` manages:
- `.config/nushell/` (config.nu, env.nu, login.nu, scripts/)
- `.config/nvim/` (init.lua, lazy-lock.json, lua/plugins/)
- `.config/starship.toml`
- `.config/tmux/`
- `.config/wezterm/` (not relevant inside containers)

Chezmoi also has `run_once` scripts for starship and carapace installation.

### Order-of-operations constraint

Chezmoi apply writes config files, but the config files are useless without the binaries.
Nushell config references starship and carapace completions.
Neovim config uses lazy.nvim for plugin management: `init.lua` triggers plugin download on first launch.

The correct order:
1. Feature install (nushell, neovim binaries via devcontainer features)
2. `lace-fundamentals-init` runs chezmoi apply (writes config files)
3. Neovim lazy.nvim bootstrap happens on first `nvim` invocation (or via headless `nvim --headless +qa`)

### git-delta in Dockerfile

The Dockerfile currently installs `git-delta` directly (lines 54-57).
This is a user preference, not a project requirement.
It should move to `user.json` features or be installed by chezmoi.

> NOTE(opus/user-json-rollout): git-delta does not have a devcontainer feature on any major registry.
> Options: (a) keep it in the Dockerfile as a pragmatic exception, (b) install it via a chezmoi `run_once` script, or (c) create a lace feature for it.
> Option (b) is simplest: the dotfiles repo already has `run_once` scripts for starship and carapace.

## Proposed Solution

### Target user.json

```jsonc
{
  // User-preference features: installed in every lace container.
  // The lace-specific claude-code feature wraps anthropic's upstream feature
  // and declares the ~/.claude config mount via lace metadata.
  "features": {
    "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
    "ghcr.io/eitsupi/devcontainer-features/nushell:0": {},
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
  },

  // Git identity: written to ~/.gitconfig by lace-fundamentals-init
  "git": {
    "name": "micimize",
    "email": "rosenthalm93@gmail.com"
  },

  // Default shell: set via chsh during feature install
  "defaultShell": "/usr/bin/nu",

  // Universal mounts
  "mounts": {
    "screenshots": {
      "source": "~/Pictures/Screenshots",
      "target": "/mnt/user/screenshots",
      "description": "Host screenshots for Claude Code image references"
    },
    // NOTE: nushell history is NOT here because user mounts are readonly.
    // History persistence is configured in settings.json as a writable mount override.
    // See "settings.json updates" section below.
  },

  // User-level env vars
  "containerEnv": {
    "EDITOR": "nvim",
    "VISUAL": "nvim",
    "SHELL": "/usr/bin/nu"
  }
}
```

> NOTE(opus/user-json-rollout): The claude-code feature (`ghcr.io/weftwiseink/devcontainer-features/claude-code:1`) is the lace-specific wrapper, not the upstream anthropic feature.
> It wraps `ghcr.io/anthropics/devcontainer-features/claude-code:1` (via `dependsOn` on node) and declares a lace mount for `~/.claude` config persistence.
> Moving it to `user.json` means any lace project gets Claude Code without declaring it in `prebuildFeatures`.
> Projects that need to pin a specific claude-code version can still declare it in their `devcontainer.json` (project options override user options).

### Nushell history persistence

Nushell history cannot be a `user.json` mount: user mounts are forced readonly, and history requires write access.
Instead, nushell history is persisted via the existing project-level `bash-history` mount pattern.

The chezmoi-managed nushell config should set the history file path to the mounted `/commandhistory/` directory:
```nu
# In config.nu (chezmoi-managed)
$env.config.history.file_format = "sqlite"
$env.config.history.isolation = false
```

The nushell `$nu.history-path` default writes to `~/.config/nushell/history.sqlite3`.
To persist this across rebuilds, add a settings.json mount override pointing to the project's `bash-history` mount directory, or configure a dedicated history path in the nushell config that writes to `/commandhistory/.nu_history.sqlite3`.

> NOTE(opus/user-json-rollout): The simplest approach: configure nushell's history path in dotfiles config.nu to write to `/commandhistory/.nu_history.sqlite3`, reusing the existing writable `project/bash-history` mount.
> No new mounts needed, just a dotfiles change.

> NOTE(opus/user-json-rollout): The git identity uses `micimize` / `rosenthalm93@gmail.com` rather than the current `mjr` / `mjr@weftwiseink.com`.
> The host `~/.gitconfig` uses `micimize`, so this aligns container identity with host identity.
> Work projects can override via `GIT_CONFIG_*` env vars in their `containerEnv`.

### devcontainer.json cleanup

Remove from the lace project's `prebuildFeatures`:
- `"ghcr.io/anthropics/devcontainer-features/claude-code:1": {}`: now in `user.json` as the lace-specific wrapper feature.

Remove from the lace project's `customizations.lace.mounts`:
- `"claude-config"` and `"claude-config-json"`: the claude-code feature now declares both mounts in its own metadata: `claude-code/config` (directory) and `claude-code/config-json` (file overlay).

> NOTE(opus/user-json-rollout): The `.claude.json` file overlay is necessary because `CLAUDE_CONFIG_DIR` makes Claude look for `.claude.json` inside the config directory.
> The host's `~/.claude/.claude.json` (written by previous container sessions) is a sparse 12-key copy.
> The overlay provides the host's full 55-key `~/.claude.json` (onboarding state, preferences, feature flags).
> Claude Code writes to `.claude.json` on every startup: the mount must NOT be readonly.
> Container writes propagate back to host, but all fields are idempotent caches and counters.

Remove from `containerEnv`:
- `"CLAUDE_CONFIG_DIR"`: this was set to `${lace.mount(project/claude-config).target}` and will need updating to reference the feature mount label instead.

> NOTE(opus/user-json-rollout): git-delta is installed by the Dockerfile, not by any devcontainer feature.
> Neither the anthropic upstream feature nor our wrapper installs it.
> It stays in the Dockerfile for now: it's a 2.9MB .deb with no feature equivalent on any major registry.
> A chezmoi `run_once` migration is possible but adds no value over the Dockerfile approach for this project.

### Chezmoi integration

The lace-fundamentals init script runs `chezmoi apply --source /mnt/lace/repos/dotfiles` at container start.
This writes all managed files from the dotfiles repo into the container's home directory.

For this to work correctly:
1. The dotfiles mount must be configured in `settings.json` (already done: `"lace-fundamentals/dotfiles": { "source": "~/code/personal/dotfiles" }`)
2. The nushell and neovim features must install BEFORE `lace-fundamentals-init` runs (guaranteed: features install at build time, init runs at container start)
3. Chezmoi `run_once` scripts for starship and carapace run during `chezmoi apply` (they check if the binary exists and install if missing)

> NOTE(opus/user-json-rollout): The existing `run_once` scripts (`run_once_before_10-install-starship.sh`, `run_once_before_30-install-carapace.sh`) were written for host use and may not have container guards.
> If they fail inside the container (e.g., missing `sudo`, different package manager), chezmoi apply logs a warning but continues.
> Verify in Phase 2 that these scripts succeed; if not, add `CHEZMOI_CONTAINER=1` guards or mark them with chezmoi's `when` condition.

### Feature install ordering

User features from `user.json` are merged into `prebuildFeatures` (because the project has prebuild features configured).
The devcontainer CLI installs features in declaration order within the prebuild.
The target install order in the generated config:

1. `lace-fundamentals:1` (installs sshd via dependsOn, git via dependsOn, chezmoi, creates init script)
2. `ghcr.io/eitsupi/devcontainer-features/nushell:0` (installs nushell binary)
3. `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` (installs neovim binary)
4. `ghcr.io/anthropics/devcontainer-features/claude-code:1` (installs claude CLI)
5. `ghcr.io/devcontainers/features/rust:1` (installs rust toolchain)

After all features install, the container starts and `lace-fundamentals-init` runs via `postCreateCommand`.
At this point nushell and neovim binaries are available, so chezmoi apply's config files are functional.
The `chsh -s /usr/bin/nu` in lace-fundamentals' shell.sh step sets nushell as the default login shell (runs at build time, nushell binary must exist).

> NOTE(opus/user-json-rollout): Feature install order is not guaranteed by the devcontainer spec.
> The devcontainer CLI may reorder features based on `dependsOn` resolution.
> If nushell installs AFTER lace-fundamentals, the `chsh` call fails (with a warning, non-fatal).
> Two mitigations are applied proactively:
> (a) `installsAfter` on lace-fundamentals ensures nushell is installed first (Phase 1 action item).
> (b) `SHELL=/usr/bin/nu` in user.json containerEnv provides a runtime fallback for tools that read `$SHELL`.

## Verification Checklist

Every item must be verified inside a freshly rebuilt container after applying the changes.

### Shell environment
- [ ] `echo $SHELL` returns `/usr/bin/nu`
- [ ] `getent passwd node | cut -d: -f7` returns `/usr/bin/nu`
- [ ] `nu -c "version"` runs without error
- [ ] Container build logs show no `chsh` failure warning for nushell binary
- [ ] Nushell starts as the login shell on SSH connect
- [ ] Nushell config loaded: `$env.config` table is populated (config.nu sourced)
- [ ] Starship prompt renders in nushell (visible prompt customization)
- [ ] Carapace completions available in nushell

### Editor
- [ ] `nvim --version` returns a version
- [ ] Neovim config loaded: `:echo g:loaded_lazy` returns `1` (lazy.nvim bootstrapped)
- [ ] Neovim plugins pre-installed: `nvim --headless "+Lazy! check" +qa` shows no missing plugins
- [ ] `$EDITOR` is `nvim`
- [ ] `$VISUAL` is `nvim`

### Git identity
- [ ] `git config --global user.name` returns `micimize`
- [ ] `git config --global user.email` returns `rosenthalm93@gmail.com`
- [ ] `echo $LACE_GIT_NAME` returns `micimize`
- [ ] `echo $GIT_AUTHOR_NAME` is empty (not set)
- [ ] `git commit --allow-empty -m "test"` in a test repo shows correct author

### Dotfiles (chezmoi)
- [ ] `chezmoi managed --source /mnt/lace/repos/dotfiles` lists nushell, nvim, starship configs
- [ ] `~/.config/nushell/config.nu` exists and matches dotfiles repo
- [ ] `~/.config/nvim/init.lua` exists and matches dotfiles repo
- [ ] `~/.config/starship.toml` exists
- [ ] `~/.config/tmux/tmux.conf` exists (if managed)
- [ ] `chezmoi apply --source /mnt/lace/repos/dotfiles --dry-run --no-tty` exits 0 (no pending changes)
- [ ] Init script output shows no chezmoi apply errors

### SSH and connectivity
- [ ] SSH key auth works: `ssh -p <port> -i ~/.config/lace/ssh/id_ed25519 node@localhost`
- [ ] Password auth rejected
- [ ] `sshd_config` has all 7 hardening directives

### Claude Code
- [ ] `claude --version` works
- [ ] `~/.claude` directory exists and is mounted from host
- [ ] `CLAUDE_CONFIG_DIR` points to the mounted claude config directory
- [ ] Claude does not re-prompt for sign-in (host state preserved)

### Mounts
- [ ] `/mnt/lace/screenshots` contains host screenshots (readonly)
- [ ] `/mnt/lace/repos/dotfiles` contains dotfiles repo
- [ ] `/home/node/.ssh/authorized_keys` exists
- [ ] Nushell history persists: `history | length` returns >0 after a container restart (history written to `/commandhistory/`)

### Tools
- [ ] `git-delta`: `delta --version` works (from Dockerfile)
- [ ] `curl`, `jq`, `less` available (staples)
- [ ] `chezmoi --version` works

### Cross-project behavior
- [ ] Rebuild the dotfiles devcontainer (`~/code/personal/dotfiles`) with the same `user.json`: verify nushell, neovim, git identity all present
- [ ] If no `user.json` exists (rename it temporarily): container builds without errors, no user tools

## Implementation Phases

### Phase 1: Configuration updates

1. Update `~/.config/lace/user.json` with the target config (features, git identity, env vars, mounts).
2. Add `"installsAfter"` to `devcontainers/features/src/lace-fundamentals/devcontainer-feature.json`:
   ```json
   "installsAfter": {
     "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
   }
   ```
   This ensures nushell is installed before lace-fundamentals runs `chsh`.
3. Update `.devcontainer/devcontainer.json`:
   - Remove `"ghcr.io/anthropics/devcontainer-features/claude-code:1": {}` from `prebuildFeatures` (now in user.json as the lace wrapper).
   - Remove `"claude-config"` and `"claude-config-json"` from `customizations.lace.mounts` (handled by the claude-code feature's own mount declaration).
   - Update `containerEnv.CLAUDE_CONFIG_DIR` to reference the feature mount: `"${lace.mount(claude-code/config).target}"`.
4. Update `~/.config/lace/settings.json`:
   - Add `"claude-code/config": { "source": "~/.claude" }` (replaces `"project/claude-config"`)
   - Add `"claude-code/config-json": { "source": "~/.claude.json" }` (replaces `"project/claude-config-json"`)
   - Remove the old `"project/claude-config"` override
5. Add nvim plugin pre-installation to `postCreateCommand` (composed with init script):
   `lace-fundamentals-init && nvim --headless "+Lazy! sync" +qa`
6. Commit and push the code changes (triggers GHCR re-publish for `installsAfter`).

**Success criteria:**
- `cat ~/.config/lace/user.json` matches the target config.
- `devcontainer-feature.json` declares `installsAfter` for nushell.
- `devcontainer.json` no longer references claude-code in prebuildFeatures or declares claude mounts.
- `settings.json` has sources for all new mount labels.

### Phase 2: Rebuild and verify

1. Remove the old container: `docker rm -f lace`
2. Rebuild with `--rebuild --force` to pick up new prebuild features
3. Walk through the verification checklist
4. Document results

**Success criteria:** All checklist items pass.

### Phase 3: Fix issues and iterate

Address any failures from Phase 2.
Known likely issues to check for:

1. **Chezmoi `run_once` scripts**: If starship/carapace install scripts fail in the container context (different package manager, no `sudo`), add container guards using chezmoi's `when` template condition or a `DEVCONTAINER=true` env var check.
2. **Neovim plugin pre-install**: If `nvim --headless "+Lazy! sync" +qa` fails or hangs, investigate: network access, treesitter compilation (may need `gcc`/`make`), plugin-specific build steps. Consider whether the nvim plugin mount from the neovim feature (`~/.local/share/nvim`) should be configured in settings.json to persist plugins across rebuilds.
3. **Nushell config host-specific paths**: If nushell config references host-specific paths (e.g., `~/.cargo/bin`), add chezmoi templating with `.chezmoi.hostname` or `env "DEVCONTAINER"` conditionals.
4. **Claude config mount migration**: Verify that the `.claude.json` file overlay (previously `project/claude-config-json`) is handled correctly by the feature's directory mount. If not, the implementor may need to add a secondary file mount declaration to the claude-code feature metadata.
5. **Nushell history persistence**: Update the chezmoi-managed `config.nu` to write history to `/commandhistory/.nu_history.sqlite3`. Verify history persists across `docker rm` + `lace up`.

The implementor should iterate on these until the full verification checklist passes, documenting each fix in the devlog.

## Resolved Questions

1. **Should `user.json` be chezmoi-managed?** Out of scope for this proposal.
   A static file is sufficient for now.
   Chezmoi templating for platform-aware config (macOS vs Linux) can be added in a follow-up.

2. **Should neovim plugins be pre-installed?** Yes.
   Add `nvim --headless "+Lazy! sync" +qa` to the `postCreateCommand` chain.
   This runs after `lace-fundamentals-init` applies the nvim config via chezmoi.
   Adds a few seconds to container creation but eliminates the first-launch plugin download.

3. **Should the dotfiles repoMount be in `user.json` instead of `settings.json`?**
   No, leave it in `settings.json` as a `readonly: false` override.
   Chezmoi's idempotent apply behavior protects against accidental modifications.
   Moving to `user.json` would require the writable mount feature (deferred).

## Open Questions

1. **Should the neovim feature's plugin mount (`~/.local/share/nvim`) be configured in `settings.json`?**
   This would persist lazy.nvim plugin downloads across container rebuilds, avoiding re-download.
   The trade-off: host plugin versions may drift from container expectations.
   Recommend: try without persistence first; add if plugin install time becomes a pain point.
