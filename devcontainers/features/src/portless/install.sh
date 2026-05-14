#!/bin/sh
set -eu

VERSION="${VERSION:-latest}"
# PROXYPORT is set by the devcontainer CLI from the `proxyPort` option.
# With lace symmetric port injection, this becomes the lace-allocated host
# port (e.g., 22427); with no lace, it falls back to the default "1355".
PROXYPORT="${PROXYPORT:-1355}"

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
# Auto-start portless proxy daemon. Port is set by the \`proxyPort\` feature
# option (defaults to 1355; lace symmetric injection sets it to the
# lace-allocated host port so host:port -> container:port is a symmetric
# mapping that reaches the proxy directly).
# \`--no-tls\` keeps the daemon to plain HTTP, which is what v1 needs;
# HTTPS is deferred to the portless-trust follow-up RFP.
PROXY_PORT="${PROXYPORT}"
if command -v portless >/dev/null 2>&1; then
    if [ "\$(id -u)" = "0" ] && [ "${_REMOTE_USER}" != "root" ]; then
        su -c "portless proxy start --port \$PROXY_PORT --no-tls 2>/dev/null || true" ${_REMOTE_USER}
    else
        portless proxy start --port "\$PROXY_PORT" --no-tls 2>/dev/null || true
    fi
fi
ENTRYPOINT
chmod +x "$FEATURE_DIR/entrypoint.sh"

echo "Portless feature installed. Proxy entrypoint will listen on port ${PROXYPORT}."
