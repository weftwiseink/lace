# $USER environment-hygiene step
#
# Non-login container shells entered via `podman exec` / `docker exec` (how lace
# enters containers) never run login/PAM/sshd, so $USER is empty. Many tools
# assume it is populated; notably ble.sh prints `insane environment: $USER is
# empty` on every prompt. Write a profile.d guard that derives $USER from the
# process owner when it is unset or empty, matching ble.sh's own self-heal.
#
# Timing caveat: /etc/profile.d/*.sh runs only for login shells, so this does
# NOT fire in the bare non-login `bash -i` path. It is a systemic backstop for
# containers/users without the dotfiles guard; the dotfiles dot_bashrc guard
# covers the non-login interactive path. See
# cdocs/proposals/2026-09-01-fix-blesh-user-env.md.

USER_ENV_SNIPPET="/etc/profile.d/05-lace-user-env.sh"

# Idempotent: ${USER:-$(id -un)} is a no-op once $USER is set, so re-sourcing
# (or a login shell that already has $USER) leaves an existing value untouched.
cat > "${USER_ENV_SNIPPET}" <<'PROFILE_EOF'
export USER="${USER:-$(id -un)}"
PROFILE_EOF

chmod 0644 "${USER_ENV_SNIPPET}"

# The profile.d snippet stays root-owned/world-readable like distro-shipped
# scripts. The feature install runs as root; if a non-root remote user is
# configured, best-effort chown so the snippet matches the remote user's
# environment, mirroring the bash-history feature's pattern.
if [ "$_REMOTE_USER" != "root" ]; then
    chown "${_REMOTE_USER}:${_REMOTE_USER}" "${USER_ENV_SNIPPET}" 2>/dev/null || true
fi

echo "lace-fundamentals: \$USER guard written to ${USER_ENV_SNIPPET}."
