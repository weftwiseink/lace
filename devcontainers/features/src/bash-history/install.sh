#!/bin/sh
set -eu

# Persistent Bash History devcontainer feature.
#
# Mount-only: this feature installs no binary. Its devcontainer-feature.json
# declares the per-project `/bash-history` bind mount (via
# customizations.lace.mounts.history) and sets containerEnv.HISTFILE to
# /bash-history/.bash_history, so lace auto-injects the mount into every
# container the feature is enabled in and interactive bash records history there.
#
# install.sh does one substantive thing: it writes an idempotent, one-time
# login-shell migration snippet that preserves any history left at the OLD
# /commandhistory target (from a container built before the /bash-history
# rename). The migration must run at shell time, not build time: the bind mount
# is not guaranteed present during the feature build, but it is reliably present
# in an interactive login shell. A /etc/profile.d/*.sh snippet runs at every
# login-shell startup, is idempotent via a .migrated marker, and needs no
# postCreate ordering guarantee.

# _REMOTE_USER is resolved the same way blesh does. Unlike blesh, this feature
# writes nothing under the user's home directory (history lives on the
# /bash-history mount, which lace owns), so no USER_HOME is derived here.
_REMOTE_USER="${_REMOTE_USER:-root}"

MIGRATE_SNIPPET="/etc/profile.d/bash-history-migrate.sh"

# One-time, idempotent migration: preserve history from the old /commandhistory
# target if a container ever wrote there. Copies without clobbering newer data,
# then drops a .migrated marker so it never runs again.
cat > "${MIGRATE_SNIPPET}" <<'PROFILE_EOF'
if [ -d /bash-history ] && [ -d /commandhistory ] && [ ! -e /bash-history/.migrated ]; then
  # copy anything the old path holds, without clobbering newer data
  for f in .bash_history full_history .full_history; do
    if [ -f "/commandhistory/$f" ] && [ ! -e "/bash-history/$f" ]; then
      cp -p "/commandhistory/$f" "/bash-history/$f" 2>/dev/null || true
    fi
  done
  : > /bash-history/.migrated 2>/dev/null || true
fi
PROFILE_EOF

chmod 0644 "${MIGRATE_SNIPPET}"

# Ownership: the profile.d snippet is read by every login shell and stays
# root-owned/world-readable (mirrors distro-shipped profile.d scripts). The
# feature install runs as root; if a non-root remote user is configured, make a
# best-effort chown so the snippet's group/user match the remote user's
# environment, consistent with blesh's chown-the-remote-user pattern. The
# /bash-history mount itself is provisioned and owned by lace at mount time, so
# it is intentionally not touched here (it may not exist during the build).
if [ "$_REMOTE_USER" != "root" ]; then
    chown "${_REMOTE_USER}:${_REMOTE_USER}" "${MIGRATE_SNIPPET}" 2>/dev/null || true
fi

echo "bash-history: install complete (mount-only; migration snippet at ${MIGRATE_SNIPPET})."
