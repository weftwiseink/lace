-- Container-side wezterm config for mux server
-- Sets default working directory for new panes spawned via SSH domain
--
-- This config is used by the wezterm-mux-server running inside the container.
-- When a host connects via `wezterm connect lace:<port>`, new panes will start
-- in /workspace/main (the main worktree directory) by default.
--
-- Delivered into the container via bind mount (not Dockerfile COPY).
-- See .devcontainer/devcontainer.json mounts array.

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Default working directory for new panes
-- /workspace is the bare repo root; /workspace/main is the main worktree
config.default_cwd = "/workspace/main"

return config
