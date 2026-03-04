#!/bin/sh
set -eu

VERSION="${VERSION:-v0.11.6}"

# Verify curl is available
command -v curl >/dev/null 2>&1 || {
    echo "Error: curl is required. Install it or add ghcr.io/devcontainers/features/common-utils."
    exit 1
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64)  echo "x86_64" ;;
        aarch64) echo "arm64" ;;
        *)       echo "Error: unsupported architecture $(uname -m). Only x86_64 and aarch64 are supported." >&2; return 1 ;;
    esac
}

ARCH=$(detect_arch)

echo "Installing Neovim (version: ${VERSION}, arch: ${ARCH})..."

# Neovim publishes statically linked tarballs -- no distro-specific logic needed.
# Tarball layout: nvim-linux-${ARCH}/bin/nvim, nvim-linux-${ARCH}/lib/..., etc.
TARBALL_URL="https://github.com/neovim/neovim/releases/download/${VERSION}/nvim-linux-${ARCH}.tar.gz"

curl -fsSL -o /tmp/nvim.tar.gz "$TARBALL_URL"

# Extract directly into /usr/local so binaries land at /usr/local/bin/nvim.
# The tarball root is nvim-linux-${ARCH}/, so --strip-components=1 removes it.
tar -xzf /tmp/nvim.tar.gz -C /usr/local --strip-components=1

rm /tmp/nvim.tar.gz

# Create the plugin state directory so the lace mount target exists.
_REMOTE_USER="${_REMOTE_USER:-root}"
NVIM_DATA_DIR="/home/${_REMOTE_USER}/.local/share/nvim"
mkdir -p "$NVIM_DATA_DIR"
chown -R "${_REMOTE_USER}:${_REMOTE_USER}" "/home/${_REMOTE_USER}/.local"

echo "Neovim installed successfully."
nvim --version
