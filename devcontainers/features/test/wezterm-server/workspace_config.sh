#!/bin/bash
set -e

source dev-container-features-test-lib

check "wezterm.lua exists" test -f /usr/local/share/wezterm-server/wezterm.lua
check "entrypoint.sh exists" test -f /usr/local/share/wezterm-server/entrypoint.sh
check "entrypoint.sh is executable" test -x /usr/local/share/wezterm-server/entrypoint.sh
check "wezterm.lua reads CONTAINER_WORKSPACE_FOLDER" grep -q 'os.getenv("CONTAINER_WORKSPACE_FOLDER")' /usr/local/share/wezterm-server/wezterm.lua
check "entrypoint.sh uses config-file" grep -q '\-\-config-file /usr/local/share/wezterm-server/wezterm.lua' /usr/local/share/wezterm-server/entrypoint.sh

reportResults
