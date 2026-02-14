# don't upgrade to 25! for some reason corepack doesn't come installed with it.
FROM lace.local/node:24-bookworm

ARG ELECTRON_VERSION="39.2.7"
ARG PLAYWRIGHT_VERSION="1.57.0"

ARG GIT_DELTA_VERSION="0.18.2"

ARG COMMAND_HISTORY_PATH="/commandhistory"

ARG USERNAME=node

ARG TZ
ENV TZ="$TZ"

ENV DEVCONTAINER=true

# Install essential system tools and Playwright dependencies
# These are required for:
# - Playwright e2e tests (pnpm test:e2e)
# - Playwright MCP for screenshot capture
# - Electron headless testing
#
# NOTE: psmisc provides fuser for killing zombie processes on ports
RUN apt-get update && apt-get install -y \
    git \
    curl \
    psmisc \
    sudo \
    # Playwright/Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    # Electron headless testing dependencies (xvfb + GTK)
    xvfb \
    xauth \
    libgtk-3-0 \
    libnotify4 \
    libxss1 \
    libxtst6 \
    && rm -rf /var/lib/apt/lists/*

# corepack is... node npm management of javascript package managers.
# we want to use pnpm for it's content-addressable storage,
# just so we can cache node_modules outside of the project dir
# https://github.com/pnpm/pnpm/issues/9014#issuecomment-2623761494
RUN corepack install -g pnpm@10.26.2+sha1.$(npm view pnpm@10.26.2 dist.shasum)
RUN corepack enable && corepack prepare pnpm@latest-10 --activate

# Ensure default node user has access to npm global directory
RUN mkdir -p /usr/local/share/npm-global && \
    chown -R node:node /usr/local/share

#
# https://code.claude.com/docs/en/devcontainer
#
# Create workspace and config directories and set permissions (as root)
RUN mkdir -p /workspace /home/${USERNAME}/.claude ${COMMAND_HISTORY_PATH} && \
    touch ${COMMAND_HISTORY_PATH}/.bash_history && \
    chown -R ${USERNAME}:${USERNAME} /workspace /home/${USERNAME}/.claude ${COMMAND_HISTORY_PATH}

# Persist bash history from https://github.com/anthropics/claude-code/blob/main/.devcontainer/Dockerfile
RUN echo "export PROMPT_COMMAND='history -a' && export HISTFILE=${COMMAND_HISTORY_PATH}/.bash_history" >> /home/${USERNAME}/.bashrc
# TODO: ble.sh setup and config for above

WORKDIR /workspace

# Install git-delta (as root)
RUN ARCH=$(dpkg --print-architecture) && \
    wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# NOTE: Firewall script removed - provided marginal security benefit while breaking
# web search/fetch tools. Devcontainer sandbox provides sufficient isolation.
# See docs/reports/2026-01-18_devcontainer_firewall_analysis.md
# Original: https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh

# Set up SSH authorized_keys directory for wezterm SSH domain connections
# NOTE: The sshd feature does not create per-user .ssh directories.
# This is required for the bind-mounted authorized_keys file.
RUN mkdir -p /home/${USERNAME}/.ssh && \
    chmod 700 /home/${USERNAME}/.ssh && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/.ssh

# Set up wezterm config directory for bind-mounted wezterm.lua
# NOTE: The wezterm.lua file itself is delivered via bind mount in devcontainer.json
# (not COPY) so changes take effect without rebuilding the container.
RUN mkdir -p /home/${USERNAME}/.config/wezterm && \
    chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config

# Enable passwordless sudo for container user.
# Required by devcontainer features (e.g. sshd) whose init scripts use `sudo` at runtime.
RUN echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} && \
    chmod 0440 /etc/sudoers.d/${USERNAME}

# Switch to node user for all user-level installations and builds
USER ${USERNAME}

# Configure npm to use user-writable global directory
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

#
# larger dev dependencies to layer before rest of dependencies
#

# Pre-install larger packages before rest so they aren't cache-busted
# NOTE: Update these versions when upgrading playwright/electron in package.json
RUN pnpm install "electron@${ELECTRON_VERSION}" && \
    node node_modules/electron/install.js

RUN pnpm install "playwright@${PLAYWRIGHT_VERSION}" && \
    npx playwright install chromium

# Copy package files and install dependencies as node user
COPY --chown=${USERNAME}:${USERNAME} package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Electron binary already installed globally above; link or skip local install
# (pnpm-workspace.yaml has onlyBuiltDependencies: electron)

# Copy source files needed for Electron build as node user
COPY --chown=${USERNAME}:${USERNAME} . .

# Build Electron renderer SPA (produces dist-electron/)
# Non-fatal: logs errors to file for reference if build fails
RUN pnpm build:electron 2>&1 | tee /tmp/electron_build.log || \
    (echo "WARNING: Electron build failed. See /workspace/electron_build_error.log" && \
     cp /tmp/electron_build.log /workspace/electron_build_error.log)

# TODO: Sculptor has no viable way of doing sidecar startup as a user it's so nuts
# setup script to shoehorn in a npm run dev entrypoint-ish bg process via devcontainer onCreateCommand
# COPY .sculptor/on_create.sh ./on_create.sh
# RUN chmod a+x ./on_create.sh

# Default command (overridden by sculptor anyways)
# CMD ["npm", "run", "dev"]
