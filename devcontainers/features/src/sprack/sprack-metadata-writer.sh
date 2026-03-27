#!/bin/sh
# sprack-metadata-writer: writes current workdir and git state to /mnt/sprack/metadata/state.json.
# Designed to be called from a shell prompt hook (PROMPT_COMMAND, pre_prompt, etc.).
# Fast path: bails early if /mnt/sprack/metadata does not exist or cwd is not a git repo.

METADATA_DIR="/mnt/sprack/metadata"
[ -d "$METADATA_DIR" ] || exit 0

# Fast bail if not in a git repo.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
commit=$(git rev-parse --short HEAD 2>/dev/null) || commit=""

# Check dirty state via index comparison (fast, does not scan untracked files).
git diff --quiet HEAD 2>/dev/null
dirty=$?

printf '{"ts":"%s","container_name":"%s","workdir":"%s","git_branch":"%s","git_commit_short":"%s","git_dirty":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${HOSTNAME:-$(hostname 2>/dev/null || echo unknown)}" \
    "$PWD" \
    "$branch" \
    "$commit" \
    "$([ "$dirty" -eq 0 ] && echo false || echo true)" \
    > "$METADATA_DIR/state.json"
