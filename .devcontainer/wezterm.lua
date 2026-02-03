-- Container-side wezterm config for mux server
-- Sets default working directory for new panes spawned via SSH domain
--
-- This config is used by the wezterm-mux-server running inside the container.
-- When a host connects via `wezterm connect lace`, new panes will start in
-- /workspace/lace by default.

local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Default working directory for new panes
config.default_cwd = "/workspace/lace"

return config
