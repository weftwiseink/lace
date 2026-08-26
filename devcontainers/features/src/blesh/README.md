# ble.sh (Bash Line Editor)

Installs [ble.sh](https://github.com/akinomyoga/ble.sh) for the remote user so
interactive bash sessions gain its line editor (syntax highlighting, autosuggestions,
vi keybindings, etc.).

## What it does

- Installs ble.sh to `~/.local/share/blesh/ble.sh` for the remote user (`$HOME/.local/share/blesh`).
  This is the exact path the dotfiles bash config expects
  (`BLESH_DIR="$HOME/.local/share/blesh"`, sourced as `$BLESH_DIR/ble.sh`), so no
  dotfiles change is needed and interactive bash loads ble.sh automatically.
- Prefers a **pinned, prebuilt release tarball** (`ble-<version>.tar.xz`) for
  reproducible, fast installs that cache cleanly in an image layer when used as a
  prebuild feature.
- Falls back to a **build-from-source** clone (requires `git`, `make`, `gawk`) only
  if the release tarball is unavailable.
- Is a no-op if `~/.local/share/blesh/ble.sh` already exists, so it coordinates with
  the dotfiles `run_once_before_20-install-blesh.sh` installer (whichever runs first
  wins; the other short-circuits).
- Optionally installs **fzf** (`installFzf`, default true): a pinned fzf binary to
  `~/.local/bin/fzf` plus its `completion.bash` / `key-bindings.bash` shell files to
  `~/.local/share/fzf/`. ble.sh's fzf integration auto-detects that base directory, so
  `fzf-completion` and `fzf-key-bindings` work. Without fzf, ble emits
  `"fzf" not found` / `_fzf_complete is not a function` on every prompt. The fzf
  binary-only release tarball ships neither shell file, so the feature fetches them
  from the fzf repo at the pinned tag. fzf install is best-effort and non-fatal.

## Options

| Option       | Type    | Default        | Description |
|--------------|---------|----------------|-------------|
| `version`    | string  | `0.4.0-devel3` | ble.sh release version (the `akinomyoga/ble.sh` release tag without the leading `v`). Fetches `ble-<version>.tar.xz`. |
| `installFzf` | boolean | `true`         | Also install a pinned fzf binary + shell integration files so ble.sh's fzf integration works. |
| `fzfVersion` | string  | `0.74.3`       | fzf release version to install when `installFzf` is true (`junegunn/fzf` tag without the leading `v`). |

## Usage

Enable via user-level lace config (`~/.config/lace/user.json`) so every container
gets it, mirroring how other features are declared:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/blesh:1": {}
  }
}
```

Or per-project in `devcontainer.json` under `features` / `customizations.lace.prebuildFeatures`.

## Notes

- ble.sh only fully attaches inside a **live interactive** bash prompt loop, so
  `BLE_VERSION` is populated in an interactive session, not in a one-shot
  `bash -c '...'`. Verify in an interactive shell (e.g. a tmux pane).
- Requires bash to be the interactive shell. Pair with `lace-fundamentals`
  `defaultShell` set to bash so the login shell is bash.
