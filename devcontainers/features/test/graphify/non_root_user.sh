#!/bin/bash
set -e

# Explicit non-root remote user (vscode). Guards against PATH/ownership
# regressions where install lands the shim in root's ~/.local/bin or leaves the
# cache dir root-owned so the remote user cannot write the index.

source dev-container-features-test-lib

check "running as non-root" bash -c '[ "$(id -u)" != "0" ]'
check "graphify on PATH for the remote user" command -v graphify
check "graphify --version resolves as the remote user" bash -c 'graphify --version | grep -q "0.9.61"'
check "graphify shim is system-wide" bash -c 'command -v graphify | grep -q "^/usr/local/bin/"'
check "cache dir exists and is writable by the remote user" bash -c 'test -d "$HOME/.cache/graphify" && test -w "$HOME/.cache/graphify"'
check "cache dir is owned by the remote user" bash -c '[ "$(stat -c %U "$HOME/.cache/graphify")" = "$(id -un)" ]'

reportResults
