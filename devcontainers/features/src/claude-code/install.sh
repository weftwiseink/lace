#!/bin/sh
set -eu

VERSION="${VERSION:-latest}"

# Verify npm is available
command -v npm >/dev/null 2>&1 || {
    echo "Error: npm is required. Install Node.js or add ghcr.io/devcontainers/features/node."
    exit 1
}

echo "Installing Claude Code CLI (version: ${VERSION})..."

npm install -g "@anthropic-ai/claude-code@${VERSION}"

# Create config directory for the remote user
_REMOTE_USER="${_REMOTE_USER:-root}"
CLAUDE_DIR="/home/${_REMOTE_USER}/.claude"

if [ "$_REMOTE_USER" = "root" ]; then
    CLAUDE_DIR="/root/.claude"
fi

mkdir -p "$CLAUDE_DIR"
chown "${_REMOTE_USER}:${_REMOTE_USER}" "$CLAUDE_DIR"
chmod 700 "$CLAUDE_DIR"

echo "Claude Code CLI installed successfully."
claude --version
