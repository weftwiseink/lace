#!/bin/sh
set -eu

# graphify (code graph) devcontainer feature.
#
# Installs the `graphifyy` PyPI package system-wide via pipx so the `graphify`
# CLI is on PATH for every user (no per-user PATH fragility), then creates and
# chowns the GRAPHIFY_OUT cache/output dir the lace `index` mount targets.
#
# Phase-1-confirmed facts (see the impl devlog): the CLI verify command is
# `graphify --version`; the index command is `graphify update <path>`; the
# output/cache dir is project-local `graphify-out/` by default, redirected here
# out of the working tree via GRAPHIFY_OUT (set in devcontainer-feature.json's
# containerEnv) so it can be mounted without polluting the repo; the MCP server
# is the dedicated `graphify-mcp` console script (stdio default).

VERSION="${VERSION:-0.9.61}"
INSTALL_MCP="${INSTALLMCPSERVER:-false}"
INSTALL_HOOK="${INSTALLGITHOOK:-false}"

_REMOTE_USER="${_REMOTE_USER:-root}"
if [ "$_REMOTE_USER" = "root" ]; then
    USER_HOME="/root"
else
    USER_HOME="/home/${_REMOTE_USER}"
fi

# System-wide install so the CLI is on PATH for every user (no per-user PATH fragility).
export PIPX_HOME=/usr/local/pipx
export PIPX_BIN_DIR=/usr/local/bin

# Resolve a pipx invocation. `dependsOn python` provides Python 3, but the python
# feature installs pipx into an isolated /usr/local/py-utils venv that is NOT
# guaranteed on this script's build-time PATH, and `python3 -m pipx` fails for the
# same reason (pipx is not in the base interpreter's site-packages). So probe for
# pipx, and self-provision it onto python3 if absent, idempotently.
if command -v pipx >/dev/null 2>&1; then
    PIPX="pipx"
elif python3 -m pipx --version >/dev/null 2>&1; then
    PIPX="python3 -m pipx"
else
    echo "graphify: pipx not found on build PATH; bootstrapping it via pip."
    command -v python3 >/dev/null 2>&1 || {
        echo "graphify: Error: python3 is required. Add ghcr.io/devcontainers/features/python." >&2
        exit 1
    }
    python3 -m ensurepip --upgrade >/dev/null 2>&1 || true
    # --break-system-packages guards the PEP 668 edge: the intended `dependsOn
    # python` path is a source-built /usr/local CPython with no EXTERNALLY-MANAGED
    # marker (so the flag is a harmless no-op there), but a distro-managed python3
    # (Debian/Ubuntu ship the marker) would otherwise refuse the bootstrap.
    python3 -m pip install --break-system-packages --upgrade pip pipx >/dev/null 2>&1 \
        || python3 -m pip install --break-system-packages --user pipx
    PIPX="python3 -m pipx"
fi

echo "graphify: installing graphifyy==${VERSION} via pipx (system-wide into ${PIPX_BIN_DIR})..."
# shellcheck disable=SC2086
$PIPX install "graphifyy==${VERSION}"

# Verify the CLI resolves on PATH. Fail loudly if it does not (catches the
# pipx-into-a-root-only-location failure mode).
command -v graphify >/dev/null 2>&1 || {
    echo "graphify: Error: graphify not on PATH after install (expected a shim in ${PIPX_BIN_DIR})." >&2
    exit 1
}
graphify --version

# Create the GRAPHIFY_OUT cache/output dir so the lace mount target exists and is
# owned by the remote user. GRAPHIFY_OUT is set to $HOME/.cache/graphify via the
# manifest's containerEnv; this path matches for both root ($HOME=/root) and a
# non-root user ($HOME=/home/<user>).
CACHE_DIR="${USER_HOME}/.cache/graphify"
mkdir -p "$CACHE_DIR"
if [ "$_REMOTE_USER" != "root" ]; then
    chown -R "${_REMOTE_USER}:${_REMOTE_USER}" "${USER_HOME}/.cache" 2>/dev/null || true
fi
echo "graphify: cache/output dir ready at ${CACHE_DIR} (GRAPHIFY_OUT)."

# ---------------------------------------------------------------------------
# Optional: register the graphify MCP server for the remote user (default off).
# Guarded and non-fatal: the core install must stand alone without claude-code.
# ---------------------------------------------------------------------------
if [ "$INSTALL_MCP" = "true" ]; then
    if command -v claude >/dev/null 2>&1; then
        echo "graphify: registering the graphify MCP server via 'claude mcp add' (user scope)..."
        # install.sh runs as root, but `claude mcp add -s user` must write the
        # REMOTE user's config. Run it as that user via a login shell so HOME and
        # the claude CLI on PATH resolve. `graphify-mcp` defaults to stdio.
        if [ "$_REMOTE_USER" = "root" ]; then
            claude mcp add graphify -s user -- graphify-mcp \
                || echo "graphify: WARNING: 'claude mcp add' failed; MCP server not registered." >&2
        else
            su - "$_REMOTE_USER" -c 'claude mcp add graphify -s user -- graphify-mcp' \
                || echo "graphify: WARNING: 'claude mcp add' failed; MCP server not registered." >&2
        fi
    else
        echo "graphify: WARNING: installMcpServer=true but the 'claude' CLI is not present." >&2
        echo "graphify:          Add ghcr.io/weftwiseink/devcontainer-features/claude-code to register the MCP server. Skipping (non-fatal)." >&2
    fi
fi

# ---------------------------------------------------------------------------
# Optional: post-commit git hook running `graphify update` (default off).
# Uses a global hooks dir for the remote user so it applies to any repo checked
# out in the container. Guarded and non-fatal.
# ---------------------------------------------------------------------------
if [ "$INSTALL_HOOK" = "true" ]; then
    echo "graphify: installing post-commit git hook (graphify update)..."
    HOOKS_DIR="${USER_HOME}/.config/git/hooks"
    mkdir -p "$HOOKS_DIR"
    cat > "${HOOKS_DIR}/post-commit" <<'HOOK'
#!/bin/sh
# graphify: keep the code graph fresh after each commit. Non-fatal: a failed
# index refresh must never block a commit. Runs against the repo root.
command -v graphify >/dev/null 2>&1 || exit 0
graphify update "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" >/dev/null 2>&1 || true
HOOK
    chmod +x "${HOOKS_DIR}/post-commit"
    if [ "$_REMOTE_USER" = "root" ]; then
        git config --global core.hooksPath "$HOOKS_DIR" 2>/dev/null || true
    else
        chown -R "${_REMOTE_USER}:${_REMOTE_USER}" "${USER_HOME}/.config" 2>/dev/null || true
        su - "$_REMOTE_USER" -c "git config --global core.hooksPath '${HOOKS_DIR}'" 2>/dev/null || true
    fi
    echo "graphify: post-commit hook installed at ${HOOKS_DIR}/post-commit (global core.hooksPath)."
fi

echo "graphify: install complete."
