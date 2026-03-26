#!/bin/sh
set -eu

# Ensure the mount point exists inside the container.
mkdir -p /mnt/sprack/claude-events
mkdir -p /mnt/sprack/metadata

# Ensure the container user can write to the mount.
_REMOTE_USER="${_REMOTE_USER:-root}"
chown -R "$_REMOTE_USER:$_REMOTE_USER" /mnt/sprack

echo "Sprack integration directories created."
