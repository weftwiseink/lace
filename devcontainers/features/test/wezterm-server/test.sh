#!/bin/bash
set -e

source dev-container-features-test-lib

check "wezterm-mux-server installed" command -v wezterm-mux-server
check "wezterm cli installed" command -v wezterm
check "wezterm-mux-server version" wezterm-mux-server --version
check "runtime dir exists" bash -c 'ls -d /run/user/[0-9]* >/dev/null 2>&1'

reportResults
