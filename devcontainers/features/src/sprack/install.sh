#!/bin/sh
set -eu

_REMOTE_USER="${_REMOTE_USER:-root}"

# Ensure the mount point exists inside the container.
mkdir -p /mnt/sprack/claude-events
mkdir -p /mnt/sprack/metadata
chown -R "$_REMOTE_USER:$_REMOTE_USER" /mnt/sprack

# Ensure jq is available (required by the hook bridge).
if ! command -v jq >/dev/null 2>&1; then
    echo "Installing jq (required by sprack hook bridge)..."
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -y && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
    elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache jq
    else
        echo "WARNING: Could not install jq. Sprack hook bridge will not function."
    fi
fi

# Install the hook bridge script.
# The host settings.local.json references $HOME/.local/share/sprack/hooks/sprack-hook-bridge.
# Since settings.local.json is bind-mounted from the host into the container, the hook
# bridge must exist at the same $HOME-relative path inside the container.
if [ "$_REMOTE_USER" = "root" ]; then
    HOOK_DIR="/root/.local/share/sprack/hooks"
else
    HOOK_DIR="/home/$_REMOTE_USER/.local/share/sprack/hooks"
fi

mkdir -p "$HOOK_DIR"
cp "$(dirname "$0")/sprack-hook-bridge.sh" "$HOOK_DIR/sprack-hook-bridge"
chmod +x "$HOOK_DIR/sprack-hook-bridge"
chown -R "$_REMOTE_USER:$_REMOTE_USER" "$HOOK_DIR"

# Install the git context metadata writer as a profile.d script.
# This prompt hook writes git branch/commit/dirty state to /mnt/sprack/metadata/state.json
# on every prompt, giving sprack visibility into the container's git context.
cat > /etc/profile.d/sprack-metadata.sh << 'PROFILE_EOF'
__sprack_metadata() {
    local dir="/mnt/sprack/metadata"
    [ -d "$dir" ] || return 0
    local branch commit dirty
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || return 0
    commit=$(git rev-parse --short HEAD 2>/dev/null) || commit=""
    git diff --quiet HEAD 2>/dev/null
    dirty=$?
    printf '{"ts":"%s","workdir":"%s","git_branch":"%s","git_commit_short":"%s","git_dirty":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PWD" "$branch" "$commit" \
        "$([ "$dirty" -eq 0 ] && echo false || echo true)" > "$dir/state.json"
}
# Append to PROMPT_COMMAND for bash. Nushell and other shells use different mechanisms.
if [ -n "${BASH_VERSION:-}" ]; then
    PROMPT_COMMAND="__sprack_metadata;${PROMPT_COMMAND:-}"
fi
PROFILE_EOF

echo "Sprack integration installed (mount dirs + hook bridge + metadata writer)."
