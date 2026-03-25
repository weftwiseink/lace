# Git identity bootstrap step
# Creates a runtime init script that configures git identity from environment variables.
# This is a lifecycle helper, not a build-time action: env vars are not available during build.
#
# Identity layering:
# 1. user.json git section -> lace injects LACE_GIT_NAME/LACE_GIT_EMAIL into containerEnv
# 2. Init script writes ~/.gitconfig from LACE_GIT_NAME/LACE_GIT_EMAIL (default identity)
# 3. Project containerEnv with GIT_CONFIG_* -> overrides at runtime (project identity)
# 4. Repo-level .gitconfig -> overrides global per git's native resolution

cat > /usr/local/bin/lace-fundamentals-init <<'INITEOF'
#!/bin/sh
# lace-fundamentals-init: runtime initialization for lace fundamentals.
# Called from postCreateCommand or entrypoint lifecycle hooks.

# --- Git identity ---
# Write user.json defaults to ~/.gitconfig.
# LACE_GIT_NAME/LACE_GIT_EMAIL are set by lace from user.json git section.
# These are NOT recognized by git: this script writes them to ~/.gitconfig.
# Projects can override via GIT_CONFIG_COUNT/GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_* env vars,
# which git reads at runtime and which take precedence over ~/.gitconfig.
if [ -n "${LACE_GIT_NAME:-}" ]; then
    git config --global user.name "$LACE_GIT_NAME"
    echo "lace-fundamentals: git user.name set to '$LACE_GIT_NAME'"
fi

if [ -n "${LACE_GIT_EMAIL:-}" ]; then
    git config --global user.email "$LACE_GIT_EMAIL"
    echo "lace-fundamentals: git user.email set to '$LACE_GIT_EMAIL'"
fi

# --- Dotfiles ---
# Apply chezmoi if the dotfiles repo is mounted
DOTFILES_PATH="${LACE_DOTFILES_PATH:-/mnt/lace/repos/dotfiles}"
if [ -d "$DOTFILES_PATH" ] && command -v chezmoi >/dev/null 2>&1; then
    echo "lace-fundamentals: Applying dotfiles from $DOTFILES_PATH..."
    chezmoi apply --source "$DOTFILES_PATH" --no-tty || {
        echo "lace-fundamentals: WARNING: chezmoi apply failed (non-fatal)."
    }
else
    if [ ! -d "$DOTFILES_PATH" ]; then
        echo "lace-fundamentals: No dotfiles repo at $DOTFILES_PATH, skipping chezmoi apply."
    fi
fi

echo "lace-fundamentals: Runtime initialization complete."
INITEOF

chmod +x /usr/local/bin/lace-fundamentals-init
