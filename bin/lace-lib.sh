#!/bin/bash
# lace-lib.sh: Shared functions for lace bin scripts.
# Source this file in each script: . "$(dirname "${BASH_SOURCE[0]}")/lace-lib.sh"

# --- Container runtime resolution ---
# Returns the active container CLI command (podman or docker).
# Resolution order:
#   1. CONTAINER_RUNTIME env var (if set and valid)
#   2. overridePodmanCommand from ~/.config/lace/settings.json
#   3. Auto-detect: podman first, then docker
#
# Consistent with TypeScript resolveContainerRuntime() and getPodmanCommand()
# in packages/lace/src/lib/container-runtime.ts.
resolve_runtime() {
  # 1. Respect CONTAINER_RUNTIME env var override
  if [ -n "${CONTAINER_RUNTIME:-}" ]; then
    case "$CONTAINER_RUNTIME" in
      podman|docker)
        echo "$CONTAINER_RUNTIME"
        return
        ;;
      *)
        echo "WARNING: CONTAINER_RUNTIME='$CONTAINER_RUNTIME' is not valid (expected podman or docker). Auto-detecting." >&2
        ;;
    esac
  fi

  # 2. Check settings.json for overridePodmanCommand
  local settings_file="$HOME/.config/lace/settings.json"
  if [ -f "$settings_file" ]; then
    # Extract overridePodmanCommand via grep+sed (no jq dependency).
    # Handles: "overridePodmanCommand": "some-command"
    local override
    override=$(grep -o '"overridePodmanCommand"[[:space:]]*:[[:space:]]*"[^"]*"' "$settings_file" 2>/dev/null \
      | sed 's/.*"overridePodmanCommand"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || true)
    if [ -n "$override" ]; then
      echo "$override"
      return
    fi
  fi

  # 3. Auto-detect: prefer podman, fall back to docker
  if command -v podman &>/dev/null; then
    echo "podman"
  elif command -v docker &>/dev/null; then
    echo "docker"
  else
    echo "ERROR: No container runtime found. Install podman or docker." >&2
    return 1
  fi
}

# Resolve runtime once and export for use throughout the script.
# Scripts that source lace-lib.sh get $RUNTIME automatically.
RUNTIME=$(resolve_runtime) || exit 1
