#!/bin/sh
set -eu

# ble.sh (Bash Line Editor) devcontainer feature.
#
# Installs ble.sh for the remote user at ~/.local/share/blesh/ble.sh -- the exact
# path the dotfiles bash config expects (BLESH_DIR="$HOME/.local/share/blesh",
# sourced as "$BLESH_DIR/ble.sh"). Because the dotfiles chezmoi installer
# (run_once_before_20-install-blesh.sh) short-circuits when
# "$BLESH_DIR/ble.sh" already exists, installing here makes that run_once a no-op
# in-container -- no double install.
#
# Strategy: prefer a PINNED, prebuilt release tarball (reproducible + fast, and
# cached in the image layer when run as a prebuild feature). Fall back to a
# build-from-source clone (needs git, make, gawk) only if the tarball is
# unavailable.

VERSION="${VERSION:-0.4.0-devel3}"
# Optional fzf install so ble.sh's fzf-completion / fzf-key-bindings integration
# works (otherwise ble emits `"fzf" not found` on every prompt).
INSTALL_FZF="${INSTALLFZF:-true}"
FZF_VERSION="${FZFVERSION:-0.74.4}"

_REMOTE_USER="${_REMOTE_USER:-root}"
if [ "$_REMOTE_USER" = "root" ]; then
    USER_HOME="/root"
else
    USER_HOME="/home/${_REMOTE_USER}"
fi

BLESH_DIR="${USER_HOME}/.local/share/blesh"

mkdir -p "${BLESH_DIR}"

install_from_release() {
    command -v curl >/dev/null 2>&1 || { echo "blesh: curl not available."; return 1; }
    command -v tar  >/dev/null 2>&1 || { echo "blesh: tar not available.";  return 1; }
    command -v xz   >/dev/null 2>&1 || { echo "blesh: xz not available.";   return 1; }

    url="https://github.com/akinomyoga/ble.sh/releases/download/v${VERSION}/ble-${VERSION}.tar.xz"
    tmp="$(mktemp -d)"
    echo "blesh: fetching prebuilt release ${VERSION} from ${url}"
    if ! curl -fsSL -o "${tmp}/ble.tar.xz" "${url}"; then
        echo "blesh: release download failed."
        rm -rf "${tmp}"
        return 1
    fi
    # Release tarball layout is ble-<version>/{ble.sh,contrib,keymap,lib};
    # strip the top directory so files land directly in ${BLESH_DIR}.
    tar -xJf "${tmp}/ble.tar.xz" -C "${BLESH_DIR}" --strip-components=1
    rm -rf "${tmp}"
    [ -f "${BLESH_DIR}/ble.sh" ]
}

install_from_source() {
    for tool in git make; do
        command -v "$tool" >/dev/null 2>&1 || { echo "blesh: $tool required for source build but missing."; return 1; }
    done
    # ble.sh's build uses gawk specifically.
    if ! command -v gawk >/dev/null 2>&1; then
        echo "blesh: gawk missing; attempting to install it."
        if command -v apt-get >/dev/null 2>&1; then
            apt-get update -qq && apt-get install -y -qq gawk && rm -rf /var/lib/apt/lists/* || true
        elif command -v apk >/dev/null 2>&1; then
            apk add --no-cache gawk || true
        fi
    fi
    command -v gawk >/dev/null 2>&1 || { echo "blesh: gawk still missing; cannot build."; return 1; }

    src="${BLESH_DIR}/src"
    mkdir -p "${src}"
    echo "blesh: building from source (tag ${VERSION})..."
    # Try the pinned tag first; fall back to default branch if the tag is absent.
    git clone --recursive --depth 1 --branch "v${VERSION}" \
        https://github.com/akinomyoga/ble.sh.git "${src}" 2>/dev/null \
        || git clone --recursive --depth 1 https://github.com/akinomyoga/ble.sh.git "${src}"
    make -C "${src}" install PREFIX="${USER_HOME}/.local"
    [ -f "${BLESH_DIR}/ble.sh" ]
}

install_fzf() {
    command -v curl >/dev/null 2>&1 || { echo "blesh: curl not available for fzf."; return 1; }

    # 1. fzf binary -> ~/.local/bin/fzf (idempotent).
    if command -v fzf >/dev/null 2>&1 || [ -x "${USER_HOME}/.local/bin/fzf" ]; then
        echo "blesh: fzf binary already present; skipping binary."
    else
        command -v tar >/dev/null 2>&1 || { echo "blesh: tar not available for fzf."; return 1; }
        arch="$(uname -m)"
        case "${arch}" in
            x86_64 | amd64) fzf_arch="amd64" ;;
            aarch64 | arm64) fzf_arch="arm64" ;;
            armv7l) fzf_arch="armv7" ;;
            *) echo "blesh: unsupported arch '${arch}' for fzf; skipping."; return 1 ;;
        esac
        url="https://github.com/junegunn/fzf/releases/download/v${FZF_VERSION}/fzf-${FZF_VERSION}-linux_${fzf_arch}.tar.gz"
        tmp="$(mktemp -d)"
        echo "blesh: fetching fzf ${FZF_VERSION} (${fzf_arch}) from ${url}"
        if ! curl -fsSL -o "${tmp}/fzf.tar.gz" "${url}"; then
            echo "blesh: fzf download failed."
            rm -rf "${tmp}"
            return 1
        fi
        mkdir -p "${USER_HOME}/.local/bin"
        tar -xzf "${tmp}/fzf.tar.gz" -C "${USER_HOME}/.local/bin" fzf
        chmod +x "${USER_HOME}/.local/bin/fzf"
        rm -rf "${tmp}"
    fi

    # 2. fzf shell integration files. The binary-only tarball ships neither
    # completion.bash nor key-bindings.bash, but ble.sh's fzf integration sources
    # them from a detected base dir. Placing them at ~/.local/share/fzf/ matches
    # ble's fzf-initialize auto-detection (ret/share/fzf/key-bindings.bash), so
    # _fzf_complete / fzf key-bindings load and ble stops erroring.
    fzf_share="${USER_HOME}/.local/share/fzf"
    mkdir -p "${fzf_share}"
    for f in completion.bash key-bindings.bash; do
        if [ ! -s "${fzf_share}/${f}" ]; then
            curl -fsSL -o "${fzf_share}/${f}" \
                "https://raw.githubusercontent.com/junegunn/fzf/v${FZF_VERSION}/shell/${f}" \
                || echo "blesh: WARNING: fzf ${f} not fetched; ble fzf-${f%.bash} integration inactive." >&2
        fi
    done

    if [ "$_REMOTE_USER" != "root" ]; then
        chown "${_REMOTE_USER}:${_REMOTE_USER}" "${USER_HOME}/.local" "${USER_HOME}/.local/bin" "${USER_HOME}/.local/share" 2>/dev/null || true
        [ -e "${USER_HOME}/.local/bin/fzf" ] && chown "${_REMOTE_USER}:${_REMOTE_USER}" "${USER_HOME}/.local/bin/fzf" 2>/dev/null || true
        chown -R "${_REMOTE_USER}:${_REMOTE_USER}" "${fzf_share}" 2>/dev/null || true
    fi

    command -v fzf >/dev/null 2>&1 || [ -x "${USER_HOME}/.local/bin/fzf" ]
}

# Idempotency: skip the ble.sh install when it is already present (a re-run or a
# base image that baked it), but still fall through to the fzf install below.
if [ -f "${BLESH_DIR}/ble.sh" ]; then
    echo "blesh: ble.sh already present at ${BLESH_DIR}/ble.sh; skipping ble.sh install."
elif install_from_release; then
    echo "blesh: installed prebuilt ble.sh ${VERSION} to ${BLESH_DIR}."
elif install_from_source; then
    echo "blesh: installed ble.sh from source to ${BLESH_DIR}."
else
    echo "blesh: ERROR: could not install ble.sh via release or source." >&2
    exit 1
fi

# Ensure the remote user owns the whole tree (feature install runs as root).
if [ "$_REMOTE_USER" != "root" ]; then
    chown -R "${_REMOTE_USER}:${_REMOTE_USER}" "${USER_HOME}/.local/share/blesh" 2>/dev/null || true
fi

# fzf is optional and non-fatal: ble.sh is the primary deliverable, and the
# dotfiles blerc guards its fzf integration on `command -v fzf`.
if [ "${INSTALL_FZF}" = "true" ]; then
    if install_fzf; then
        echo "blesh: fzf ${FZF_VERSION} installed to ${USER_HOME}/.local/bin/fzf."
    else
        echo "blesh: WARNING: fzf not installed; ble.sh fzf integration stays inactive (blerc guards it)." >&2
    fi
fi

echo "blesh: install complete."
