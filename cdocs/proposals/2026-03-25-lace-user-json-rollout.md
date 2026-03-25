---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T09:30:00-07:00
task_list: lace/user-json-rollout
type: proposal
state: live
status: review_ready
tags: [lace, user_config, dotfiles, chezmoi, verification]
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
  // User-preference features: installed in every lace container
  "features": {
    "ghcr.io/devcontainers-extra/features/neovim-homebrew:1": {},
    "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
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
    }
  },

  // User-level env vars
  "containerEnv": {
    "EDITOR": "nvim",
    "VISUAL": "nvim"
  }
}
```

> NOTE(opus/user-json-rollout): The git identity uses `micimize` / `rosenthalm93@gmail.com` rather than the current `mjr` / `mjr@weftwiseink.com`.
> The host `~/.gitconfig` uses `micimize`, so this aligns container identity with host identity.
> Work projects can override via `GIT_CONFIG_*` env vars in their `containerEnv`.

### devcontainer.json cleanup

Remove from the lace project's `devcontainer.json`:
- Nothing to remove from `prebuildFeatures`: neovim and nushell are already gone.

Remove from the Dockerfile:
- `git-delta` installation (lines 54-57): move to a chezmoi `run_once` script in the dotfiles repo.

> NOTE(opus/user-json-rollout): The Dockerfile `git-delta` removal is optional for this proposal.
> It works fine where it is.
> The chezmoi migration is cleaner but adds a `run_once` script dependency.
> Recommend deferring the Dockerfile cleanup to avoid scope creep.

### Chezmoi integration

The lace-fundamentals init script runs `chezmoi apply --source /mnt/lace/repos/dotfiles` at container start.
This writes all managed files from the dotfiles repo into the container's home directory.

For this to work correctly:
1. The dotfiles mount must be configured in `settings.json` (already done: `"lace-fundamentals/dotfiles": { "source": "~/code/personal/dotfiles" }`)
2. The nushell and neovim features must install BEFORE `lace-fundamentals-init` runs (guaranteed: features install at build time, init runs at container start)
3. Chezmoi `run_once` scripts for starship and carapace run during `chezmoi apply` (they check if the binary exists and install if missing)

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

> WARN(opus/user-json-rollout): Feature install order is not guaranteed by the devcontainer spec.
> User features are merged into prebuildFeatures by lace, but the devcontainer CLI may reorder them based on `dependsOn` resolution.
> If nushell installs AFTER lace-fundamentals, the `chsh` call fails (with a warning, non-fatal).
> The fallback is `SHELL=/usr/bin/nu` in containerEnv, which covers most interactive use but not all tools.
> Mitigation: add `"installsAfter": ["ghcr.io/eitsupi/devcontainer-features/nushell:0"]` to lace-fundamentals' `devcontainer-feature.json`.

## Verification Checklist

Every item must be verified inside a freshly rebuilt container after applying the changes.

### Shell environment
- [ ] `echo $SHELL` returns `/usr/bin/nu`
- [ ] `getent passwd node | cut -d: -f7` returns `/usr/bin/nu`
- [ ] Nushell starts as the login shell on SSH connect
- [ ] Nushell config loaded: `$env.config.show_banner` is `false` (or whatever the dotfiles set)
- [ ] Starship prompt renders in nushell (visible prompt customization)
- [ ] Carapace completions available in nushell

### Editor
- [ ] `nvim --version` returns a version
- [ ] Neovim config loaded: `:echo g:loaded_lazy` returns `1` (lazy.nvim bootstrapped)
- [ ] Neovim plugins install on first launch (`:Lazy` shows installed plugins)
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

### SSH and connectivity
- [ ] SSH key auth works: `ssh -p <port> -i ~/.config/lace/ssh/id_ed25519 node@localhost`
- [ ] Password auth rejected
- [ ] `sshd_config` has all 7 hardening directives

### Mounts
- [ ] `/mnt/lace/screenshots` contains host screenshots (readonly)
- [ ] `/mnt/lace/repos/dotfiles` contains dotfiles repo
- [ ] `/home/node/.ssh/authorized_keys` exists

### Tools
- [ ] `git-delta`: `delta --version` works (from Dockerfile or chezmoi)
- [ ] `curl`, `jq`, `less` available (staples)
- [ ] `chezmoi --version` works
- [ ] `claude --version` works (claude-code feature)

### Cross-project behavior
- [ ] Rebuild a DIFFERENT lace-managed project with the same `user.json`: verify nushell, neovim, git identity all present
- [ ] If no `user.json` exists (rename it temporarily): container builds without errors, no user tools

## Implementation Phases

### Phase 1: Update user.json

Update `~/.config/lace/user.json` with the target config (features, git identity, env vars, mounts).

**Success criteria:** `cat ~/.config/lace/user.json` matches the target config.

### Phase 2: Rebuild and verify

1. Remove the old container: `docker rm -f lace`
2. Rebuild with `--rebuild --force` to pick up new prebuild features
3. Walk through the verification checklist
4. Document results

**Success criteria:** All checklist items pass.

### Phase 3: Fix issues

Address any failures from Phase 2.
Common issues:
- Feature install order (nushell not available for chsh): add `installsAfter` to lace-fundamentals
- Chezmoi `run_once` scripts failing in container context: may need `CHEZMOI_CONTAINER=1` guard
- Neovim lazy.nvim needs network access for plugin install: verify container has outbound network
- Nushell config referencing host-specific paths: may need chezmoi templating with `.chezmoi.hostname`

### Phase 4: git-delta migration (optional, deferred)

Move git-delta from Dockerfile to a chezmoi `run_once_after` script.
This is low priority: the current Dockerfile installation works.

## Open Questions

1. **Should `user.json` be chezmoi-managed?** The user-config proposal includes a chezmoi template example.
   Managing `user.json` via chezmoi allows platform-aware config (macOS vs Linux screenshot paths).
   For now, a static file is simpler.
   Chezmoi templating can be added later.

2. **Should neovim plugins be pre-installed in the prebuild image?**
   Currently lazy.nvim downloads plugins on first `nvim` launch.
   A `postCreateCommand` step like `nvim --headless "+Lazy! sync" +qa` could pre-install them.
   This adds build time but improves first-launch experience.

3. **Should the dotfiles repoMount be in `user.json` instead of `settings.json`?**
   The dotfiles source is in `settings.json` as a mount override.
   It could also be a `user.json` mount (which would make it truly cross-project).
   However, `user.json` mounts are read-only, and the dotfiles override is `readonly: false`.
   This requires the writable mount feature (deferred in the user-config proposal).
