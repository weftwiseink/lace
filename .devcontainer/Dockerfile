# don't upgrade to 25! for some reason corepack doesn't come installed with it.
FROM lace.local/node:24-bookworm

ARG GIT_DELTA_VERSION="0.18.2"

ARG COMMAND_HISTORY_PATH="/commandhistory"

ARG USERNAME=node

ARG TZ
ENV TZ="$TZ"

ENV DEVCONTAINER=true

# Install essential system tools
# NOTE: git is NOT installed here; it is provided by the devcontainer feature
#   ghcr.io/devcontainers/features/git:1 (see .lace/prebuild/devcontainer.json)
# NOTE: psmisc provides fuser for killing zombie processes on ports
RUN apt-get update && apt-get install -y \
    curl \
    psmisc \
    sudo \
    tmux \
    sqlite3 \
    libsqlite3-dev \
    pkg-config \
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
# Create config directories and set permissions (as root)
# The workspace directory (/workspaces/lace) is created empty here and populated
# at runtime by the bind mount. No source files are copied into it.
RUN mkdir -p /workspaces /home/${USERNAME}/.claude ${COMMAND_HISTORY_PATH} && \
    touch ${COMMAND_HISTORY_PATH}/.bash_history && \
    chown -R ${USERNAME}:${USERNAME} /workspaces /home/${USERNAME}/.claude ${COMMAND_HISTORY_PATH}

# Persist bash history from https://github.com/anthropics/claude-code/blob/main/.devcontainer/Dockerfile
RUN echo "export PROMPT_COMMAND='history -a' && export HISTFILE=${COMMAND_HISTORY_PATH}/.bash_history" >> /home/${USERNAME}/.bashrc

# Install git-delta (as root)
RUN ARCH=$(dpkg --print-architecture) && \
    wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# NOTE: Firewall script removed - provided marginal security benefit while breaking
# web search/fetch tools. Devcontainer sandbox provides sufficient isolation.
# See docs/reports/2026-01-18_devcontainer_firewall_analysis.md
# Original: https://github.com/anthropics/claude-code/blob/main/.devcontainer/init-firewall.sh

# Enable passwordless sudo for container user.
# Required by devcontainer features (e.g. sshd) whose init scripts use `sudo` at runtime.
RUN echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} && \
    chmod 0440 /etc/sudoers.d/${USERNAME}

# Switch to node user for all user-level installations and builds
USER ${USERNAME}

# Configure npm to use user-writable global directory
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Build-time dependency cache (isolated from runtime workspace).
# Only package metadata is copied; the full source is provided by bind mount at runtime.
# The pnpm install here pre-warms the pnpm content-addressable store in the image layer.
WORKDIR /build
COPY --chown=${USERNAME}:${USERNAME} package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Runtime workspace (populated by bind mount, not by COPY)
WORKDIR /workspaces
