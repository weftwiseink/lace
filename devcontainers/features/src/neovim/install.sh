#!/bin/sh
set -eu

VERSION="${VERSION:-v0.11.6}"

# Normalize version: ensure 'v' prefix (neovim tags are v0.x.y)
case "$VERSION" in
    v*) ;;
    *)  VERSION="v${VERSION}" ;;
esac

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

# Install tree-sitter CLI for nvim-treesitter parser compilation.
# Pre-built binaries (npm, gh-release) require glibc 2.39+; bookworm has 2.36.
# Build from source via cargo if available, which requires libclang-dev.
if [ -x /usr/local/cargo/bin/cargo ] || command -v cargo >/dev/null 2>&1; then
    echo "Installing tree-sitter-cli via cargo (for nvim-treesitter)..."
    # libclang-dev is needed for bindgen during cargo build
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq && apt-get install -y -qq libclang-dev 2>/dev/null && rm -rf /var/lib/apt/lists/* || true
    fi
    # Source cargo env explicitly (su - may start nushell which won't load .cargo/env).
    # Install globally so tree-sitter lands in /usr/local/cargo/bin/ (on PATH for all users).
    . /usr/local/cargo/env 2>/dev/null || true
    cargo install tree-sitter-cli --locked 2>&1 || {
        echo "WARNING: tree-sitter-cli install failed. nvim-treesitter parsers won't compile."
    }
else
    echo "WARNING: cargo not available. tree-sitter-cli not installed."
    echo "         nvim-treesitter parser compilation will fail."
    echo "         Add ghcr.io/devcontainers/features/rust:1 to your features."
fi

# Create the plugin state directory so the lace mount target exists.
_REMOTE_USER="${_REMOTE_USER:-root}"
NVIM_DATA_DIR="/home/${_REMOTE_USER}/.local/share/nvim"
mkdir -p "$NVIM_DATA_DIR"
chown -R "${_REMOTE_USER}:${_REMOTE_USER}" "/home/${_REMOTE_USER}/.local"

echo "Neovim installed successfully."
nvim --version
