# SSH directory preparation step

SSH_DIR="/home/${_REMOTE_USER}/.ssh"
if [ "$_REMOTE_USER" = "root" ]; then
    SSH_DIR="/root/.ssh"
fi

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
chown "${_REMOTE_USER}:${_REMOTE_USER}" "$SSH_DIR"
