#!/bin/sh
set -eu

ENABLEMETADATAWRITER="${ENABLEMETADATAWRITER:-true}"
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

# Install the metadata writer (gated behind enableMetadataWriter option).
if [ "$ENABLEMETADATAWRITER" = "true" ]; then
    # Install the standalone metadata writer script.
    cp "$(dirname "$0")/sprack-metadata-writer.sh" /usr/local/bin/sprack-metadata-writer
    chmod +x /usr/local/bin/sprack-metadata-writer

    # Bash integration: profile.d script that hooks PROMPT_COMMAND.
    cat > /etc/profile.d/sprack-metadata.sh << 'PROFILE_EOF'
# Sprack metadata writer prompt hook.
# Calls sprack-metadata-writer on every prompt to update git state in /mnt/sprack/metadata/state.json.
if [ -n "${BASH_VERSION:-}" ]; then
    PROMPT_COMMAND="sprack-metadata-writer;${PROMPT_COMMAND:-}"
fi
PROFILE_EOF

    # Nushell integration: env file that adds a pre_prompt hook.
    # Nushell does not source /etc/profile.d/ scripts, so a separate .nu file is needed.
    # The user's nushell config must source this file (typically via chezmoi dotfiles).
    mkdir -p /etc/nushell
    cat > /etc/nushell/sprack-hooks.nu << 'NU_EOF'
# Sprack metadata writer hook for nushell.
# Source this file from your nushell env.nu or config.nu:
#   source /etc/nushell/sprack-hooks.nu
$env.config.hooks.pre_prompt = ($env.config.hooks.pre_prompt | default [] | append {||
    if ("/mnt/sprack/metadata" | path exists) {
        ^sprack-metadata-writer
    }
})
NU_EOF

    echo "Sprack integration installed (mount dirs + hook bridge + metadata writer)."
else
    echo "Sprack integration installed (mount dirs + hook bridge, metadata writer disabled)."
fi
