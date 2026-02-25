---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T12:00:00-06:00
task_list: lace/wezterm-server
type: report
state: live
status: review_ready
tags: [investigation, wezterm, devcontainer, wezterm-server, mux-server, config, cleanup]
related_to:
  - cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md
  - cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md
  - cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
---

# Investigation: Is `.devcontainer/wezterm.lua` Vestigial?

> **BLUF:** The file is **not vestigial** -- it is actively used and serves a real
> purpose. It is bind-mounted into the container at startup and configures
> `wezterm-mux-server` to open new panes in `/workspace/main` (the primary worktree
> directory). Without it, wezterm-mux-server would fall back to its default working
> directory (typically `/` or the user's home), which would be a worse developer
> experience. The file should be kept. However, there is a reasonable future path to
> eliminate it by having the wezterm-server feature or lace itself generate this config
> dynamically.

## Context / Background

The user suspects `.devcontainer/wezterm.lua` may be vestigial -- a leftover from an
earlier iteration of the devcontainer setup that is no longer needed. This investigation
examines whether the file is actively referenced, what it does, and whether its
functionality is handled elsewhere.

The file exists at `/var/home/mjr/code/weft/lace/main/.devcontainer/wezterm.lua` and
contains 18 lines of Lua configuration.

## Key Findings

### F1: The file sets a single configuration value

The entire content of `.devcontainer/wezterm.lua` is:

```lua
local wezterm = require("wezterm")
local config = wezterm.config_builder()
config.default_cwd = "/workspace/main"
return config
```

Its sole purpose is to set `default_cwd` so that when a user connects to the container
via `wezterm connect lace:<port>`, new panes and tabs open in `/workspace/main` (the
main worktree directory) instead of the default home directory or `/`.

### F2: The file is actively bind-mounted via devcontainer.json

Line 73 of `.devcontainer/devcontainer.json` declares the bind mount:

```jsonc
"source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
```

This mount delivers the file as the wezterm configuration for the `node` user inside
the container. The mount is `readonly`, so the container cannot modify it.

### F3: The Dockerfile prepares the mount target directory

Lines 100-104 of `.devcontainer/Dockerfile` create the directory structure that the bind
mount target requires:

```dockerfile
# Set up wezterm config directory for bind-mounted wezterm.lua
# NOTE: The wezterm.lua file itself is delivered via bind mount in devcontainer.json
# (not COPY) so changes take effect without rebuilding the container.
RUN mkdir -p /home/${USERNAME}/.config/wezterm && \
    chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config
```

This confirms the file's delivery mechanism is intentional and documented.

### F4: The postStartCommand relies on wezterm-mux-server reading this config

Line 88 of `devcontainer.json`:

```jsonc
"postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"
```

When `wezterm-mux-server` starts, it reads `~/.config/wezterm/wezterm.lua` (the standard
wezterm config path) to obtain its configuration. The bind-mounted file is what it finds
at that path. Without this file, wezterm-mux-server would use its built-in defaults,
which do not set `default_cwd` to `/workspace/main`.

### F5: The wezterm-server feature does NOT provide this configuration

The wezterm-server devcontainer feature (`devcontainers/features/src/wezterm-server/`)
only installs the `wezterm-mux-server` and `wezterm` binaries. Its `install.sh` does not
create any wezterm Lua configuration files, and its `devcontainer-feature.json` has no
option for setting `default_cwd` or providing a custom config. The configuration
responsibility is left entirely to the consuming project.

### F6: Integration tests explicitly verify this mount is preserved

The test file at `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` (lines
1185-1189) includes an assertion that the wezterm.lua mount is not accidentally removed
when lace auto-injects its own mounts:

```typescript
// The unrelated wezterm.lua mount should be preserved
const weztermMount = mounts.find((m: string) =>
  m.includes("wezterm.lua"),
);
expect(weztermMount).toBeDefined();
```

This confirms the mount is considered part of the expected configuration and is
protected from accidental deletion.

### F7: Historical proposals explicitly decided to keep this file

The dotfiles migration proposal (`cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md`,
line 445) states:

> `.devcontainer/wezterm.lua` remains in lace (sets default_cwd for mux server)

The self-hosting proposal (`cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md`)
documented the evolution of this file -- it was originally delivered via `COPY` in the
Dockerfile and was deliberately changed to a bind mount so that edits take effect without
a full container rebuild. That same proposal also fixed a bug where `default_cwd` was
set to `/workspace/lace` (wrong) instead of `/workspace/main` (correct).

### F8: No other mechanism provides the same functionality

There is no other file, feature, or configuration in the devcontainer setup that sets
`default_cwd` for the wezterm-mux-server. If this file were deleted:

1. The bind mount in `devcontainer.json` would fail (source file missing), which could
   cause the entire container creation to fail.
2. Even if the mount line were also removed, the Dockerfile directory creation would
   become orphaned but harmless.
3. `wezterm-mux-server` would start with no config, defaulting to the user's home
   directory (`/home/node`) for new panes instead of `/workspace/main`.

## Recommendation

**Keep the file.** It is actively used, deliberately placed, tested for, and serves a
purpose that nothing else in the stack provides.

If the goal is to reduce the number of files in `.devcontainer/`, two future paths exist:

1. **Feature-level config generation**: The wezterm-server feature could gain a
   `defaultCwd` option that generates a minimal `wezterm.lua` at install time. This
   would eliminate the per-project file but requires a feature update.

2. **Lace-level config generation**: Lace could auto-generate a container-side wezterm
   config during `lace up` based on the workspace layout declaration (which already
   knows the `workspaceFolder`). This would be the most elegant solution but requires
   new lace functionality.

Neither path is urgent. The current approach works correctly and is well-documented.
