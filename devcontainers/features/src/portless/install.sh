#!/bin/sh
set -eu

VERSION="${VERSION:-latest}"

# ── Install portless ──

echo "Installing portless@${VERSION}..."

command -v npm >/dev/null 2>&1 || {
    echo "Error: npm is required. Add a Node.js feature first."
    exit 1
}

npm install -g "portless@${VERSION}"

command -v portless >/dev/null 2>&1 || {
    echo "Error: portless not found after install."
    exit 1
}
portless --version || true

# ── Entrypoint: auto-start portless proxy ──

FEATURE_DIR="/usr/local/share/portless-feature"
mkdir -p "$FEATURE_DIR"

_REMOTE_USER="${_REMOTE_USER:-root}"
cat > "$FEATURE_DIR/entrypoint.sh" << ENTRYPOINT
#!/bin/sh
# Auto-start portless proxy daemon on default port 1355.
# Lace maps this asymmetrically (e.g., 22435:1355) via appPort.
if command -v portless >/dev/null 2>&1; then
    if [ "\$(id -u)" = "0" ] && [ "${_REMOTE_USER}" != "root" ]; then
        su -c "portless proxy 2>/dev/null || true" ${_REMOTE_USER} &
    else
        portless proxy 2>/dev/null || true &
    fi
fi
ENTRYPOINT
chmod +x "$FEATURE_DIR/entrypoint.sh"

echo "Portless feature installed. Proxy will listen on port 1355 (default)."
