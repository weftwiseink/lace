#!/bin/sh
set -eu

VERSION="${VERSION:-20240203-110809-5046fc22}"
CREATERUNTIMEDIR="${CREATERUNTIMEDIR:-true}"

# Verify curl is available
command -v curl >/dev/null 2>&1 || {
    echo "Error: curl is required. Install it or add ghcr.io/devcontainers/features/common-utils."
    exit 1
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64)  echo "amd64" ;;
        aarch64) echo "arm64" ;;
        *)       echo "unsupported"; return 1 ;;
    esac
}

ARCH=$(detect_arch)

# Detect distro family via /etc/os-release
detect_distro_family() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        case "$ID" in
            debian|ubuntu|linuxmint|pop) echo "debian" ;;
            fedora|centos|rhel|rocky|alma) echo "redhat" ;;
            opensuse*|sles) echo "suse" ;;
            alpine) echo "alpine" ;;
            *) # Check ID_LIKE for derivatives
                case "${ID_LIKE:-}" in
                    *debian*) echo "debian" ;;
                    *rhel*|*fedora*) echo "redhat" ;;
                    *suse*) echo "suse" ;;
                    *) echo "unknown" ;;
                esac ;;
        esac
    else
        echo "unknown"
    fi
}

DISTRO_FAMILY=$(detect_distro_family)

echo "Installing wezterm-mux-server and wezterm CLI (version: ${VERSION}, arch: ${ARCH}, distro: ${DISTRO_FAMILY})..."

# Extract binaries from .deb without installing dependencies
install_from_deb() {
    command -v dpkg >/dev/null 2>&1 || { echo "Error: dpkg not found on Debian-family system."; exit 1; }
    if [ "$ARCH" = "amd64" ]; then
        DEB_NAME="wezterm-${VERSION}.Debian12.deb"
    else
        DEB_NAME="wezterm-${VERSION}.Debian12.${ARCH}.deb"
    fi
    curl -fsSL -o /tmp/wezterm.deb \
        "https://github.com/wez/wezterm/releases/download/${VERSION}/${DEB_NAME}"
    dpkg -x /tmp/wezterm.deb /tmp/wezterm-extract
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm-mux-server /usr/local/bin/
    install -m755 /tmp/wezterm-extract/usr/bin/wezterm /usr/local/bin/
    rm -rf /tmp/wezterm.deb /tmp/wezterm-extract
}

# Route to the appropriate installer
case "$DISTRO_FAMILY" in
    debian)
        install_from_deb ;;
    *)
        echo "Error: ${DISTRO_FAMILY} is not yet supported by wezterm-server feature."
        echo "Currently supported: Debian, Ubuntu, and Debian derivatives."
        echo "Fedora/RHEL (RPM) and AppImage support planned for a future release."
        exit 1 ;;
esac

# Optional: create runtime directory
if [ "$CREATERUNTIMEDIR" = "true" ]; then
    _REMOTE_USER="${_REMOTE_USER:-root}"
    USER_ID=$(id -u "$_REMOTE_USER" 2>/dev/null || echo "1000")
    mkdir -p "/run/user/${USER_ID}"
    chown "${_REMOTE_USER}:${_REMOTE_USER}" "/run/user/${USER_ID}"
fi

echo "wezterm-mux-server and wezterm CLI installed successfully."
wezterm-mux-server --version || true
