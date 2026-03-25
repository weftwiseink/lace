#!/bin/sh
set -eu

# Feature option variables (devcontainer CLI injects these as env vars)
SSH_PORT="${SSHPORT:-2222}"
DEFAULT_SHELL="${DEFAULTSHELL:-}"
ENABLE_SSH_HARDENING="${ENABLESSHHARDENING:-true}"
_REMOTE_USER="${_REMOTE_USER:-root}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source each step in dependency order
. "$SCRIPT_DIR/steps/staples.sh"
. "$SCRIPT_DIR/steps/ssh-hardening.sh"
. "$SCRIPT_DIR/steps/ssh-directory.sh"
. "$SCRIPT_DIR/steps/chezmoi.sh"
. "$SCRIPT_DIR/steps/git-identity.sh"
. "$SCRIPT_DIR/steps/shell.sh"

echo "lace-fundamentals: Install complete."
