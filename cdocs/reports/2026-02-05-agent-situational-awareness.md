---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T10:05:00-08:00
revisions:
  - by: "@claude-opus-4-6"
    at: 2026-02-05T14:00:00-08:00
    note: >
      Applied review feedback from cdocs/reviews/2026-02-05-review-of-agent-situational-awareness.md.
      Blocking: (1) Split Section 3.2 CLAUDE.md content into "implementable today" vs "requires
      environment markers" tiers. (2) Removed outputSchema fields from MCP tool definitions in
      Section 4.1; documented expected return format in tool descriptions instead. (3) Fixed heredoc
      quoting bug in Section 6.3.3 (changed 'LOCALEOF' to LOCALEOF for variable expansion).
      Non-blocking: Corrected .claude/rules/cdocs.md characterization as plugin reference in Section 2.
      Simplified lace_session_history tool to auto-discover previous environment. Clarified MCP server
      distribution strategy with devcontainer feature as primary, plugin as fallback. Addressed
      /etc/lace/ write permissions in R4 with /home/node/.lace/ alternative. Added host-to-container
      migration scenario in Section 6.2. Clarified readonly mount constraints for plugin sentinel
      files in Section 5.4 and R8. Added "write current state" companion step to Pattern 7.
type: report
state: live
status: revised
tags: [claude-code, agent-awareness, mcp, devcontainer, session-portability]
---

# Agent Situational Awareness in Lace Devcontainers

> **BLUF:** Claude Code agents running inside lace-managed devcontainers lack reliable mechanisms to detect their environment, discover available tooling, or recognize when they have been moved between containers. This report proposes a layered approach: (1) structured CLAUDE.md additions with lace-specific environment sections, (2) a lace MCP server providing runtime introspection tools, (3) a set of environment markers injected by `lace up`, and (4) session portability breadcrumbs written to `.claude/` state. Together these give agents enough signal to auto-orient in any lace container and gracefully handle cross-container migration.

## 1. Executive Summary

AI coding agents are effective only when they understand their environment. In the lace devcontainer ecosystem, agents face three core challenges:

1. **Orientation** -- knowing they are inside a lace-managed devcontainer, what plugins are mounted, and what tools are available.
2. **Continuity** -- recognizing when a session has been copied or moved between containers, and adapting to the new environment.
3. **Discovery** -- finding the right commands, paths, and configuration without being told each time.

This report catalogs what is already in place, identifies gaps, and proposes concrete mechanisms across four layers: CLAUDE.md augmentation, MCP server introspection, environment markers, and session portability protocols. The recommendations are ordered by implementation effort and impact, with the highest-leverage items first.

## 2. Current State

### What exists today

**CLAUDE.md**: The project root CLAUDE.md contains only `@.claude/rules/cdocs.md`. This is not a filesystem path -- the `@` import syntax references a plugin-provided rules file. The `cdocs@clauthier` plugin is enabled in `.claude/settings.json` and injects document-authoring rules via the Claude Code plugin system. However, these cdocs rules concern document management conventions, not environment orientation. This means agents starting in the lace project root currently receive no lace-specific orientation context.

**devcontainer.json**: The container configuration at `.devcontainer/devcontainer.json` defines:
- Build-from-Dockerfile with wezterm-mux-server, sshd, claude-code, neovim, nushell, and git features
- Mount points for bash history (`/commandhistory`), Claude config (`/home/node/.claude`), and SSH public key
- `CLAUDE_CONFIG_DIR=/home/node/.claude` environment variable
- Port 2222 for SSH (with dynamic port assignment via lace port-manager in the 22425-22499 range)
- Workspace mounted at `/workspace` with the main worktree at `/workspace/main`

**Lace CLI**: The `lace up` command orchestrates port assignment, prebuild, mount resolution, and devcontainer startup. It generates an extended devcontainer.json at `.lace/devcontainer.json` that includes resolved plugin mounts and port mappings.

**Plugin system**: The `customizations.lace.plugins` configuration allows projects to declare plugin dependencies that get mounted at `/mnt/lace/plugins/<name>`. The `resolve-mounts` command handles cloning, validation, and mount specification generation.

**Session storage**: Claude Code stores session data at `~/.claude/projects/<encoded-path>/` using JSONL format. Inside the devcontainer, `CLAUDE_CONFIG_DIR` points to `/home/node/.claude`, which is bind-mounted from the host at `~/code/dev_records/weft/claude`. This means session data persists across container rebuilds but is tied to the specific path encoding.

### What is missing

1. **No agent-readable environment manifest** -- agents cannot programmatically discover what container they are in, what mounts are available, or what lace configuration was used.
2. **No CLAUDE.md content** -- the file is effectively empty for agent orientation purposes.
3. **No container identity markers** -- there is no way for an agent to detect that paths, ports, or mounts have changed since the last session.
4. **No MCP server for introspection** -- agents must resort to shell commands to discover their environment.
5. **No session migration protocol** -- when sessions move between containers (e.g., from `/workspace/main` in one container to a local checkout), there are no breadcrumbs to help the agent understand what changed.

## 3. CLAUDE.md Enhancement Proposals

### 3.1 Principle: Constitution, not documentation

Following best practices from Anthropic's own guidance and community research, CLAUDE.md should be short (under 150-200 instructions total), directive rather than descriptive, and point to where truth lives rather than duplicating it. The lace additions should follow this principle.

### 3.2 Proposed CLAUDE.md root content

The content is split into two tiers. Tier A can be added to CLAUDE.md immediately -- it describes permanent project facts that do not depend on any new infrastructure. Tier B should be added to `.claude/rules/lace-environment.md` or `.claude.local.md` only after the environment markers from Section 5 are implemented, since it instructs agents to check files and variables that do not yet exist.

#### Tier A: Implementable today

```markdown
# Lace Project

## Environment

This project is managed by lace, a devcontainer orchestration CLI.

When running inside the devcontainer:
- Workspace root: /workspace (contains all worktrees)
- Your worktree: check `pwd` -- likely /workspace/main or /workspace/<branch>
- Plugins mount at: /mnt/lace/plugins/<name> (readonly unless overridden)
- Persistent Claude state: /home/node/.claude (bind-mounted from host)
- Ephemeral state: everything else in the container filesystem

To list available plugins: `ls /mnt/lace/plugins/ 2>/dev/null`

## Key Paths

- Lace CLI source: packages/lace/
- Devcontainer config: .devcontainer/devcontainer.json
- Generated config: .lace/devcontainer.json (regenerated on `lace up`)
- Plugin declarations: .devcontainer/devcontainer.json under customizations.lace.plugins
- User settings: ~/.config/lace/settings.json (host-side, not in container)

## Commands

- `lace up` -- start/rebuild the devcontainer
- `lace prebuild` -- prebuild features into the Dockerfile
- `lace resolve-mounts` -- resolve plugin mounts
- `pnpm test` -- run all tests
- `pnpm -C packages/lace test` -- run lace CLI tests only

@.claude/rules/cdocs.md
```

#### Tier B: Requires environment markers from Section 5

The following content should be added to `.claude/rules/lace-environment.md` or generated into `.claude.local.md` only after the `LACE_*` environment variables (Section 5.2) and `/etc/lace/environment.json` manifest (Section 5.1) are implemented.

```markdown
## Runtime Environment Detection

To check your full environment: `cat /etc/lace/environment.json` (if present)
To see lace environment variables: `env | grep LACE_`

## Session Context

If you suspect you've been moved to a different container or environment:
1. Check `cat /etc/lace/environment.json` for container identity
2. Compare with `.claude/last-environment.json` (if present) for drift detection
3. Run `env | grep LACE_` to see injected environment variables
```

### 3.3 Worktree-specific context

Each worktree should have its own `.claude/WORKTREE_CONTEXT.md` (already referenced in `overview_and_quickstart.md`). Lace could generate a template for manually-authored worktree context:

```markdown
# Worktree: <branch-name>

Created: <date>
Branch: <branch>
Parent: main

## Purpose
<!-- Describe what this worktree is for -->

## Environment Notes
<!-- Any worktree-specific environment differences -->
```

For auto-generated, per-instance context, `.claude.local.md` is the right mechanism. Since each worktree under `/workspace/<branch>` is a separate git checkout, a committed CLAUDE.md would be shared across worktrees. `.claude.local.md` is gitignored and can be generated per-worktree by `postStartCommand`, making it the appropriate vehicle for worktree-specific runtime context (see Section 6.3.3).

### 3.4 Progressive disclosure via .claude/rules/

Instead of putting everything in CLAUDE.md, create focused rule files:

- `.claude/rules/lace-environment.md` -- environment detection and adaptation
- `.claude/rules/lace-plugins.md` -- how plugins work, where they mount
- `.claude/rules/lace-session-portability.md` -- what to do when detecting a new environment

These are loaded automatically by Claude Code when the rules directory exists.

## 4. MCP Server Opportunities

### 4.1 Proposed: lace-introspection MCP server

An MCP server running inside the devcontainer that provides environment introspection tools. This would be configured in the project's `.mcp.json`.

**Feasibility: Medium** -- requires building a small Node.js MCP server, but the MCP SDK is well-documented and the server would be lightweight.

#### Tool: `lace_environment`

Returns current container environment information as a JSON text content block.

```json
{
  "name": "lace_environment",
  "description": "Get the current lace devcontainer environment state. Returns a JSON object with fields: containerId (string), containerName (string), workspaceRoot (string), currentWorktree (string), sshPort (number), plugins (array of {name, mountPath, readonly, isOverride}), features (array of strings), worktrees (array of strings).",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

> **Note on `outputSchema`:** The 2025-06-18 MCP specification introduces an optional `outputSchema` field for structured content, but SDK support (`@modelcontextprotocol/sdk`) is still evolving. The tool definitions above omit `outputSchema` and instead document expected return structure in the tool description. If the SDK version available in the devcontainer supports `outputSchema` at implementation time, it can be added as an enhancement.

#### Tool: `lace_session_history`

Checks for session lineage and environment drift. The tool automatically locates the previous environment snapshot from `.claude/last-environment.json` relative to the workspace root, so agents do not need to know the path.

```json
{
  "name": "lace_session_history",
  "description": "Check session lineage -- whether this session was moved from another container, what changed, and what might need attention. Automatically checks .claude/last-environment.json in the workspace root for the previous environment snapshot. Returns a JSON object with fields: isMigrated (boolean), changes (array of {field, previous, current}), recommendations (array of strings).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "previousEnvironmentPath": {
        "type": "string",
        "description": "Optional override path to a previous environment.json. If omitted, the tool checks .claude/last-environment.json in the workspace root automatically."
      }
    }
  }
}
```

#### Tool: `lace_worktrees`

Lists available worktrees and their status.

```json
{
  "name": "lace_worktrees",
  "description": "List all available worktrees in the workspace, their branches, and status. Returns a JSON object with fields: worktrees (array of {name, path, branch, isDefault}).",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

### 4.2 Configuration and distribution

The MCP server should be distributed as part of the devcontainer image or as a devcontainer feature (e.g., included in the lace-agent-support feature proposed in R10), rather than as a lace plugin. This avoids a circular dependency: the MCP server helps agents discover plugins, so it should be available regardless of whether the plugin system is functioning. As a fallback, it could also be mounted as a plugin for projects that use older container images.

The `.mcp.json` at the project root would reference the installed location:

```json
{
  "mcpServers": {
    "lace": {
      "command": "node",
      "args": ["/usr/local/lib/lace-mcp/index.js"],
      "env": {
        "LACE_WORKSPACE_ROOT": "/workspace",
        "LACE_ENVIRONMENT_FILE": "/etc/lace/environment.json"
      }
    }
  }
}
```

If distributed as a plugin instead, the args path would be `/mnt/lace/plugins/lace-mcp/dist/index.js`.

### 4.3 Feasibility assessment

| Aspect | Assessment |
|--------|-----------|
| Implementation effort | Medium -- 200-400 lines of TypeScript using `@modelcontextprotocol/sdk` |
| Maintenance burden | Low -- reads environment files, no complex state |
| Value to agents | High -- replaces ad-hoc shell commands with structured data |
| Distribution | Natural -- mount as a lace plugin or include in the devcontainer feature |
| Risk | Low -- read-only introspection, no side effects |

### 4.4 Recommended interim: lightweight shell-based introspection

Before the MCP server is built, the same information can be exposed via a simple shell script at `/usr/local/bin/lace-env` that outputs JSON. Agents can call this via the Bash tool. This is implementable in under an hour, provides immediate value, and can coexist with a future MCP server. Consider this a Tier 1.5 recommendation -- higher effort than CLAUDE.md changes but lower than a full MCP server, and valuable as a bridge.

## 5. Environment Marker Design

### 5.1 Environment manifest: `/etc/lace/environment.json`

Lace should generate this file during container creation (via `postCreateCommand`) and update it on each `postStartCommand`. This gives agents a single, reliable source of truth.

```json
{
  "lace": {
    "version": "0.1.0",
    "generatedAt": "2026-02-05T18:05:00Z"
  },
  "container": {
    "id": "abc123def456",
    "name": "lace-development-worktrees",
    "hostname": "abc123def456",
    "createdAt": "2026-02-05T17:00:00Z"
  },
  "workspace": {
    "root": "/workspace",
    "defaultWorktree": "/workspace/main",
    "projectName": "lace"
  },
  "ports": {
    "ssh": {
      "container": 2222,
      "host": 22425
    }
  },
  "plugins": [
    {
      "name": "dotfiles",
      "mountPath": "/mnt/lace/plugins/dotfiles",
      "readonly": true
    }
  ],
  "features": [
    "ghcr.io/devcontainers/features/git:1",
    "ghcr.io/devcontainers/features/sshd:1",
    "ghcr.io/anthropics/devcontainer-features/claude-code:1",
    "ghcr.io/devcontainers-extra/features/neovim-homebrew:1",
    "ghcr.io/eitsupi/devcontainer-features/nushell:0",
    "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1"
  ],
  "mounts": {
    "persistent": [
      "/commandhistory",
      "/home/node/.claude"
    ],
    "ephemeral_note": "All other paths are ephemeral and lost on container rebuild"
  }
}
```

### 5.2 Environment variables

Lace should inject these via `containerEnv` in the generated devcontainer.json:

| Variable | Purpose | Example |
|----------|---------|---------|
| `LACE_CONTAINER` | Signal that this is a lace-managed container | `1` |
| `LACE_VERSION` | Lace CLI version that created the container | `0.1.0` |
| `LACE_PROJECT` | Project identifier (derived from workspace folder) | `lace` |
| `LACE_WORKSPACE_ROOT` | Workspace mount root | `/workspace` |
| `LACE_WORKTREE` | Default worktree path | `/workspace/main` |
| `LACE_SSH_PORT` | Assigned SSH port on the host | `22425` |
| `LACE_ENVIRONMENT_FILE` | Path to the environment manifest | `/etc/lace/environment.json` |
| `LACE_PLUGINS_DIR` | Plugin mount prefix | `/mnt/lace/plugins` |

These are cheap to implement (just add them to the extended devcontainer.json generation in `up.ts`) and immediately useful for both agents and human developers. **Implementation note:** The `generateExtendedConfig` function in `up.ts` does not currently modify `containerEnv`. A new code block for `containerEnv` merging will need to be added, following the same pattern as the existing `mounts` merging block.

### 5.3 Container identity file: `/etc/lace/container-id`

A simple file containing just the container ID, written once at creation time. Agents can use this as a fast check for container identity changes:

```bash
cat /etc/lace/container-id
# abc123def456
```

### 5.4 Mount sentinel files

For **writable override mounts**, each plugin mount could include a `.lace-plugin-info.json` at its root:

```json
{
  "repoId": "github.com/user/dotfiles",
  "mountedAt": "/mnt/lace/plugins/dotfiles",
  "readonly": false,
  "isOverride": true,
  "resolvedFrom": "local-override"
}
```

This helps agents understand the provenance and constraints of each plugin without needing to consult the central manifest.

**Constraint: readonly mounts.** Plugins are mounted readonly by default, which means sentinel files cannot be written into these mount points. For readonly plugins, metadata should be included in the central `/etc/lace/environment.json` manifest (Section 5.1) or in a separate file at `/home/node/.lace/plugins/<name>.json`. The per-mount sentinel approach only works for writable override mounts.

## 6. Session Portability Challenges

### 6.1 What breaks when sessions move

When a Claude Code session is copied or moved between containers (or between a container and a host), several things break:

| What breaks | Why | Severity |
|-------------|-----|----------|
| **Session path encoding** | `~/.claude/projects/` directories encode the absolute cwd path. `/workspace/main` encodes differently than `/home/user/code/lace` | High -- sessions become invisible |
| **MCP server connections** | MCP servers configured for one environment may not exist in another | Medium -- tools become unavailable |
| **Plugin mount paths** | `/mnt/lace/plugins/*` does not exist outside the container | Medium -- file references break |
| **Tool availability** | Container has different tools installed than host (nushell, wezterm-mux-server, etc.) | Low-Medium -- commands fail |
| **Port mappings** | SSH port 22425 on host is meaningless inside the container | Low -- rarely referenced directly |
| **User identity** | Container user is `node`, host user varies | Low -- affects path assumptions |
| **Git state** | Worktree vs. clone vs. bare repo structure differs | Medium -- git commands may behave differently |

### 6.2 Session migration scenarios

**Scenario A: Container-to-host** -- Developer copies `.claude/` state from the bind-mounted `/home/node/.claude` to a local checkout. The session was created at `/workspace/main` but now the working directory is `/home/user/code/weft/lace`. The session path encoding no longer matches.

**Scenario B: Host-to-container** -- A developer starts a Claude Code session on the host (e.g., at `~/code/weft/lace`), then later wants to continue inside the devcontainer (at `/workspace/main`). This is the reverse of Scenario A and is arguably the most common migration direction for new lace users. The same path encoding mismatch applies: sessions created under the host path are invisible from the container path.

**Scenario C: Container rebuild** -- `lace up --rebuild` creates a new container. The `.claude/` state persists (bind-mounted) but the container ID changes, installed tools may change (feature version bumps), and port assignments may shift.

**Scenario D: Cross-project** -- A session from one lace project is used as reference in another. Plugin mounts, workspace paths, and available features all differ.

### 6.3 Mitigation strategies

**6.3.1 Session path aliasing**

Claude Code encodes project paths as `-workspace-main` inside the container. If lace writes a mapping file at `~/.claude/path-aliases.json`, a future mechanism could allow sessions to be found by either path:

```json
{
  "/workspace/main": "/home/mjr/code/weft/lace",
  "/workspace/loro_migration": "/home/mjr/code/weft/lace"
}
```

This is speculative -- Claude Code does not currently support path aliases. But it could be proposed as a feature request.

**6.3.2 Environment snapshot at session start**

At the start of each session, write a snapshot to `.claude/last-environment.json` in the project directory. On the next session start, compare the current environment against this snapshot. If differences are detected, inject a notice into the agent's context.

A Claude Code `onSessionStart` hook could do this:

```json
{
  "hooks": {
    "onSessionStart": {
      "command": "sh",
      "args": ["-c", "if [ -f /etc/lace/environment.json ]; then cp /etc/lace/environment.json .claude/last-environment.json 2>/dev/null || true; fi"]
    }
  }
}
```

**6.3.3 CLAUDE.md dynamic sections**

A `postStartCommand` script could regenerate a `.claude.local.md` file with current environment details. Since `.claude.local.md` is loaded by Claude Code but not committed to git, it serves as a per-instance context injection point:

```bash
#!/bin/sh
# Generate .claude.local.md with current environment context
# Note: The heredoc delimiter must be unquoted so that $(hostname),
# ${LACE_SSH_PORT}, and other expansions are evaluated at generation time.
cat > /workspace/main/.claude.local.md << LOCALEOF
## Current Environment (auto-generated)

- Container ID: $(hostname)
- SSH port: ${LACE_SSH_PORT:-unknown}
- Available plugins: $(ls /mnt/lace/plugins/ 2>/dev/null | tr '\n' ', ' || echo 'none')
- Worktrees: $(ls /workspace/ 2>/dev/null | tr '\n' ', ' || echo 'unknown')
LOCALEOF
```

## 7. Auto-Detection Pattern Catalog

These are concrete patterns an agent can use to determine its environment. They range from simple file checks to structured introspection.

### Pattern 1: Lace container detection

**Signal**: `LACE_CONTAINER` environment variable or `/etc/lace/environment.json` existence.

```bash
# Quick check
[ "$LACE_CONTAINER" = "1" ] && echo "In lace container"

# Detailed check
[ -f /etc/lace/environment.json ] && cat /etc/lace/environment.json
```

**Agent instruction (for CLAUDE.md):**
> If `$LACE_CONTAINER` is set, you are inside a lace-managed devcontainer. Read `/etc/lace/environment.json` for full environment details.

### Pattern 2: Container identity change detection

**Signal**: Compare `/etc/lace/container-id` against `.claude/last-container-id`.

```bash
CURRENT_ID=$(cat /etc/lace/container-id 2>/dev/null)
LAST_ID=$(cat .claude/last-container-id 2>/dev/null)
if [ -n "$CURRENT_ID" ] && [ -n "$LAST_ID" ] && [ "$CURRENT_ID" != "$LAST_ID" ]; then
  echo "Container has changed since last session"
fi
```

### Pattern 3: Plugin mount availability

**Signal**: Check for `/mnt/lace/plugins/` directory and its contents.

```bash
if [ -d /mnt/lace/plugins ]; then
  echo "Available plugins:"
  for plugin in /mnt/lace/plugins/*/; do
    name=$(basename "$plugin")
    if [ -f "$plugin/.lace-plugin-info.json" ]; then
      echo "  $name ($(cat "$plugin/.lace-plugin-info.json" | grep -o '"readonly":[^,}]*'))"
    else
      echo "  $name"
    fi
  done
fi
```

### Pattern 4: Workspace structure detection

**Signal**: Check for `/workspace` mount and enumerate worktrees.

```bash
if [ -d /workspace ]; then
  echo "Worktrees:"
  for wt in /workspace/*/; do
    name=$(basename "$wt")
    branch=$(git -C "$wt" branch --show-current 2>/dev/null || echo "unknown")
    echo "  $name ($branch)"
  done
fi
```

### Pattern 5: Path mapping detection

**Signal**: Compare `$PWD` against known patterns to determine host vs. container context.

```bash
case "$PWD" in
  /workspace/*) echo "Inside devcontainer workspace" ;;
  /mnt/lace/*)  echo "Inside a lace plugin mount" ;;
  /home/node/*) echo "Inside devcontainer home" ;;
  *)            echo "Likely on host or non-lace container" ;;
esac
```

### Pattern 6: Feature availability probing

**Signal**: Check for expected commands that lace features install.

```bash
FEATURES=""
command -v wezterm-mux-server >/dev/null 2>&1 && FEATURES="$FEATURES wezterm"
command -v claude >/dev/null 2>&1 && FEATURES="$FEATURES claude-code"
command -v nu >/dev/null 2>&1 && FEATURES="$FEATURES nushell"
command -v nvim >/dev/null 2>&1 && FEATURES="$FEATURES neovim"
command -v sshd >/dev/null 2>&1 && FEATURES="$FEATURES sshd"
echo "Detected features:$FEATURES"
```

### Pattern 7: Session drift detection (composite)

Combines multiple signals for comprehensive drift detection:

```bash
#!/bin/sh
# lace-drift-check: Detect environment changes since last session
DRIFT=0
CHANGES=""

# Check container ID
if [ -f /etc/lace/container-id ] && [ -f .claude/last-container-id ]; then
  if [ "$(cat /etc/lace/container-id)" != "$(cat .claude/last-container-id)" ]; then
    DRIFT=1
    CHANGES="$CHANGES container-rebuilt"
  fi
fi

# Check plugin mounts
if [ -f .claude/last-plugins.txt ]; then
  CURRENT_PLUGINS=$(ls /mnt/lace/plugins/ 2>/dev/null | sort)
  LAST_PLUGINS=$(cat .claude/last-plugins.txt)
  if [ "$CURRENT_PLUGINS" != "$LAST_PLUGINS" ]; then
    DRIFT=1
    CHANGES="$CHANGES plugins-changed"
  fi
fi

# Check path
if [ -f .claude/last-cwd.txt ]; then
  if [ "$PWD" != "$(cat .claude/last-cwd.txt)" ]; then
    DRIFT=1
    CHANGES="$CHANGES path-changed"
  fi
fi

if [ "$DRIFT" -eq 1 ]; then
  echo "DRIFT DETECTED:$CHANGES"
else
  echo "Environment matches last session"
fi

# Write current state for next comparison
cat /etc/lace/container-id > .claude/last-container-id 2>/dev/null || true
ls /mnt/lace/plugins/ 2>/dev/null | sort > .claude/last-plugins.txt
echo "$PWD" > .claude/last-cwd.txt
```

## 8. Recommendations

Prioritized by implementation effort vs. impact:

### Tier 1: Immediate (can implement today, high impact)

**R1. Populate CLAUDE.md** -- Add the content from Section 3.2 to the project root CLAUDE.md. This is the single highest-leverage change: every agent session in this project will receive environment orientation context.

**R2. Inject `LACE_*` environment variables** -- Modify the `generateExtendedConfig` function in `packages/lace/src/lib/up.ts` to inject the environment variables from Section 5.2 into the `containerEnv` of the generated devcontainer.json. This requires approximately 15 lines of code.

**R3. Generate `.claude.local.md` in `postStartCommand`** -- Add a script to the `postStartCommand` (or a `postAttachCommand`) that writes current environment details to `.claude.local.md` in each worktree. Agents will automatically receive this context at session start.

### Tier 2: Short-term (1-2 days, medium-high impact)

**R4. Write environment manifest** -- Extend `lace up` to generate the environment manifest. This requires adding a new phase between config generation and devcontainer startup that writes the manifest data via `postCreateCommand`. **Permissions note:** Writing to `/etc/lace/` requires root permissions. In devcontainers, `postCreateCommand` typically runs as the remoteUser (`node`), which does not have write access to `/etc/`. Options: (a) write to a user-writable location such as `/home/node/.lace/environment.json` instead, (b) use `sudo mkdir -p /etc/lace && sudo tee /etc/lace/environment.json` in `postCreateCommand`, or (c) create `/etc/lace/` in the Dockerfile. Option (a) is simplest and persists via the existing bind mount.

**R5. Add `onSessionStart` hook for drift detection** -- Configure a Claude Code hook in `.claude/settings.json` that runs the drift detection script at session start and writes results to a context file.

**R6. Create `.claude/rules/` directory** -- Add focused rule files for lace environment, plugins, and session portability as described in Section 3.4.

### Tier 3: Medium-term (1 week, medium impact)

**R7. Build lace-introspection MCP server** -- Implement the MCP server described in Section 4.1. This provides the cleanest agent experience but requires the most implementation effort.

**R8. Plugin sentinel files** -- Extend the mount resolution logic to write `.lace-plugin-info.json` into each writable override plugin mount's root directory. For readonly mounts (the default), plugin metadata cannot be written into the mount point; instead, include it in the central environment manifest (Section 5.1) or write per-plugin metadata files to `/home/node/.lace/plugins/<name>.json`.

### Tier 4: Long-term (proposal-worthy, high impact)

**R9. Session path aliasing** -- Propose to the Claude Code team (via GitHub issue) a `~/.claude/path-aliases.json` mechanism that allows sessions created at one path to be discoverable from another path. This would solve the container-to-host portability problem at its root.

**R10. Lace devcontainer feature for agent support** -- Create a devcontainer feature (`ghcr.io/weftwiseink/devcontainer-features/lace-agent-support`) that installs the drift detection scripts, MCP server, and environment manifest generator as a self-contained feature. This makes agent support portable across any project using lace.

## 9. Open Questions

1. **Should the environment manifest be writeable by agents?** The manifest at `/etc/lace/environment.json` is designed as read-only ground truth. But should there be a companion file (e.g., `/home/node/.lace/agent-notes.json`) where agents can write observations about the environment? This would enable multi-session learning about the container. Note: `/tmp/lace/` would not be appropriate here because `/tmp` is wiped on container restart. `/home/node/.lace/` persists via the bind mount.

2. **How should CLAUDE.md handle multi-worktree contexts?** When an agent starts in `/workspace/main`, the CLAUDE.md at the project root applies. But if the agent `cd`s to `/workspace/feature-branch`, should there be a CLAUDE.md there too? Claude Code does support hierarchical CLAUDE.md loading, but the worktree layout means each worktree is a separate git checkout.

3. **Should lace auto-configure `.mcp.json`?** The extended devcontainer.json generation could also write an `.mcp.json` file that configures the lace MCP server. But this creates a gitignored file that may conflict with a committed `.mcp.json`. The right approach may be to document this as a manual setup step.

4. **What is the right granularity for drift detection?** The composite drift check in Pattern 7 checks container ID, plugins, and path. Should it also check feature versions, port assignments, or git branch state? More signals mean more noise. The right balance depends on how agents use the information.

5. **Should session portability be a lace CLI command?** A `lace migrate-session --from /workspace/main --to /home/user/code/lace` command could handle the path re-encoding in `~/.claude/projects/`. This is technically feasible but deeply coupled to Claude Code's internal storage format, which may change without notice.

6. **How does this interact with Claude Code's teleportation feature?** Session teleportation (web-to-local) already handles some cross-environment concerns. Would lace's drift detection conflict with or complement that mechanism?

## References

### Codebase

- `/var/home/mjr/code/weft/lace/CLAUDE.md` -- Current (minimal) CLAUDE.md
- `/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json` -- Container configuration
- `/var/home/mjr/code/weft/lace/packages/lace/src/lib/up.ts` -- Extended config generation
- `/var/home/mjr/code/weft/lace/packages/lace/src/lib/mounts.ts` -- Plugin mount resolution
- `/var/home/mjr/code/weft/lace/packages/lace/src/lib/port-manager.ts` -- Port assignment
- `/var/home/mjr/code/weft/lace/packages/lace/src/lib/settings.ts` -- User settings discovery
- `/var/home/mjr/code/weft/lace/cdocs/proposals/2026-02-04-lace-plugins-system.md` -- Plugin system proposal

### External

- [Claude Code settings documentation](https://code.claude.com/docs/en/settings)
- [Writing a good CLAUDE.md -- HumanLayer](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [MCP Devcontainers -- crunchloop](https://github.com/crunchloop/mcp-devcontainers)
- [Session Teleportation in Claude Code](https://habr.com/en/articles/986590/)
- [Claude Code session migration](https://www.vincentschmalbach.com/migrate-claude-code-sessions-to-a-new-computer/)
- [MCP Tool specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Claude Code continue after directory move](https://gist.github.com/gwpl/e0b78a711b4a6b2fc4b594c9b9fa2c4c)
- [Claude Code local storage design](https://milvus.io/blog/why-claude-code-feels-so-stable-a-developers-deep-dive-into-its-local-storage-design.md)
