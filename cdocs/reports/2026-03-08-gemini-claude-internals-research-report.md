---
first_authored:
  by: "@gemini"
  at: 2026-03-08T00:00:00-08:00
task_list: sprack/claude-internals-research
type: report
state: live
status: wip
tags: [claude_internals, architecture, tooling_evaluation]
---

# Architectural Forensic Analysis of Claude Code: Real-Time State Derivation from Internal Local State and Session Files

The internal telemetry and state persistence layer of Claude Code represents a sophisticated implementation of the "overlay context" paradigm in agentic artificial intelligence.
Unlike traditional CLI tools that operate in a stateless manner, Claude Code maintains an exhaustive, high-fidelity record of its internal reasoning, tool invocations, and user interactions within the local filesystem, primarily centered around the `~/.claude` directory.
For engineers and researchers, this local data repository serves as a deterministic source for deriving the active state of an agent.
By performing forensic analysis on these files, it is possible to programmatically determine whether an agent is currently engaged in extended thinking, whether it is stalled awaiting user clarification, and the specific count of tasks completed within a multi-turn session.

## Global Directory Anatomy and Configuration Scopes

The `~/.claude` directory functions as the central nervous system for the Claude Code application, housing both the global configuration and the project-specific transcripts.
Understanding the hierarchical resolution of these files is a prerequisite for any state derivation engine.
The application utilizes a layered configuration model where more specific scopes override global defaults.

### File Hierarchy and Functional Roles

The system distributes data across several key files, each serving a distinct role in the agent's lifecycle.
The following table provides a technical specification of the core files found in the global and local scopes.

| File Path | Scope | Functional Description |
| :---- | :---- | :---- |
| `~/.claude.json` | Global | System-managed state including OAuth tokens, project trust registries, and personal MCP server configurations. |
| `~/.claude/settings.json` | Global | User-managed policy definitions, security rules, allowed/denied tool lists, and default model selections. |
| `~/.claude/history.jsonl` | Global | A comprehensive, chronological log of every user prompt entered across all active projects. |
| `~/.claude/stats-cache.json` | Global | Aggregated usage telemetry including daily activity, tool call frequencies, and model-specific token consumption. |
| `~/.claude/projects/` | Variable | A repository of encoded directories containing individual session transcripts in JSONL format. |
| `~/.claude/keybindings.json` | Global | Mapping of custom keyboard shortcuts for the REPL environment. |
| `.claude/settings.json` | Project | Team-shared configuration committed to version control, defining project-specific security and tool rules. |

### The Role of ~/.claude.json in State Tracking

The `~/.claude.json` file is a high-frequency write target that tracks the "ephemeral" state of the application across multiple projects.
It differentiates itself from `settings.json` by storing what *has happened* (runtime state, caches) rather than what *should happen* (policies).
A critical field for state derivation is the `projects` object, which maps absolute project paths to their most recent session identifiers.

```json
{
  "version": 1,
  "numStartups": 156,
  "projects": {
    "/Users/dev/engine/cli": {
      "lastSessionId": "31f3f224-f440-41ac-9244-b27ff054116d",
      "lastCost": 0.42,
      "allowedTools": [],
      "projectOnboardingSeenCount": 2
    }
  },
  "mcpServers": {
    "local-db": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "app.db"]
    }
  }
}
```

On Windows systems, forensic tools must account for drive letter casing issues where `C:/` and `c:/` may be treated as distinct keys, leading to duplicate project entries and fragmented settings.

## Session Transcript Engineering: The .jsonl Specification

The definitive record of an agent's active state resides within the session transcript files.
These files are stored as JSON Lines (JSONL), where each line represents a discrete event in the conversation history.

### Encoded Directory Resolution

Claude Code isolates sessions by project using an "encoded-cwd" naming convention.
To locate the transcripts for a given project, one must transform the absolute path of the project directory by replacing all non-alphanumeric characters with hyphens.

**Resolution Logic:**

- **Target CWD:** `/Users/researcher/code/agent-v3`
- **Encoded Name:** `-Users-researcher-code-agent-v3`
- **Sub-directory:** `~/.claude/projects/-Users-researcher-code-agent-v3/`
- **Session File:** `31f3f224-f440-41ac-9244-b27ff054116d.jsonl`

### Message Type Anatomy

Deriving state requires a granular understanding of the `type` field within each JSONL entry.
The system uses a specialized taxonomy to distinguish between user input, assistant reasoning, and system events.

| Message Type | Origin | Key Fields and Indicators |
| :---- | :---- | :---- |
| `user` | Human / Tool | Contains `content` (string or array of tool results) and `timestamp`. |
| `assistant` | Agent | Contains `message.content` (array) which may include `text`, `thinking`, or `tool_use`. |
| `thinking` | Model | Internal reasoning block; critical for detecting "extended thinking" states. |
| `system` | Client | Metadata regarding hook execution, context compaction, or environment changes. |
| `tool_use` | Agent | Initiates a request to execute a specific capability (e.g., Bash, Edit). |
| `tool_result` | Runtime | Returns the output of a tool back to the assistant; links to `tool_use.id`. |

## Logic for Real-Time State Derivation

By tailing the active session's `.jsonl` file, external monitoring systems can implement a finite state machine (FSM) to represent the agent's current status.
The primary states of interest include "Thinking," "Asking," "Executing," and "Idle".

### Detecting the "Thinking" State

The agent enters a "thinking" state when the last message in the transcript is an assistant message containing a `thinking` block that has not yet been followed by a text output or a `tool_use` request.

```json
{
  "type": "assistant",
  "uuid": "709290a1-7998-4237-a277-f30736678903",
  "message": {
    "role": "assistant",
    "content": []
  },
  "timestamp": "2026-03-28T12:05:00.000Z"
}
```

Modern versions of the agent support adaptive reasoning, where the thinking budget is adjusted based on effort levels.
If the `content` array contains a `thinking` object but no subsequent `text` or `tool_use`, the agent is actively processing.

### Detecting the "Asking" State (Awaiting User Input)

Claude Code utilizes the `AskUserQuestion` tool to bridge ambiguities.
When an agent requests user input, a `tool_use` event is recorded.
The agent is considered "Asking" (or blocked on input) if the latest `tool_use` for `AskUserQuestion` does not have a corresponding `tool_result` in the subsequent entries.

**Detection Signature:**

```json
{
  "type": "assistant",
  "toolUseMessages": []
}
```

If the last entry in the file matches this pattern, the monitor can flag the agent as "Awaiting Input" and potentially surface the question string to a management interface.

### Quantifying Task Completion

Tracking how many tasks an agent has completed can be approached through two distinct mechanisms: the `stats-cache.json` for historical data and the `Task` tool for current session progression.

#### Historical Completion Metrics

The `stats-cache.json` provides a daily aggregation of `toolCallCount` and `messageCount`.
While it does not explicitly define a "task," the volume of `toolCallCount` per session is often used as a proxy for the complexity of completed work.

| Metric | Origin | Implications |
| :---- | :---- | :---- |
| `toolCallCount` | `stats-cache.json` | Total number of discrete actions performed by the agent. |
| `sessionCount` | `stats-cache.json` | Number of independent context windows initiated. |
| `messageCount` | `stats-cache.json` | Frequency of user/assistant exchanges. |

#### Active Session Task Tracking

In-session task tracking is performed via the `Task` tool, which manages a structured task list.
Monitoring the inputs to this tool allows for the extraction of specific task descriptions and their status (implied by the progression of tool calls).

```json
{
  "type": "tool_use",
  "name": "Task",
  "input": {
    "operation": "update",
    "tasks": [
      {"id": "1", "description": "Fix auth bug", "status": "completed"},
      {"id": "2", "description": "Update docs", "status": "in_progress"}
    ]
  }
}
```

## Implementation Patterns for State Monitoring

Deriving state in a non-intrusive manner requires efficient filesystem watching and incremental parsing.
Standard techniques involve using the `fs.watch` API or more robust libraries like Chokidar to detect changes in the `~/.claude/projects` directory.

### Incremental JSONL Tailoring

Reading a 200MB JSONL file on every update is computationally prohibitive.
Professional monitoring tools use byte-offset tracking to perform incremental reads.

```javascript
import { open, stat } from 'node:fs/promises';

/**
 * Reads only the new lines from a session transcript.
 * @param {string} filepath - Path to the .jsonl file.
 * @param {number} lastPosition - The byte offset of the last read.
 */
async function tailJSONL(filepath, lastPosition = 0) {
    const handle = await open(filepath, 'r');
    const { size } = await stat(filepath);

    if (size <= lastPosition) {
        await handle.close();
        return { entries: [], newPosition: lastPosition };
    }

    const length = size - lastPosition;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, lastPosition);
    await handle.close();

    const content = buffer.toString('utf8');
    const lines = content.split('\n');
    const entries = [];

    for (const line of lines) {
        if (line.trim()) {
            try {
                entries.push(JSON.parse(line));
            } catch (e) {
                // Handle partial lines or malformed JSON
            }
        }
    }

    return { entries, newPosition: size };
}
```

### Concurrent Session Locking

Claude Code manages parallel sessions through lock files.
A session is definitively "active" if it possesses a corresponding `.lock` file in the project directory.
These lock files typically contain the Process ID (PID) of the agent.

```json
{
  "pid": 4512,
  "startedAt": "2026-03-28T08:00:00.000Z",
  "sessionId": "31f3f224-f440-41ac-9244-b27ff054116d",
  "cwd": "/Users/me/code/project"
}
```

Orchestration layers check for the existence of these locks and verify the PID against the system's process table to identify active sessions and clean up stale ones after a crash.

## Review of External Tooling and Open Source Projects

Several community-driven projects have emerged to simplify the extraction of telemetry and state from the Claude Code ecosystem.
These tools provide pre-built logic for parsing the complex internal schemas.

### Project Analysis: agentnotch (AppGram)

agentnotch is a macOS menu bar utility designed to surface real-time telemetry from Claude Code and OpenAI Codex.
It implements a sophisticated mapping of JSONL events to visual indicators in the Mac's notch.

| Visual Indicator | JSONL Condition | Telemetry Source |
| :---- | :---- | :---- |
| **Thinking** | `content.type == "thinking"` | Active Session JSONL. |
| **Tool Running** | `tool_use` without `tool_result` | Active Session JSONL. |
| **Permission Needed** | Tool runtime > 2.5 seconds | Timestamp delta analysis. |
| **Session Done** | `stop_reason == "end_turn"` | Active Session JSONL. |
| **Token Progress** | `total_token_usage` vs Limit | Event metadata. |

The tool utilizes `DispatchSource` on macOS to monitor filesystem events with low overhead, ensuring real-time responsiveness even in long-running sessions.

### Project Analysis: cclog / ccrecall (spences10)

The cclog (and its successor ccrecall) ecosystem focuses on the ingestion of transcripts into a queryable SQLite database.
This allows for complex retrospective analysis of agent behavior.

**SQLite Schema for Historical State:**

- **sessions:** Tracks `id`, `project_path`, `git_branch`, and `summary`.
- **messages:** Stores `uuid`, `type`, `thinking`, and token usage (`input`, `output`, `cache_read`).
- **tool_calls:** Captures `tool_name` and `tool_input`.
- **sync_state:** Manages incremental imports by tracking `file_path` and `last_byte_offset`.

This project is particularly useful for generating dashboards that visualize the "Longest session data" or "Hourly activity patterns" found in the `stats-cache.json`.

### Project Analysis: claude-code-ui (KyleAMathews)

This project provides a Kanban-style interface for tracking sessions across repositories.
It relies on Durable Streams to provide live updates of agent activity.
It specifically targets the encoded directory logic of Claude Code to automatically discover new projects as they are initialized in the `~/.claude/projects` folder.

## Anatomy of Internal Tools: The Reverse-Engineered Registry

State derivation is often context-dependent on the tools the agent is capable of calling.
Reverse engineering efforts have identified at least 28 internal tools across various Claude clients, with the Desktop and CLI versions having access to a subset focused on filesystem and MCP integrations.

### Core Capability Tools

The presence of specific tool calls in the JSONL reveals the agent's current "activity mode."

| Tool Name | Operational Intent | State Significance |
| :---- | :---- | :---- |
| `Read` | File Exploration | Indicates an information-gathering state. |
| `Edit` | Code Modification | Indicates an active implementation state. |
| `Bash` | System Execution | Indicates environmental interaction; high monitoring priority. |
| `Task` | Planning | Indicates a context-management or delegation phase. |
| `AskUserQuestion` | Interaction | Indicates a blocked state awaiting external input. |
| `ExitPlanMode` | Transition | Indicates the conclusion of a planning phase and entry into execution. |

### Subagents and Parallel Conversations

Claude Code frequently delegates complex tasks to subagents.
This architectural choice results in a "parent" session spawning "child" sessions with their own isolated JSONL files.

**Subagent State Indicators:**

- **Trigger:** A `tool_use` call to the `Task` tool with a prompt for a subagent.
- **Detection:** The creation of a new `.jsonl` file in the project directory with a matching UUID.
- **Resolution:** The subagent completes its task and returns a `tool_result` to the parent session.

Research indicates that in power-user environments, subagent sessions can outnumber main sessions by a factor of nearly 10:1 (567 subagent sessions vs. 59 main sessions in one tracked corpus).

## Token Economics and Performance Telemetry

Modern agent state derivation includes the tracking of token consumption to manage operational costs and context window limits.
Claude Code provides rich metadata in each turn regarding its "cache efficiency".

### Token Usage Taxonomy

API responses embedded in the JSONL metadata provide a breakdown of token costs per turn.

| Token Type | Purpose | Economic Impact |
| :---- | :---- | :---- |
| `input_tokens` | Total tokens sent in the prompt. | Base cost for the turn. |
| `cache_read_tokens` | Tokens retrieved from the prompt cache. | Significantly reduced cost; indicates high context reuse. |
| `cache_write_tokens` | Tokens added to the cache for future turns. | One-time cost to stabilize context for subsequent calls. |
| `output_tokens` | Tokens generated by the model. | High cost; correlates with thinking length and code output. |

### Context Compaction State

When a session approaches the model's context limit, the client triggers a "compact" event.
This is visible in the JSONL as a `system` message with a `CompactBoundary` type.
Detecting this state is crucial, as the agent's reasoning may change after history has been summarized.

## Forensic Recovery and Session Resumption

Deriving state is not only useful for real-time monitoring but also for forensic recovery after system failure.
Issues have been documented where the `cd` (change directory) command within a session can cause the agent to stop persisting messages to the JSONL, leading to data loss.

### Manual State Correction

If a session transcript becomes corrupted or loses its "parent UUID chain," forensic tools can restore functionality by truncating the JSONL to the last valid turn.

```bash
# 1. Backup the corrupted transcript
cp ~/.claude/projects/<project>/<session>.jsonl ~/backup.jsonl

# 2. Inspect with Python to find the last intact parentUuid chain
python3 -c "import json; [print(json.loads(line)['uuid']) for line in open('backup.jsonl')]"

# 3. Truncate to the last good line
head -n 42 ~/backup.jsonl > ~/.claude/projects/<project>/<session>.jsonl

# 4. Resume the session via CLI
claude --resume <session-id>
```

This process demonstrates that the session ID is the "critical link" between the UI/CLI and the raw history file.
If the `cliSessionId` in the metadata matches a valid `.jsonl` filename, the full agent state can be reconstructed.

## Managing Internal Storage Bloat

As agents are used extensively, the internal state files can grow to sizes that impede performance.
Forensic analysis of long-running environments reveals that `history.jsonl` and session files can accumulate gigabytes of data with no automatic cleanup mechanism.

### Storage Bloat Statistics

| Storage Component | Observed Size | Management Risk |
| :---- | :---- | :---- |
| `history.jsonl` | 10 MB (37K entries) | Global file; contains every prompt from every project. |
| Session JSONLs | 200+ MB (per session) | Single files for large projects; slow to parse. |
| `file-history/` | 232 MB | File snapshots with no deduplication; creates copies on every edit. |
| `debug/` | 303 MB | Logs that are never automatically purged. |

System administrators and power users can programmatically derive the "health" of an installation by monitoring these file sizes and using commands like `claude history clear` or `/compact` to manage context and disk usage.

## Conclusions and Technical Outlook

The ability to derive active agent state from the `~/.claude` directory provides a robust foundation for building advanced orchestration and monitoring tools.
By leveraging the encoded-CWD algorithm to locate transcripts and implementing incremental JSONL parsing, it is possible to achieve real-time visibility into an agent's reasoning process and interaction status.

### Key Technical Summary

1. **State Source of Truth:** The `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` file is the definitive record for real-time telemetry.
2. **Activity Detection:** The "Thinking" state is identified by unclosed `thinking` blocks, and the "Asking" state is identified by `AskUserQuestion` tool calls lacking a corresponding `tool_result`.
3. **Task Telemetry:** Both the `stats-cache.json` and the `Task` tool provide quantitative data on agent productivity.
4. **Active Process Identification:** Lock files containing PIDs serve as the mechanism for identifying currently running sessions across parallel environments.
5. **Forensic Resilience:** The local-first storage model allows for manual session recovery and retrospective behavior analysis through projects like ccrecall.

Future iterations of agent state monitoring will likely move toward more structured database formats, such as SQLite, to handle the performance bottlenecks associated with massive JSONL files.
Until then, the filesystem-based approach remains the primary gateway for auditing and orchestrating Claude Code agents.

#### Works cited

1. Explore the .claude directory - Claude Code Docs, accessed March 28, 2026, <https://code.claude.com/docs/en/claude-directory>
2. Claude Code Data Structures - GitHub Gist, accessed March 28, 2026, <https://gist.github.com/samkeen/dc6a9771a78d1ecee7eb9ec1307f1b52>
3. agentnotch/CLAUDE.md at main - GitHub, accessed March 28, 2026, <https://github.com/AppGram/agentnotch/blob/main/CLAUDE.md>
4. claude-code-ui/spec.md at main - GitHub, accessed March 28, 2026, <https://github.com/KyleAMathews/claude-code-ui/blob/main/spec.md>
5. Claude Code settings - Claude Code Docs, accessed March 28, 2026, <https://code.claude.com/docs/en/settings>
6. History accumulation in .claude.json causes performance issues and storage bloat #5024, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/5024>
7. How to Build a Dashboard from Your Claude Code Usage Data | Kevin J. Magnan, accessed March 28, 2026, <https://kevinjmagnan.com/2026/01/21/83-days-with-claude-code.html>
8. Work with sessions - Claude API Docs - Claude Console, accessed March 28, 2026, <https://platform.claude.com/docs/en/agent-sdk/sessions>
9. Separate configuration from conversation history in ~/.claude.json · Issue #9794 - GitHub, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/9794>
10. [BUG] Windows: Duplicate project entries created with different drive letter capitalization (d:/ vs D:/), causing MCP servers to not load · Issue #18122 · anthropics/claude-code - GitHub, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/18122>
11. Yup. 4.6 Eats a Lot of Tokens (A deepish dive) : r/ClaudeCode - Reddit, accessed March 28, 2026, <https://www.reddit.com/r/ClaudeCode/comments/1r4kbeo/yup_46_eats_a_lot_of_tokens_a_deepish_dive/>
12. wzcc - command-line utility in Rust // Lib.rs, accessed March 28, 2026, <https://lib.rs/crates/wzcc>
13. Context Editing & Memory for Long-Running Agents - Claude Console, accessed March 28, 2026, <https://platform.claude.com/cookbook/tool-use-memory-cookbook>
14. ClaudeCode - 0.32.2 - Log in, accessed March 28, 2026, <https://hexdocs.pm/claude_code/ClaudeCode.epub>
15. Common workflows - Claude Code Docs, accessed March 28, 2026, <https://code.claude.com/docs/en/common-workflows>
16. [DOCS] Missing Documentation for AskUserQuestion Tool · Issue #10346 · anthropics/claude-code - GitHub, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/10346>
17. Internal claude code tools implementaion - GitHub Gist, accessed March 28, 2026, <https://gist.github.com/bgauryy/0cdb9aa337d01ae5bd0c803943aa36bd>
18. [FEATURE] Add session lock file · Issue #19364 · anthropics/claude-code - GitHub, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/19364>
19. How to centrally list and resume Claude Code sessions across multiple machines - Reddit, accessed March 28, 2026, <https://www.reddit.com/r/ClaudeAI/comments/1qzxsem/how_to_centrally_list_and_resume_claude_code/>
20. Use SQLite to query your session history : r/ClaudeCode - Reddit, accessed March 28, 2026, <https://www.reddit.com/r/ClaudeCode/comments/1qd2bk7/use_sqlite_to_query_your_session_history/>
21. spences10/cclog: Sync Claude Code transcripts to ... - GitHub, accessed March 28, 2026, <https://github.com/spences10/cclog>
22. I reverse-engineered 28 internal tools in Claude and created a complete guide. Here's what most users are missing. : r/ClaudeAI - Reddit, accessed March 28, 2026, <https://www.reddit.com/r/ClaudeAI/comments/1r76th0/i_reverseengineered_28_internal_tools_in_claude/>
23. Claude Code Internals: Reverse Engineering Prompt Augmentation Mechanisms - Agiflow, accessed March 28, 2026, <https://agiflow.io/blog/claude-code-internals-reverse-engineering-prompt-augmentation/>
24. The Missing Memory Hierarchy: Demand Paging for LLM Context Windows - arXiv, accessed March 28, 2026, <https://arxiv.org/html/2603.09023v1>
25. The Ultimate Claude Code Cheat Sheet: Your Complete Command Reference - Medium, accessed March 28, 2026, <https://medium.com/@tonimaxx/the-ultimate-claude-code-cheat-sheet-your-complete-command-reference-f9796013ea50>
26. [BUG] Assistant responses silently stop persisting to session JSONL after cd, breaking --resume · Issue #22566 · anthropics/claude-code - GitHub, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/22566>
27. Claude Desktop update loses Code session history (migration from local-agent-mode-sessions to claude-code-sessions) #29373 - GitHub, accessed March 28, 2026, <https://github.com/anthropics/claude-code/issues/29373>
