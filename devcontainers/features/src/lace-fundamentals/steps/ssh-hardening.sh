# SSH Hardening step
# Requires: sshd installed (via dependsOn)

if [ "$ENABLE_SSH_HARDENING" = "true" ]; then
    echo "lace-fundamentals: Hardening SSH configuration..."

    SSHD_CONFIG="/etc/ssh/sshd_config"

    if [ ! -f "$SSHD_CONFIG" ]; then
        echo "Error: sshd_config not found. The sshd dependency should have installed it."
        exit 1
    fi

    # Disable password authentication
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD_CONFIG"
    if ! grep -q '^PasswordAuthentication' "$SSHD_CONFIG"; then
        echo "PasswordAuthentication no" >> "$SSHD_CONFIG"
    fi

    # Disable keyboard-interactive (PAM-based password prompts)
    sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' "$SSHD_CONFIG"
    if ! grep -q '^KbdInteractiveAuthentication' "$SSHD_CONFIG"; then
        echo "KbdInteractiveAuthentication no" >> "$SSHD_CONFIG"
    fi

    # Enable pubkey authentication explicitly
    sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$SSHD_CONFIG"
    if ! grep -q '^PubkeyAuthentication' "$SSHD_CONFIG"; then
        echo "PubkeyAuthentication yes" >> "$SSHD_CONFIG"
    fi

    # Disable root login
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' "$SSHD_CONFIG"
    if ! grep -q '^PermitRootLogin' "$SSHD_CONFIG"; then
        echo "PermitRootLogin no" >> "$SSHD_CONFIG"
    fi

    # Disable agent forwarding (no credential leakage)
    sed -i 's/^#*AllowAgentForwarding.*/AllowAgentForwarding no/' "$SSHD_CONFIG"
    if ! grep -q '^AllowAgentForwarding' "$SSHD_CONFIG"; then
        echo "AllowAgentForwarding no" >> "$SSHD_CONFIG"
    fi

    # Allow local TCP forwarding only
    sed -i 's/^#*AllowTcpForwarding.*/AllowTcpForwarding local/' "$SSHD_CONFIG"
    if ! grep -q '^AllowTcpForwarding' "$SSHD_CONFIG"; then
        echo "AllowTcpForwarding local" >> "$SSHD_CONFIG"
    fi

    # Disable X11 forwarding
    sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' "$SSHD_CONFIG"
    if ! grep -q '^X11Forwarding' "$SSHD_CONFIG"; then
        echo "X11Forwarding no" >> "$SSHD_CONFIG"
    fi

    # Validate port consistency
    CONFIGURED_PORT=$(grep -oP '(?<=^Port )\d+' "$SSHD_CONFIG" 2>/dev/null || echo "2222")
    if [ "$CONFIGURED_PORT" != "$SSH_PORT" ]; then
        echo "WARNING: sshd port ($CONFIGURED_PORT) does not match sshPort option ($SSH_PORT)."
    fi

    echo "lace-fundamentals: SSH hardened (key-only auth, no password, no root login, local-only TCP forwarding)."
else
    echo "lace-fundamentals: SSH hardening disabled via option."
fi
