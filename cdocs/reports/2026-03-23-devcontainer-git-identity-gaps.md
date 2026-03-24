---
first_authored:
  by: "@claude-opus-4-6-20250320"
  at: 2026-03-23T12:00:00-07:00
task_list: lace/devcontainer-git-identity
type: report
state: live
status: review_ready
tags: [devcontainer, git, architecture, lace]
---

# Devcontainer Git Identity Gaps

> BLUF: Git `user.name` and `user.email` are not configured at any level in this devcontainer, causing all `git commit` operations to fail.
> This is not a bug in lace: it is the expected consequence of running a devcontainer via SSH (terminal-native) rather than through VS Code, which silently forwards git credentials from the host.
> Neither lace, the Dockerfile, the devcontainer features, nor the chezmoi-managed dotfiles set git identity.
> The gap can be closed by adding a `.gitconfig` mount declaration to lace, by managing `~/.gitconfig` via chezmoi, or by setting `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment variables.

## Observed State

### What is configured

| Layer | Setting | Source |
|-------|---------|--------|
| `/etc/gitconfig` | `safe.directory` for homebrew | Devcontainer feature (git) |
| `/home/node/.gitconfig` | `safe.directory = *` | `postCreateCommand` in `.lace/devcontainer.json` |
| `.git/config` (repo-local) | Remote, branches, worktree extensions | Standard git operations |

### What is missing

| Setting | Status |
|---------|--------|
| `user.name` | Not set at any config level |
| `user.email` | Not set at any config level |
| `credential.helper` | Not configured |
| `GIT_AUTHOR_NAME` | Empty |
| `GIT_AUTHOR_EMAIL` | Empty |
| `GIT_COMMITTER_NAME` | Empty |
| `GIT_COMMITTER_EMAIL` | Empty |
| `GIT_ASKPASS` | Empty |
| `SSH_AUTH_SOCK` | Empty (no agent forwarding) |
| SSH private keys | None in `/home/node/.ssh/` |
| `known_hosts` | Missing (SSH to `git@github.com` fails with host key verification) |
| `gh` CLI | Not installed |

Attempting `git commit` produces:

```
Author identity unknown
*** Please tell me who you are.
fatal: unable to auto-detect email address (got 'node@dfb0036cdf75.(none)')
```

## Root Cause Analysis

### The VS Code credential forwarding gap

VS Code Remote Containers performs two automatic actions that terminal-native workflows do not:

1. **Git credential forwarding**: VS Code injects `GIT_ASKPASS` pointing to a helper that tunnels credential requests back to the host's credential manager. It also copies the host's `user.name` and `user.email` into the container's global gitconfig.
2. **SSH agent forwarding**: VS Code sets `SSH_AUTH_SOCK` to a socket that tunnels to the host's SSH agent.

> NOTE(opus/devcontainer-git-identity): These mechanisms are built into the VS Code Remote extension, not into the devcontainer spec. The `devcontainer` CLI does not implement them. Any container accessed via SSH (wezterm domain, plain `ssh`, `docker exec`) bypasses them entirely.

Lace is explicitly terminal-native. Access to the container is via SSH through the `lace-sshd` feature, not VS Code attach.
The SSH connection uses key-based auth (`authorized_keys` from host), but does not forward the SSH agent or set any git environment variables.

### No layer sets git identity

Tracing through every configuration layer:

1. **Dockerfile**: Installs system tools, sets up the `node` user, configures bash history and npm. No git identity configuration.
2. **Devcontainer features**: The `ghcr.io/devcontainers/features/git:1` feature installs git but does not configure identity. The `lace-sshd` feature handles SSH daemon setup and `authorized_keys`, not git.
3. **`postCreateCommand`**: Sets `safe.directory = *` and creates repo mount symlinks. No identity setup.
4. **Lace mount declarations**: Mount `claude-config`, `bash-history`, and `ssh/authorized_keys`. No `.gitconfig` mount.
5. **Dotfiles repo**: Managed by chezmoi but contains no `dot_gitconfig` file. The `.chezmoiignore` does not suggest one was ever managed. Git identity is managed outside of chezmoi on the host.
6. **Container environment variables**: `NODE_OPTIONS`, `CLAUDE_CONFIG_DIR`, `CONTAINER_WORKSPACE_FOLDER`, `LACE_PROJECT_NAME`. No git-related variables.

### How existing commits were made

The recent commit history shows `micimize <rosenthalm93@gmail.com>` as the author.
These commits were made on the host or via a VS Code-attached session where the host's git config was forwarded.
The container itself cannot produce new commits without manual configuration.

## Scope of Impact

| Operation | Works? | Notes |
|-----------|--------|-------|
| `git log`, `git diff`, `git status` | Yes | Read operations need no identity |
| `git commit` | No | Fails with "Author identity unknown" |
| `git push` (SSH) | No | No SSH private key or agent; `known_hosts` missing |
| `git push` (HTTPS) | No | No credential helper configured |
| `git fetch` / `git pull` (SSH) | No | Same SSH issues as push |
| `gh` CLI operations | No | `gh` is not installed |

> WARN(opus/devcontainer-git-identity): This means Claude Code running inside this container cannot create commits or push to the remote, despite having full read access to the repository.

## Options for Resolution

### Option 1: Mount host `.gitconfig` via lace

Add a mount declaration in `devcontainer.json` under `customizations.lace.mounts`:

```jsonc
"git-config": {
  "target": "/home/node/.gitconfig",
  "recommendedSource": "~/.gitconfig",
  "sourceMustBe": "file",
  "description": "Git identity and configuration"
}
```

This follows the existing pattern used for `claude-config` and `claude-config-json`.
It is the most consistent approach with lace's mount-based architecture.

Pros: reuses host config, zero container-side maintenance, consistent with lace patterns.
Cons: host `.gitconfig` may contain paths or settings that are host-specific (e.g., credential helpers referencing host binaries, delta pager path).

### Option 2: Set identity via `containerEnv`

```jsonc
"containerEnv": {
  "GIT_AUTHOR_NAME": "micimize",
  "GIT_AUTHOR_EMAIL": "rosenthalm93@gmail.com",
  "GIT_COMMITTER_NAME": "micimize",
  "GIT_COMMITTER_EMAIL": "rosenthalm93@gmail.com"
}
```

Pros: simple, no file mount needed.
Cons: hardcodes identity in tracked config; does not help with `credential.helper`, `core.pager`, or other useful settings.

### Option 3: Manage `.gitconfig` via chezmoi in dotfiles

Add `dot_gitconfig` to the dotfiles repo and apply via chezmoi inside the container.

Pros: single source of truth for the user's git config across all machines.
Cons: chezmoi is not installed in this container; would require adding it as a feature or running it manually. Also requires `chezmoi apply` as a post-create step.

### Option 4: SSH agent forwarding

Configure the SSH connection (wezterm domain or direct SSH) to forward `SSH_AUTH_SOCK`.
This solves push/pull but not commit identity.
Would need to be combined with option 1, 2, or 3.

> TODO(opus/devcontainer-git-identity): Evaluate whether a `lace-git-identity` devcontainer feature that reads the host's git config at container start time would be a cleaner solution than a raw file mount.

## Assessment

This is not a lace bug.
It is a structural gap that arises from lace's terminal-native, SSH-based access model, which deliberately does not replicate VS Code's automatic credential forwarding.

The closest precedent in the codebase is the `claude-config` mount: host-side state that must be available inside the container is handled via lace mount declarations.
Git identity falls into the same category and warrants the same treatment.

Option 1 (mount host `.gitconfig`) is the most aligned with existing lace architecture.
It should be combined with option 4 (SSH agent forwarding) for a complete solution covering both identity and authentication.
