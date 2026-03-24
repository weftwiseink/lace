---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T14:00:00-07:00
task_list: terminal-management/sprack-process-host-awareness
type: report
state: live
status: review_ready
tags: [sprack, container, architecture, lace, cross_container]
---

# sprack Process Host Awareness: Problem Space Analysis

> BLUF: sprack-claude assumes co-location with Claude Code in the same PID namespace, but the real deployment is tmux on the host observing SSH panes that connect to containers where Claude Code runs.
> The container boundary analysis confirmed `/proc` walking cannot cross namespaces.
> The path forward requires "process host awareness": sprack must detect that a pane's SSH session connects to a lace container and use lace metadata or the shared `~/.claude` bind mount to reach session files without `/proc`.

## 1. The Observed Problem

In the user's TUI screenshot, panes running Claude Code inside lace containers show `current_command: ssh` rather than `current_command: claude`.
This happens because lace-into uses SSH to connect the host tmux pane to the container.
The process tree from the host's perspective:

```
tmux-server (host)
  └── bash (host pane shell)
       └── ssh -p <lace_port> <user>@localhost (host process)
            └── [container boundary]
                 └── bash/nu (container shell)
                      └── claude (container process)
```

tmux reports the host-side `ssh` process as `pane_current_command`, not the container-side `claude`.
sprack-claude's filter (`current_command LIKE '%claude%'`) never matches these panes.

## 2. Available Lace Metadata

lace-into sets three tmux user options at both the session and pane level:

| Option | Example Value | What It Identifies |
|--------|--------------|-------------------|
| `@lace_port` | `22427` | SSH port for the container's sshd |
| `@lace_user` | `node` | User account inside the container |
| `@lace_workspace` | `/workspaces/lace` | Workspace root inside the container |

sprack-poll reads `@lace_port`, `@lace_user`, and `@lace_workspace` per session via `tmux show-options`.
These values are stored in the `sessions` table (`lace_port`, `lace_user`, `lace_workspace` columns).

> NOTE(opus/sprack-process-host-awareness): lace-into also sets pane-level `@lace_port`, `@lace_user`, and `@lace_workspace` via `tmux set-option -p`.
> sprack-poll does not read pane-level options: it reads session-level options and applies them to all panes in that session.
> This is correct for the common case (all panes in a lace session connect to the same container) but would break if a session mixes local and remote panes.

## 3. The `~/.claude` Bind Mount

Lace devcontainers mount the host's `~/.claude` directory:

```
source=/home/<host_user>/.claude -> target=/home/<container_user>/.claude
```

Both host-originated and container-originated session data coexist in the same directory tree, distinguished by their encoded path prefixes:
- Host sessions: `-var-home-mjr-code-weft-lace-main`
- Container sessions: `-workspaces-lace-main`

The bind mount is bidirectional: files written by container-Claude at `/home/node/.claude/projects/-workspaces-lace-main/` are physically stored at `/home/mjr/.claude/projects/-workspaces-lace-main/` on the host.

> WARN(opus/sprack-process-host-awareness): The `fullPath` entries in `sessions-index.json` use container-internal absolute paths (`/home/node/.claude/...`).
> These paths do not resolve on the host because the home directory differs.
> The mtime-based fallback (list `.jsonl` files by modification time) avoids this problem because it constructs paths relative to the project directory.

## 4. Resolution Strategies

### 4A. Derive Session File Path from Lace Metadata (No `/proc`)

Given a pane with `current_command: ssh` and a session with `lace_port`, `lace_user`, and `lace_workspace`:

1. The workspace path inside the container is `@lace_workspace` (e.g., `/workspaces/lace`).
2. Claude Code's working directory is a subdirectory of the workspace.
   For lace, this is typically `@lace_workspace/main` or `@lace_workspace/<worktree>`.
3. Encode the container-internal path: `/workspaces/lace/main` becomes `-workspaces-lace-main`.
4. Construct the project directory: `~/.claude/projects/-workspaces-lace-main/` on the host.
5. The bind mount makes this directory accessible.
6. Use the mtime-based session file discovery (not `sessions-index.json`, due to path mismatch).

**Feasibility:** This works for the common case but has a gap: step 2 requires knowing the specific subdirectory Claude Code is operating in.
`@lace_workspace` gives the workspace root, not the project root.
If there are multiple worktrees or subdirectories, we need additional resolution.

**Possible refinements:**
- Enumerate `~/.claude/projects/` for directories matching the prefix `-workspaces-lace-*`.
- Select the one with the most recently modified `.jsonl` file.
- This is a heuristic but covers the common case.

### 4B. SSH into the Container to Run a Probe

Execute a lightweight command inside the container to get Claude process information:

```bash
ssh -p $lace_port $lace_user@localhost \
  "cat /proc/$(pgrep -n claude)/cwd 2>/dev/null || echo ''"
```

**Feasibility:** Works if sshd is running in the container (it is, by definition, since the pane connected via SSH).
Performance cost: one SSH round-trip per probe (~50-100ms for localhost).
At a 2-second poll interval with a handful of panes, this is acceptable.

**Advantage:** Gets the exact cwd, eliminating the guesswork in 4A step 2.

**Disadvantage:** Requires SSH key access from the sprack-claude process.
lace-into uses `~/.config/lace/ssh/id_ed25519` as the SSH key.
sprack-claude would need access to this key.

### 4C. In-Container Summarizer Agent

Run a separate sprack-claude instance inside each container.
The in-container instance has direct `/proc` access and writes to a container-local or shared DB.

**Feasibility:** Architecturally clean but operationally complex.
Each container needs sprack-claude installed and running.
The DB sharing problem resurfaces (host sprack-poll writes, container sprack-claude writes: separate PID namespaces, separate DB paths).

> WARN(opus/sprack-process-host-awareness): This is the approach the container boundary analysis concluded works, but it assumes all sprack components run inside the container, including tmux.
> The user's actual deployment has tmux on the host, which means sprack-poll must run on the host.

### 4D. Hybrid: Host Poll + Per-Container Summarizer with Shared DB

sprack-poll on the host writes to a DB that is bind-mounted into containers.
Each container runs its own sprack-claude that reads pane info and writes integrations.

**Feasibility:** The PID namespace mismatch from the boundary analysis applies here: host PIDs in the DB do not match container PIDs.
This could be mitigated by using the pane ID (a tmux concept, not a PID) as the correlation key, and having the in-container sprack-claude use `@lace_workspace` instead of `/proc` walking.

## 5. Which Deployment Model is Actual?

The container boundary analysis assumed all sprack components run inside the container because lace starts tmux inside the container.
The user's screenshot contradicts this: it shows tmux running on the host with multiple container sessions.

The actual deployment:
- tmux runs on the **host**
- lace-into creates tmux sessions on the host and SSH-connects panes to containers
- Each container has its own sshd, users, and filesystem
- `~/.claude` is bind-mounted from the host into each container

This means:
- sprack-poll **must** run on the host (it needs the host tmux server)
- sprack TUI **must** run on the host (it renders in a host tmux pane)
- sprack-claude's location is the design question

## 6. Implications for sprack-claude Architecture

The `/proc` walking approach works only when sprack-claude runs in the same PID namespace as Claude Code.
For the host-tmux deployment, this means either:

1. **Abandon `/proc` for container panes** and use lace metadata + bind mount to find session files directly.
2. **Use SSH probes** to query container process state.
3. **Run in-container agents** with a shared communication channel.

Option 1 is the simplest and requires no new infrastructure.
The key insight: we do not need the Claude process PID at all.
We need the session file, and the bind mount already makes it accessible from the host.
The lace metadata tells us enough to derive the path.

## 7. Generalization: Remote Process Summarization

The lace use case is a specific instance of a general problem: summarizing processes that run on a different host (or in a different namespace) from the observer.

A "process host aware" architecture would:
1. Detect whether a pane's process is local or remote (via `@lace_port` or `current_command: ssh`).
2. For local panes: use `/proc` walking (current approach).
3. For remote/container panes: use metadata-driven resolution (lace options, bind mounts, SSH probes).

This decomposition keeps the local path fast and simple while adding a pluggable remote resolution strategy.

## Summary

| Approach | Complexity | Reliability | Performance |
|----------|-----------|-------------|-------------|
| 4A: Metadata + bind mount | Low | Good (heuristic for subdirectory) | Excellent (local filesystem) |
| 4B: SSH probe | Medium | Excellent (exact cwd) | Good (~100ms per pane) |
| 4C: In-container agent | High | Excellent | Excellent (local `/proc`) |
| 4D: Hybrid shared DB | High | Good (PID mismatch workaround) | Good |

Strategy 4A (metadata + bind mount, mtime-based discovery) is the pragmatic starting point.
Strategy 4B (SSH probe) is the fallback for cases where 4A's heuristic fails.
Strategies 4C and 4D are architecturally clean but operationally complex and should be deferred.
