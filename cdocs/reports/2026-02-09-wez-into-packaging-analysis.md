---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T12:00:00-08:00
type: report
state: archived
status: done
tags: [analysis, wez-into, packaging, nushell, chezmoi, distribution, cli, dotfiles]
related_to:
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
  - cdocs/reports/2026-02-08-wez-into-cli-command-status.md
  - cdocs/reports/2026-02-04-chezmoi-migration-research.md
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T12:30:00-08:00
  round: 1
---

# Packaging Analysis: `wez-into` as a Standalone Distributable Tool

> **BLUF:** The best packaging model for `wez-into` is a standalone git repo (`weft/wez-into`) containing both the bash script and a nushell directory module, consumed by dotfiles via `chezmoi externals` (git-repo type). The nushell module lands in a vendor autoload directory so it loads automatically without touching `config.nu`. The bash script deploys to `~/.local/bin/` via a chezmoi `run_once` script that symlinks from the cloned repo. `lace-discover` should stay in the lace repo but get its own chezmoi symlink. This approach avoids code duplication, makes `wez-into` reusable across machines, and uses nushell's native module system for zero-config completions. The main alternative -- embedding everything in the dotfiles repo -- is simpler but creates a maintenance burden when the tool's logic needs updating.

## Context / Background

The [wez-into proposal](../proposals/2026-02-08-wez-into-devcontainer-cli.md) describes a CLI tool for connecting WezTerm to devcontainers. It currently proposes deploying via chezmoi in the dotfiles repo: bash script at `dot_local/bin/executable_wez-into`, nushell module at `dot_config/nushell/scripts/wez-into.nu`. This works but raises questions about reusability and separation of concerns. The user wants to explore whether `wez-into` should be its own distributable package, similar to how `lace.wezterm` is its own git repo loaded via WezTerm's plugin system.

This report researches the packaging ecosystem for nushell and bash tools, evaluates concrete distribution options, and recommends a practical approach.

## Research Findings

### 1. Nushell Packaging Ecosystem

#### nupm (Nushell Package Manager)

[nupm](https://github.com/nushell/nupm) exists at version 0.2.1. It supports installing modules and scripts from local paths (`nupm install foo --path`) or git repos (`nupm install https://github.com/.../foo.git --git`). A package needs a `nupm.nuon` metadata file:

```
{
  name: "wez-into"
  description: "Connect WezTerm to lace devcontainers"
  type: "module"
  license: "MIT"
}
```

However, nupm is explicitly **not production-ready**. The README states: "This project is in an experimentation stage and not intended for serious use!" It requires nightly nushell in some cases. Building on nupm today would be building on sand.

**Verdict:** Not viable as the primary distribution mechanism. Could be added later as a secondary install method when nupm matures.

#### Vendor Autoload Directories

Nushell 0.90+ automatically loads all `*.nu` files found in `$nu.vendor-autoload-dirs`. The default vendor autoload path is `$nu.data-dir/vendor/autoload/` (typically `~/.local/share/nushell/vendor/autoload/`). Files are sourced alphabetically after `config.nu` loads.

This is the mechanism [starship](https://starship.rs/) uses: the dotfiles `env.nu` already runs `starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")`. The same pattern works for `wez-into`: place a `.nu` file in the vendor autoload directory and it loads automatically.

Key properties:
- No `source` or `use` line needed in `config.nu`
- Files are sourced (not `use`d), so `export` is not required for top-level commands
- Sourced alphabetically within the directory
- The user's `env.nu` already creates this directory (`mkdir ($nu.data-dir | path join "vendor/autoload")`)

**Verdict:** Best mechanism for automatic nushell module loading. Drop a `.nu` file here and it works.

#### NU_LIB_DIRS Module Search Paths

Nushell searches `$NU_LIB_DIRS` when resolving `use` imports. The dotfiles `env.nu` does not currently set custom `$NU_LIB_DIRS` entries, but it could add one pointing to a `wez-into` repo checkout. This would allow `use wez-into *` to load the module from an arbitrary path.

However, this requires a `use` line in `config.nu`, which the vendor autoload approach avoids.

**Verdict:** Viable but unnecessary given vendor autoload.

#### Overlays

Nushell overlays (`overlay use`) are activation-scoped layers of commands/environment. They can be loaded and unloaded on demand. However, they require a compile-time constant path (no variables), and the path must exist at parse time. Overlays are designed for switchable contexts (like Python virtualenvs), not for always-on CLI tools.

**Verdict:** Wrong tool for this job. `wez-into` should always be available, not require activation.

#### Directory Modules

A nushell directory module is a directory containing `mod.nu` as the entry point. Subcommands can be split into separate files. This is the cleanest structure for a multi-command tool like `wez-into`:

```
wez-into/
  mod.nu          # exports: wez-into, wez-into list, wez-into status
  discover.nu     # helper: wez-into discover
```

The `mod.nu` file `export use`s the submodules. When this directory is placed where nushell can find it (via `NU_LIB_DIRS` or vendor autoload), `use wez-into *` makes all exported commands available.

For vendor autoload, a single flat `.nu` file is more practical than a directory module, since autoload just `source`s files. A directory module would need a wrapper file in the autoload dir: `source /path/to/wez-into/mod.nu`.

**Verdict:** Directory modules are overkill for the current scope. A single `.nu` file is sufficient. Revisit if the command grows complex enough to warrant splitting.

### 2. Standalone Repo Distribution Patterns

#### Chezmoi Externals (git-repo type)

Chezmoi's `.chezmoiexternal.toml` can clone a git repo to a managed path during `chezmoi apply`:

```toml
[".local/share/wez-into"]
    type = "git-repo"
    url = "https://github.com/weft/wez-into.git"
    refreshPeriod = "168h"
```

This clones the repo to `~/.local/share/wez-into/` and pulls weekly. The repo contents are managed by git, not chezmoi (they will not show in `chezmoi diff`).

Limitations:
- Cannot manage individual files from the cloned repo (the whole directory is delegated to git)
- Does not set file permissions or create symlinks -- a `run_once` script is needed for that
- `clone.args` and `pull.args` can customize the git commands

**Verdict:** Good mechanism for getting the repo onto the machine. Needs companion `run_once` scripts for symlinking into `~/.local/bin/` and vendor autoload.

#### Chezmoi Externals (archive type with GitHub tarball)

An alternative to git-repo: download a GitHub tarball:

```toml
[".local/share/wez-into"]
    type = "archive"
    url = "https://github.com/weft/wez-into/archive/main.tar.gz"
    stripComponents = 1
    refreshPeriod = "168h"
```

This avoids cloning a full git repo. But it also means no `git pull` updates -- chezmoi re-downloads the full archive on refresh. For a small repo like `wez-into`, the difference is negligible.

**Verdict:** Viable alternative to git-repo. Slightly simpler (no git history on disk) but less convenient for development (can't cd into it and make changes).

#### Git Submodule in Dotfiles Repo

The dotfiles repo already has a `.gitmodules` file. A git submodule could pin `wez-into` to a specific commit:

```
[submodule "wez-into"]
    path = vendor/wez-into
    url = https://github.com/weft/wez-into.git
```

Chezmoi does not natively understand git submodules, but since the dotfiles repo IS the chezmoi source, files from the submodule can be managed as regular chezmoi source files using `.chezmoiignore` to exclude the vendor directory and `run_once` scripts to do the linking.

**Verdict:** Adds complexity to the dotfiles repo. Chezmoi externals are the idiomatic approach within chezmoi-managed repos. Submodules are better if the dotfiles repo were NOT using chezmoi.

#### Standalone Symlinks (No Package Manager)

The simplest approach: clone `wez-into` manually, symlink manually:

```bash
git clone https://github.com/weft/wez-into.git ~/.local/share/wez-into
ln -s ~/.local/share/wez-into/wez-into ~/.local/bin/wez-into
ln -s ~/.local/share/wez-into/wez-into.nu ~/.local/share/nushell/vendor/autoload/wez-into.nu
```

This works but is not reproducible across machines without scripting -- which is what chezmoi is for.

**Verdict:** Fine for development/testing. Not suitable as the distribution mechanism for a chezmoi-managed setup.

### 3. Hybrid Bash + Nushell Distribution

#### Pattern A: Nushell Module Wraps Bash Script

The nushell module calls the bash script as an external command (`^wez-into`). The bash script is the single source of truth for all logic. The nushell module adds structured output and completions on top.

Pros: One implementation to maintain. Nushell gets completions and structured output.
Cons: Nushell loses native structured data (everything goes through text parsing). The nushell `input list` picker would not work (the bash script handles its own picker).

**Verdict:** Defeats the purpose of having a nushell implementation.

#### Pattern B: Independent Implementations

Bash and nushell versions are fully independent, both calling `lace-discover` for discovery. The bash version is the portable fallback; the nushell version is the primary experience with structured data and `input list`.

This is what the existing proposal describes. It means maintaining two implementations, but the logic is thin (call discover, parse output, call wezterm connect). The nushell version uses `from json` on `lace-discover --json` for structured data; the bash version uses colon-delimited text.

**Verdict:** The right approach. The command is thin enough that dual implementations are not burdensome.

#### Pattern C: Shared Core Script + Shell-Specific Wrappers

A single bash script handles all logic. Shell-specific wrappers add completions only:
- `wez-into` (bash): the full implementation
- `wez-into.nu`: only `extern` definitions for tab completion, delegates to `^wez-into` for execution

This is how many CLI tools distribute bash completions -- the completion is separate from the command. Nushell's `extern` declaration can describe the command's flags and arguments for tab completion without reimplementing the command.

```nu
# Completion-only nushell extern
export extern "wez-into" [
  project?: string@wez-into-projects  # Project name
  --start (-s)      # Start container if not running
  --list (-l)       # List running project names
  --status          # Show running projects with status
  --help (-h)       # Show help
]

def wez-into-projects [] {
  ^wez-into --list | lines
}
```

Pros: One implementation. Nushell still gets tab completions.
Cons: No structured output in nushell (everything is text). No `input list` picker. The nushell experience is "bash with completions" rather than native.

**Verdict:** A pragmatic middle ground if maintaining two implementations feels too heavy. Loses the native nushell experience but gains simplicity.

### 4. Tab Completion Distribution

#### Bash Completions

Standard location: `~/.local/share/bash-completion/completions/wez-into`. The `bash-completion` package automatically loads completion files from this XDG-compliant path by command name. No additional configuration needed.

A `wez-into` repo could include `completions/wez-into.bash` and a `run_once` script could symlink it into the completions directory.

#### Nushell Completions

Nushell completions are defined inline with the command (`def` with `@completer` syntax) or via `extern` declarations. There is no separate "completions directory" in nushell -- completions are part of the module/command definition.

For vendor autoload distribution, the completions are embedded in the same `.nu` file as the command definitions. This is actually simpler than bash: one file provides both the commands and their completions.

For `extern`-only completions (Pattern C above), the `.nu` file in vendor autoload would contain just the `extern` declaration and the completer function.

### 5. Existing Ecosystem Patterns

#### lace.wezterm Plugin Pattern

`lace.wezterm` is a separate git repo at `/home/mjr/code/weft/lace.wezterm/`. It is loaded by WezTerm via `wezterm.plugin.require('https://github.com/weft/lace.wezterm')`. WezTerm clones the repo into its own plugin cache and updates it periodically.

This works because WezTerm has a built-in plugin system with `require()`. Nushell does not have an equivalent (nupm is not ready). The closest nushell analog is vendor autoload + chezmoi externals.

#### nu_scripts Community Pattern

The [nushell/nu_scripts](https://github.com/nushell/nu_scripts) repo is a collection of community scripts and completions. Users clone it and add the path to `$NU_LIB_DIRS`, then `use` individual modules. This is the ad-hoc "git clone and wire it up" approach.

`wez-into` is too small and specific for nu_scripts, but the pattern (git repo + `NU_LIB_DIRS` or vendor autoload) is reusable.

## Options Analysis

### Option 1: Embed in Dotfiles (Current Proposal)

Files in the dotfiles repo:
- `dot_local/bin/executable_wez-into` (bash)
- `dot_config/nushell/scripts/wez-into.nu` (nushell module, sourced from `config.nu`)

**Pros:**
- Simplest. No new repos, no externals, no symlinks.
- Everything deploys with `chezmoi apply`.
- Easy to edit alongside other dotfiles.

**Cons:**
- Not reusable. If `wez-into` is useful on another machine or to another user, they must copy the files.
- Nushell module requires a `source` line in `config.nu` (parse-time dependency).
- `lace-discover` dependency requires a separate symlink or copy.
- Updates to `wez-into` logic require editing the dotfiles repo.

**Best for:** Solo user who will never share the tool.

### Option 2: Standalone Git Repo + Chezmoi Externals (Recommended)

New repo `weft/wez-into` with structure:
```
wez-into/
  wez-into            # bash script (executable)
  wez-into.nu         # nushell commands + completions (single file)
  nupm.nuon           # optional: nupm metadata for future
  README.md
  LICENSE
```

Dotfiles repo changes:
```toml
# .chezmoiexternal.toml
[".local/share/wez-into"]
    type = "git-repo"
    url = "https://github.com/weft/wez-into.git"
    refreshPeriod = "168h"
```

```bash
# run_once_after_50-link-wez-into.sh
#!/bin/bash
# Symlink wez-into into PATH and nushell vendor autoload
set -euo pipefail

WEZ_INTO_DIR="$HOME/.local/share/wez-into"

if [ -d "$WEZ_INTO_DIR" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$WEZ_INTO_DIR/wez-into" "$HOME/.local/bin/wez-into"

  AUTOLOAD_DIR="$HOME/.local/share/nushell/vendor/autoload"
  mkdir -p "$AUTOLOAD_DIR"
  ln -sf "$WEZ_INTO_DIR/wez-into.nu" "$AUTOLOAD_DIR/wez-into.nu"
fi
```

**Pros:**
- Reusable across machines and users.
- Updates flow through `git pull` (chezmoi handles this on refresh).
- Nushell module loads via vendor autoload -- no `config.nu` changes needed.
- Clean separation: `wez-into` repo owns the tool, dotfiles repo owns the deployment wiring.
- Can add nupm support later without changing the chezmoi integration.
- Follows the lace.wezterm pattern (tool = its own repo).

**Cons:**
- One more git repo to maintain.
- `chezmoi apply` on a fresh machine requires network access to clone.
- Symlinks can break if the external is removed or moves.
- `chezmoi diff` does not show changes inside git-repo externals.

**Best for:** Tool that may evolve, be shared, or be installed on multiple machines.

### Option 3: Standalone Repo + Vendor Autoload (No Chezmoi External)

Same repo as Option 2, but cloned manually or via a `run_once` script instead of chezmoi externals:

```bash
# run_once_before_50-clone-wez-into.sh
#!/bin/bash
WEZ_INTO_DIR="$HOME/.local/share/wez-into"
if [ ! -d "$WEZ_INTO_DIR" ]; then
  git clone https://github.com/weft/wez-into.git "$WEZ_INTO_DIR"
fi
```

**Pros:**
- Does not require understanding chezmoi externals.
- Works with any dotfile manager (not chezmoi-specific).

**Cons:**
- No automatic updates (must manually `git pull` or add a `run_onchange` script).
- `run_once` scripts are hash-based: changing the script reruns it, but the repo may already exist.
- Reinvents what chezmoi externals already provide.

**Best for:** Avoiding chezmoi externals for simplicity, at the cost of manual updates.

### Option 4: Nushell-Only with Extern Completions for Bash

Single repo containing:
- `wez-into` (bash script -- full implementation)
- `wez-into-completions.nu` (nushell `extern` declaration + completion function)

The nushell file only provides tab completions; actual execution falls through to the bash script on PATH.

**Pros:**
- One implementation to maintain (bash).
- Nushell users still get tab completions.
- Simplest code to maintain.

**Cons:**
- No native nushell experience (no structured output, no `input list` picker).
- Nushell users get text output instead of tables.

**Best for:** Prioritizing maintenance simplicity over nushell-native experience.

## Recommendation

**Option 2 (Standalone Git Repo + Chezmoi Externals)** is the recommended approach, with one refinement: use vendor autoload for the nushell module.

### Recommended Repo Structure

```
weft/wez-into/
  wez-into              # bash script, chmod +x
  wez-into.nu           # nushell commands (sourced via vendor autoload)
  completions/
    wez-into.bash       # bash completion script (optional, for future)
  nupm.nuon             # nupm metadata (optional, for future)
  README.md
  LICENSE
```

### Recommended Dotfiles Integration

```toml
# dotfiles/.chezmoiexternal.toml

[".local/share/wez-into"]
    type = "git-repo"
    url = "https://github.com/weft/wez-into.git"
    refreshPeriod = "168h"
```

```bash
# dotfiles/run_once_after_50-link-wez-into.sh
#!/bin/bash
set -euo pipefail

WEZ_INTO="$HOME/.local/share/wez-into"

# Bash script -> PATH
if [ -f "$WEZ_INTO/wez-into" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$WEZ_INTO/wez-into" "$HOME/.local/bin/wez-into"
fi

# Nushell module -> vendor autoload
if [ -f "$WEZ_INTO/wez-into.nu" ]; then
  AUTOLOAD="$HOME/.local/share/nushell/vendor/autoload"
  mkdir -p "$AUTOLOAD"
  ln -sf "$WEZ_INTO/wez-into.nu" "$AUTOLOAD/wez-into.nu"
fi
```

```bash
# dotfiles/run_once_after_51-link-lace-discover.sh
#!/bin/bash
set -euo pipefail

# lace-discover stays in the lace repo; symlink to PATH
LACE_DISCOVER=""
for candidate in \
  "$HOME/code/weft/lace/bin/lace-discover" \
  "/var/home/$(whoami)/code/weft/lace/bin/lace-discover"; do
  if [ -x "$candidate" ]; then
    LACE_DISCOVER="$candidate"
    break
  fi
done

if [ -n "$LACE_DISCOVER" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$LACE_DISCOVER" "$HOME/.local/bin/lace-discover"
fi
```

### Why Vendor Autoload Over `source` in config.nu

The dotfiles `config.nu` currently sources six script files with explicit `source` lines. Adding `wez-into.nu` would require a seventh line, and nushell's parse-time `source` means the file must exist before nushell starts. If the chezmoi external has not cloned yet (fresh machine, first shell launch), nushell would fail to start.

Vendor autoload avoids this entirely. Files in `$nu.data-dir/vendor/autoload/` are loaded if present and silently skipped if absent. The symlink only exists after the `run_once` script runs, and nushell gracefully handles its absence before that.

### Why Keep `lace-discover` in the Lace Repo

`lace-discover` is tightly coupled to lace's port-range convention and Docker label scheme. If lace changes its port range or discovery protocol, `lace-discover` must update in lockstep. Keeping it in the lace repo ensures co-evolution. The dotfiles symlink provides PATH access without code duplication.

### Implementation Sequence

1. **Create `weft/wez-into` repo** with the bash script and nushell module from the existing proposal.
2. **Add `.chezmoiexternal.toml` entry** in the dotfiles repo.
3. **Add `run_once` scripts** for symlinking.
4. **Remove `wez-into` from dotfiles source** (if it was already added per the original proposal).
5. **Test** on a fresh `chezmoi apply`.

### Future Nupm Compatibility

Adding a `nupm.nuon` file to the repo costs nothing and enables `nupm install https://github.com/weft/wez-into.git --git` when nupm matures. The nushell module file structure already matches nupm's expectations. This is a free option on future packaging.

## Open Questions

1. **Should the nushell module be full-featured or extern-only?** The recommendation assumes a full independent nushell implementation (Pattern B). If maintenance burden becomes a concern, Pattern C (extern-only completions wrapping the bash script) is a viable fallback. The decision can be deferred until after initial deployment.

2. **GitHub organization.** The report assumes `weft/wez-into`. If the tool should not live under the weft org (since it is user-facing, not a library), `mjr/wez-into` or a personal namespace may be more appropriate.

3. **lace-discover also as a standalone repo?** Currently recommended to stay in lace. If other tools beyond `wez-into` start depending on `lace-discover`, it may warrant extraction into its own repo. Not needed now.

## Sources

- [nupm README](https://github.com/nushell/nupm/blob/main/README.md) -- Nushell package manager (experimental)
- [nupm design docs](https://github.com/nushell/nupm/blob/main/docs/design/README.md) -- Package format specification
- [Nushell configuration: vendor autoload](https://www.nushell.sh/book/configuration.html) -- Autoload directories
- [Nushell vendor autoload PR #14669](https://github.com/nushell/nushell/pull/14669) -- User autoload directory addition
- [Nushell vendor autoload PR #14879](https://github.com/nushell/nushell/pull/14879) -- Data-dir-based autoload on all platforms
- [Nushell module cookbook](https://www.nushell.sh/cookbook/modules.html) -- Directory modules and `mod.nu`
- [Nushell using modules](https://www.nushell.sh/book/modules/using_modules.html) -- `NU_LIB_DIRS` and `use`
- [Nushell overlays](https://www.nushell.sh/book/overlays.html) -- Overlay use and limitations
- [Nushell custom completions](https://www.nushell.sh/book/custom_completions.html) -- `extern` and `@completer` syntax
- [nu_scripts community repo](https://github.com/nushell/nu_scripts) -- Community scripts and completions
- [Chezmoi: include files from elsewhere](https://www.chezmoi.io/user-guide/include-files-from-elsewhere/) -- `.chezmoiexternal.toml`
- [Chezmoi external format reference](https://www.chezmoi.io/reference/special-files/chezmoiexternal-format/) -- git-repo, archive types
- [bash-completion user directory](https://github.com/scop/bash-completion/blob/main/README.md) -- XDG-compliant completion loading
