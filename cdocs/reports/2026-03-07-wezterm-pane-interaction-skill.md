---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-07T12:00:00-06:00
task_list: lace/agent-terminal-interaction
type: report
state: archived
status: done
tags: [analysis, wezterm, mcp, security, agent-tools, pane-interaction, lace]
---

# WezTerm Pane Interaction Skill for Lace-Constrained Agents

> **BLUF:** WezTerm's CLI (`wezterm cli`) provides comprehensive pane interaction capabilities -- listing panes, reading output, sending text, managing tabs -- that could be wrapped as either a Claude Code skill or an MCP server to give agents terminal awareness. The critical security challenge is that `wezterm cli` operates on global pane IDs with no built-in access control, meaning a naive implementation would let a container-constrained agent read or send keys to any pane on the host. Lace's existing metadata (Docker labels, tab titles, pane CWD, TTY names) provides sufficient signal to build a filtering layer that restricts agents to panes belonging to their container. The recommended approach is an MCP server running on the host that validates pane ownership before executing commands, using the `tab_title` (set by `wez-into`) and `cwd`/`title` fields as the primary containment boundary.

## Context / Background

Lace constrains Claude Code agents to devcontainers accessed via SSH through WezTerm. The `wez-into` script establishes connections by spawning WezTerm tabs with SSH sessions into containers, and sets `tab_title` to the project name (e.g., "lace"). Currently, agents inside containers have no mechanism to observe or interact with terminal panes -- they cannot read the output of a running build in an adjacent pane, reference "that error I just saw," or coordinate terminal sessions.

This report investigates how WezTerm's CLI could be exposed to agents as a skill or MCP server, with particular attention to the security boundary: a lace-constrained agent must not be able to see or manipulate panes outside its container.

### Related Work

The `cdocs/reports/2026-02-05-agent-situational-awareness.md` report proposed a `lace-introspection` MCP server for environment detection inside the container. This report extends that thinking to the host side, where WezTerm runs and pane interaction must be mediated.

## Key Findings

### 1. WezTerm CLI Capabilities

The `wezterm cli` tool provides a complete set of pane interaction primitives. All commands run against the WezTerm mux server (GUI instance or background mux) via a Unix socket.

| Command | Purpose | Security Relevance |
|---------|---------|-------------------|
| `list --format json` | List all panes with metadata | Exposes all panes globally |
| `get-text --pane-id N` | Read pane output (with scrollback) | Can read any pane |
| `send-text --pane-id N` | Send keystrokes to a pane | Can type into any pane |
| `split-pane --pane-id N` | Split a pane | Creates panes in any tab |
| `spawn` | Create new tab/window | Can target any window |
| `kill-pane --pane-id N` | Destroy a pane | Can kill any pane |
| `activate-pane --pane-id N` | Focus a pane | Can switch focus globally |
| `set-tab-title` | Set tab name | Can rename any tab |
| `get-text --start-line -N` | Read scrollback history | Arbitrary scrollback depth |

**Key observation:** Every command accepts `--pane-id` to target any pane. The `WEZTERM_PANE` environment variable provides a default, but there is no authentication, authorization, or scoping mechanism. If an agent can call `wezterm cli`, it can interact with every pane in the WezTerm instance.

### 2. Available Pane Metadata for Boundary Enforcement

The `wezterm cli list --format json` output provides rich metadata per pane. From a live observation of the current host:

```json
{
  "pane_id": 1,
  "tab_id": 1,
  "window_id": 0,
  "workspace": "main",
  "tab_title": "lace",
  "title": "node@f1ca2cfd7131: /workspace/lace/main",
  "cwd": "file:///var/home/mjr",
  "tty_name": "/dev/pts/12",
  "is_active": true
}
```

The following fields are useful for container-to-pane association:

| Field | Signal | Reliability |
|-------|--------|-------------|
| `tab_title` | Set by `wez-into` to the project name (e.g., "lace") | High -- explicitly set, not overridden by OSC escapes |
| `title` | Contains SSH user@hostname (e.g., `node@f1ca2cfd7131`) | Medium -- can be overridden by TUI programs |
| `cwd` | Shows container CWD via WezTerm's OSC 7 tracking | Low -- may show host CWD for non-SSH panes |
| `tty_name` | The PTY device (e.g., `/dev/pts/12`) | Medium -- stable but requires cross-referencing |

**The `tab_title` is the strongest signal.** It is set by `wez-into` via `wezterm cli set-tab-title --pane-id <id> <project>` (line 505 of `bin/wez-into`) and is immune to OSC title changes from programs running inside the pane. The `format-tab-title` event handler in the WezTerm config preferentially renders `tab_title` over `pane_title`.

### 3. Container Identity Chain

Lace establishes a clear identity chain from Docker to WezTerm:

```
Docker container
  |- label: lace.project_name = "lace"
  |- label: devcontainer.local_folder = "/var/home/mjr/code/weft/lace/main"
  |- port mapping: 22426 -> 2222/tcp
  '- container_id: f1ca2cfd7131

lace-discover output:
  lace:22426:node:/var/home/mjr/code/weft/lace/main

wez-into sets:
  tab_title = "lace" (matches lace.project_name)
  SSH connection = node@localhost:22426

WezTerm pane metadata:
  tab_title = "lace"
  title = "node@f1ca2cfd7131: /workspace/lace/main"
```

The `LACE_PROJECT_NAME` environment variable is injected into the container by `generateExtendedConfig` in `up.ts` (line 751). The same name is set as a Docker label (`lace.project_name`) and used as the WezTerm tab title. This gives a consistent identifier across all three layers.

### 4. Security Threat Model

An agent inside a lace container could attempt to:

1. **Read other containers' panes** -- see build output, credentials, or chat from another project.
2. **Send keystrokes to other panes** -- execute commands in a non-sandboxed terminal.
3. **Read host panes** -- access the user's non-containerized terminal sessions.
4. **Kill or manipulate other tabs** -- disrupt the user's workflow.
5. **Discover host filesystem paths** -- the `cwd` field of non-container panes reveals host paths.

**The fundamental constraint is that `wezterm cli` runs on the host, not inside the container.** An agent running inside a container cannot directly invoke `wezterm cli` (the WezTerm GUI is on the host). This means the tool must be exposed through a bridge -- either an MCP server on the host, a host-side script callable via SSH reverse tunneling, or a host-side skill definition.

This architecture is actually favorable for security: the bridge layer can enforce access control before passing commands to `wezterm cli`.

### 5. Pane Labeling and UX

WezTerm does not support arbitrary key-value metadata on panes. The available "labeling" mechanisms are:

- **Tab title** (`set-tab-title`): Per-tab string, survives OSC changes. Already used by `wez-into`.
- **Window title** (`set-window-title`): Per-window string, globally visible.
- **Workspace name** (`rename-workspace`): Grouping concept, but all lace containers share workspace "main" in tab mode.
- **Pane title**: Set by the running program via OSC escape sequences. Not controllable from outside the pane.

For the user to reference "that pane" in chat, several approaches are viable:

1. **By project name** -- "read the output from the lace pane" (uses `tab_title`).
2. **By pane position** -- "read the pane to the right" (uses `get-pane-direction`).
3. **By pane ID** -- "read pane 3" (direct, but users rarely know pane IDs).
4. **By content** -- "find the pane showing the test output" (requires scanning all allowed panes).
5. **By role label** -- "read the build pane" (requires a custom labeling convention).

## Analysis

### Architecture Options

#### Option A: MCP Server on the Host

An MCP server running on the host (outside containers) that wraps `wezterm cli` with access control.

```
Agent (in container) --> Claude Code MCP client --> Host MCP server --> wezterm cli
```

**Configuration:** The `.mcp.json` for the project would reference a host-side MCP server. Since agents inside containers communicate via Claude Code's MCP transport (which runs on the host in the Claude Code process), the MCP server naturally runs on the host.

```json
{
  "mcpServers": {
    "wezterm": {
      "command": "node",
      "args": ["/path/to/wezterm-mcp/index.js"],
      "env": {
        "LACE_PROJECT_NAME": "lace"
      }
    }
  }
}
```

**Access control:** The server knows its `LACE_PROJECT_NAME` from the environment. Before executing any `wezterm cli` command, it:
1. Calls `wezterm cli list --format json`.
2. Filters panes to only those whose `tab_title` matches `LACE_PROJECT_NAME`.
3. Rejects any `--pane-id` targeting a pane outside the allowed set.

**Pros:**
- Natural security boundary (host-side code controls access).
- MCP tools appear as structured capabilities in the agent's tool list.
- Can be shared across all lace containers via a common MCP server binary.
- Supports rich return types (structured JSON, not just text).

**Cons:**
- Requires building and distributing an MCP server.
- `.mcp.json` must be configured per-project (or generated by `lace up`).
- The MCP server process runs on the host, consuming resources.

#### Option B: Claude Code Skill (Slash Command)

A Claude Code skill definition in `.claude/skills/` that instructs the agent on how to use `wezterm cli` with safety constraints.

**How it works:** The skill would be a markdown file that tells the agent to use Bash tool calls to invoke `wezterm cli` commands, with instructions on how to filter panes by project name.

**Pros:**
- Zero infrastructure -- just a markdown file.
- Immediately usable without building anything.

**Cons:**
- **Fundamentally insecure.** Skills are instructions, not enforcement. The agent receives the full `wezterm cli` capability via its Bash tool and is merely told to self-restrict. A sufficiently complex or confused agent could bypass the instructions.
- `wezterm cli` runs on the host. An agent inside a container cannot invoke it directly via Bash. The Bash tool runs inside the container's sandbox.
- Does not provide structured tool interfaces.

**Verdict:** Skills alone are insufficient for security-critical operations. A skill could supplement an MCP server (providing UX guidance), but cannot replace the enforcement layer.

#### Option C: Host-Side Proxy Script via SSH

A script on the host that the agent calls via SSH reverse tunnel or `docker exec`.

**Pros:**
- Simple implementation (bash script with filtering).
- No MCP dependency.

**Cons:**
- Requires SSH reverse tunneling or Docker socket access from the container.
- Increases the container's attack surface rather than reducing it.
- No structured tool interface for the agent.

**Verdict:** This approach moves in the wrong direction for security.

### Recommended Architecture: Host-Side MCP Server

The MCP server approach (Option A) is the clear winner. It provides:
1. **Enforcement at the right boundary** -- the host controls what the container can see.
2. **Structured tool interface** -- agents get typed tools, not raw shell access.
3. **Auditability** -- the server can log all pane interactions.
4. **Composability** -- the same server can serve multiple containers simultaneously.

### Proposed MCP Tool Definitions

#### `wezterm_list_panes`

List panes that belong to this agent's container/project.

```json
{
  "name": "wezterm_list_panes",
  "description": "List terminal panes belonging to this project. Returns pane IDs, titles, and positions. Only panes from this project's container are visible.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

The tool internally calls `wezterm cli list --format json`, filters to panes matching the project's `tab_title`, and returns a simplified list.

#### `wezterm_read_pane`

Read visible text from a pane.

```json
{
  "name": "wezterm_read_pane",
  "description": "Read terminal output from a pane in this project. Returns the visible text content. Use start_line (negative for scrollback) and end_line to control the range.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pane_id": {
        "type": "integer",
        "description": "The pane ID to read from (from wezterm_list_panes output)"
      },
      "start_line": {
        "type": "integer",
        "description": "Starting line (0 = top of screen, negative = scrollback). Default: 0"
      },
      "end_line": {
        "type": "integer",
        "description": "Ending line. Default: bottom of screen"
      }
    },
    "required": ["pane_id"]
  }
}
```

Before executing, the server validates that `pane_id` belongs to the project.

#### `wezterm_send_text`

Send text to a pane (with safety constraints).

```json
{
  "name": "wezterm_send_text",
  "description": "Send text to a terminal pane in this project, as if pasted. Only panes belonging to this project are accessible. Use with caution -- this types into a live terminal.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pane_id": {
        "type": "integer",
        "description": "The pane ID to send text to"
      },
      "text": {
        "type": "string",
        "description": "The text to send"
      }
    },
    "required": ["pane_id", "text"]
  }
}
```

**Additional safety consideration:** `send-text` is the most dangerous operation. The MCP server could require user confirmation for this tool, or restrict it to a "read-only" mode by default.

#### `wezterm_split_pane`

Split an existing pane to create a new terminal.

```json
{
  "name": "wezterm_split_pane",
  "description": "Split a pane in this project to create a new terminal. Returns the new pane ID. The new pane inherits the container's SSH session.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pane_id": {
        "type": "integer",
        "description": "The pane to split"
      },
      "direction": {
        "type": "string",
        "enum": ["right", "bottom", "left", "top"],
        "description": "Direction to split. Default: bottom"
      },
      "percent": {
        "type": "integer",
        "description": "Percentage of space for the new pane. Default: 50"
      }
    },
    "required": ["pane_id"]
  }
}
```

### Containment Boundary Implementation

The core security function in the MCP server:

```typescript
interface PaneInfo {
  pane_id: number;
  tab_title: string;
  title: string;
  // ... other fields from wezterm cli list
}

function getAllowedPanes(projectName: string): PaneInfo[] {
  const allPanes = JSON.parse(
    execSync('wezterm cli list --format json').toString()
  );
  return allPanes.filter((pane: PaneInfo) =>
    pane.tab_title === projectName
  );
}

function assertPaneAllowed(paneId: number, projectName: string): void {
  const allowed = getAllowedPanes(projectName);
  if (!allowed.some(p => p.pane_id === paneId)) {
    throw new Error(
      `Pane ${paneId} does not belong to project "${projectName}". ` +
      `Allowed panes: ${allowed.map(p => p.pane_id).join(', ')}`
    );
  }
}
```

**Edge cases to consider:**

1. **Panes within the same tab but not SSH panes:** If a user splits a lace tab to have a local pane alongside an SSH pane, both share the same `tab_title`. The local pane would be accessible to the agent. This is acceptable -- the user explicitly created that pane in the project's tab.

2. **Multiple containers with the same project name:** Two containers both named "lace" would have their panes visible to each other's agents. This is a realistic concern for bare-worktree setups where the same repo might be running in two containers. Mitigation: include `container_id` from the `title` field (e.g., `node@f1ca2cfd7131`) as an additional filter.

3. **Tab title not set:** If `wez-into` was not used (e.g., manual SSH connection), `tab_title` will be empty. The MCP server should refuse to operate when it cannot determine the project boundary.

4. **Pane created by the agent via `split-pane`:** New panes created within an allowed tab inherit the tab's `tab_title`, so they are automatically in scope.

### UX: How Users Reference Panes

For agent chat integration, the most natural interaction patterns are:

**Pattern 1: Implicit current pane.**
User: "What does the test output say?"
Agent: Uses `wezterm_list_panes` to find panes, reads each, identifies the one showing test output.

**Pattern 2: By relative position.**
User: "Read the pane on the right."
Agent: Could use `wezterm cli get-pane-direction --pane-id <current> Right` to find the adjacent pane.

**Pattern 3: By project-scoped label.**
If users could label panes (e.g., "build", "tests", "logs"), the agent could reference them by role. WezTerm does not support custom pane metadata, but a convention could use the pane's `user_vars` (settable via OSC 1337 escape sequences) or a sidecar file mapping pane IDs to labels.

**Pattern 4: Agent discovers by content scanning.**
The agent calls `wezterm_read_pane` on each allowed pane and uses its judgment to find the relevant one. This is the most flexible approach and requires no labeling convention.

**Recommendation:** Start with Pattern 4 (content-based discovery) as it requires no additional infrastructure. Add pane labeling as a UX enhancement later if needed.

### Distribution and Configuration

The MCP server should be distributed as a standalone npm package or included in the lace CLI. Configuration approaches:

**Option 1: Auto-generated `.mcp.json`**

`lace up` already generates `.lace/devcontainer.json`. It could also generate or merge into `.mcp.json`:

```json
{
  "mcpServers": {
    "wezterm-panes": {
      "command": "node",
      "args": ["~/.local/lib/lace-wezterm-mcp/index.js"],
      "env": {
        "LACE_PROJECT_NAME": "lace",
        "LACE_CONTAINER_ID": "f1ca2cfd7131"
      }
    }
  }
}
```

**Option 2: User-configured**

The user adds the MCP server configuration to their project's `.mcp.json` manually. Less automated but avoids lace touching committed files.

**Recommendation:** Option 1 (auto-generated), writing to `.mcp.json` only if it does not already exist or only merging the `wezterm-panes` key. Since `.mcp.json` is typically gitignored for local-only servers, auto-generation is safe.

## Recommendations

### Tier 1: Foundation (1-2 days)

**R1. Build a minimal `lace-wezterm-mcp` server** with three tools: `wezterm_list_panes`, `wezterm_read_pane`, and `wezterm_send_text`. Use the `@modelcontextprotocol/sdk` package. The server runs on the host, receives `LACE_PROJECT_NAME` via environment, and filters all pane operations by `tab_title` match. Estimated size: 200-300 lines of TypeScript.

**R2. Add `LACE_CONTAINER_ID` to the MCP server environment** as a secondary containment signal. The server can cross-reference the `title` field (which contains the SSH hostname, which is the container ID) for defense in depth.

### Tier 2: Integration (1-2 days)

**R3. Auto-generate MCP configuration during `lace up`.** Extend `generateExtendedConfig` in `up.ts` to write a `.mcp.json` entry for the wezterm-panes server, passing the project name and container ID as environment variables.

**R4. Add a companion Claude Code skill** (`.claude/skills/wezterm-panes/SKILL.md`) that teaches agents how to use the MCP tools effectively -- how to interpret pane output, when to use `send-text` vs. the agent's own Bash tool, and conventions for pane layout.

### Tier 3: Enhanced UX (future)

**R5. Pane labeling convention.** Define a mechanism for users or agents to tag panes with role labels (e.g., "build", "editor", "logs"). Investigate WezTerm's `user_vars` (OSC 1337) as a potential storage mechanism for per-pane metadata.

**R6. Configurable safety modes.** The MCP server could support modes like `read-only` (no `send-text`), `read-write` (full access within containment), and `interactive` (requires user confirmation for `send-text`). The mode would be set in `LACE_WEZTERM_MODE` environment variable.

**R7. Cross-pane coordination.** More advanced tools like `wezterm_watch_pane` (poll for output changes) or `wezterm_wait_for_output` (block until a pattern appears) would enable agents to coordinate multi-terminal workflows -- e.g., running tests in one pane and reading results.

### Open Questions

1. **Should `send-text` be enabled by default?** The ability to type into a terminal pane is powerful but dangerous. Even with containment, an agent could accidentally disrupt a running process. A "read-only by default, opt-in to write" policy may be appropriate.

2. **How should the MCP server handle pane ID recycling?** WezTerm pane IDs are sequential and can be reused after a pane is closed. The server should re-validate ownership before every operation, not cache the allowed set.

3. **Should the MCP server run per-project or as a singleton?** A singleton server serving multiple projects would need to accept the project name per-request rather than from its environment. Per-project is simpler and more secure.

4. **How does this interact with Claude Code's own terminal?** Claude Code agents already have a Bash tool that runs inside the container. The WezTerm MCP tools provide a parallel channel for observing and interacting with other terminal sessions. Clear documentation is needed to help agents understand when to use which.

5. **What about non-lace WezTerm users?** The MCP server could work without lace if given a `tab_title` or `pane_id` whitelist. This makes it useful beyond the lace ecosystem.

## References

### Codebase

- `/var/home/mjr/code/weft/lace/main/bin/wez-into` -- WezTerm tab spawning and tab_title management
- `/var/home/mjr/code/weft/lace/main/bin/lace-discover` -- Container discovery via Docker labels
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/up.ts` -- Extended config generation, containerEnv injection
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/project-name.ts` -- Project name derivation
- `/var/home/mjr/code/weft/lace/main/.devcontainer/devcontainer.json` -- Container configuration
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/wezterm-server/devcontainer-feature.json` -- WezTerm server feature declaration
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-02-05-agent-situational-awareness.md` -- Prior art: agent introspection MCP server proposal
- `/var/home/mjr/code/weft/lace/main/cdocs/proposals/2026-02-28-tab-oriented-lace-wezterm.md` -- Tab mode architecture
- `/var/home/mjr/code/weft/lace/main/cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md` -- Workspace-aware wezterm-server feature

### WezTerm CLI Commands Used in Research

```bash
wezterm cli list --format json       # Full pane metadata
wezterm cli get-text --pane-id N     # Read pane content
wezterm cli send-text --pane-id N    # Send text to pane
wezterm cli split-pane --pane-id N   # Split a pane
wezterm cli set-tab-title            # Label a tab
wezterm cli get-pane-direction       # Find adjacent pane
```
