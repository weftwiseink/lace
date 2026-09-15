#!/bin/bash
set -e

# Default-scenario checks for the graphify feature (default_install).
# The base:ubuntu image's remote user is the non-root `vscode`, so these run as
# a non-root user, exercising the verification floor (CLI on PATH for the remote
# user, not just root).

source dev-container-features-test-lib

# --- Core install + PATH (the verification floor) ---
check "graphify on PATH" command -v graphify
check "graphify --version reports the pin" bash -c 'graphify --version | grep -q "0.9.61"'
check "graphify shim is system-wide (/usr/local/bin, not ~/.local/bin)" bash -c 'command -v graphify | grep -q "^/usr/local/bin/"'
check "graphify-mcp on PATH" command -v graphify-mcp

# --- Cache/output mount-target dir (created + owned by the remote user) ---
check "GRAPHIFY_OUT cache dir exists" test -d "$HOME/.cache/graphify"
check "GRAPHIFY_OUT cache dir is writable by the remote user" test -w "$HOME/.cache/graphify"

# --- Functional smoke: graphify actually indexes (AST-only, no API key) ---
# Proves the CLI does more than resolve on PATH: it builds graph.json from a real
# tree. GRAPHIFY_OUT is set explicitly here so the check is independent of the
# container env plumbing.
setup_smoke() {
    mkdir -p /tmp/gyfix/src
    printf 'def greet(name):\n    return "hi " + name\n' > /tmp/gyfix/src/a.py
    printf 'from a import greet\ndef shout(n):\n    return greet(n).upper()\n' > /tmp/gyfix/src/b.py
}
setup_smoke
check "graphify update builds graph.json (no LLM)" bash -c 'cd /tmp/gyfix && GRAPHIFY_OUT=/tmp/gyfix-out graphify update . >/dev/null 2>&1 && test -s /tmp/gyfix-out/graph.json'
check "graph.json has nodes" bash -c 'grep -q "\"nodes\"" /tmp/gyfix-out/graph.json'

reportResults
