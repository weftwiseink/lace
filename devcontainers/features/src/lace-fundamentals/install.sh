#!/bin/sh
set -eu

# Feature option variables (devcontainer CLI injects these as env vars)
DEFAULT_SHELL="${DEFAULTSHELL:-}"
_REMOTE_USER="${_REMOTE_USER:-root}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source each step in dependency order
. "$SCRIPT_DIR/steps/staples.sh"
. "$SCRIPT_DIR/steps/chezmoi.sh"
. "$SCRIPT_DIR/steps/git-identity.sh"
. "$SCRIPT_DIR/steps/shell.sh"

echo "lace-fundamentals: Install complete."
