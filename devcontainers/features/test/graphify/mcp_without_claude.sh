#!/bin/bash
set -e

# installMcpServer=true with NO claude-code feature present. The core install
# must still succeed (this scenario only builds if install.sh exited 0), the
# `claude` CLI must be absent, and no broken Claude config must be written.

source dev-container-features-test-lib

check "graphify still installed despite MCP opt-in without claude" command -v graphify
check "graphify --version resolves" bash -c 'graphify --version | grep -q "0.9.61"'
check "claude CLI is absent (this scenario has no claude-code feature)" bash -c '! command -v claude'
check "no graphify MCP entry written to a Claude config" bash -c '! grep -rq "graphify-mcp" "$HOME/.claude.json" "$HOME/.claude" 2>/dev/null'

reportResults
