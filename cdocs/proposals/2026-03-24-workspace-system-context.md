---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T12:17:25-07:00
task_list: lace/workspace-system-context
type: proposal
state: live
status: request_for_proposal
tags: [agent_context, mcp, claude_skills, devcontainer]
---

# Workspace System Context

> BLUF(opus/workspace-system-context): Define a standard mechanism for supplying agents with runtime context (mount paths, default shell, container metadata) automatically when operating inside a lace container, so that every agent session starts pre-oriented without manual briefing.
>
> - **Motivated by:** repeated friction where agents lack awareness of `/mnt/...` mounts, user shell, container boundaries, and lace-specific conventions.

## Objective

Agents spawned inside lace containers (Claude Code, subagents, MCP-connected tools) currently have no structured way to discover their runtime environment.
Each session requires manual context injection: "you're in a devcontainer, mounts are at `/mnt/...`", "the user's shell is nushell", etc.

The goal is a single, container-aware context provider that:
- Emits structured workspace metadata when running inside a lace container.
- Is inert or minimal when running outside one (no false signals on bare metal).
- Is consumable by Claude Code (via CLAUDE.md, MCP, or skill), other LLM agents, and potentially non-AI tooling.

## Scope

The full proposal should explore:

- **Delivery mechanism**: MCP server vs. skill vs. auto-injected CLAUDE.md section vs. environment variables vs. a combination.
  - MCP server: queryable at runtime, rich structured data, but requires server lifecycle management.
  - Skill: invoked on demand, but agents must know to call it.
  - CLAUDE.md injection: always present in context, but static and uses context window budget.
  - Environment variables: universal, but flat and limited in expressiveness.
- **Context schema**: what fields belong in the workspace context payload.
  - Container identity (lace container name, devcontainer metadata path, image name).
  - Mount points (`/mnt/host`, workspace folder, dotfiles location).
  - User info (default shell, username, UID/GID, home directory).
  - Network (SSH port, forwarded ports, host connectivity).
  - Lace-specific metadata (feature versions, sidecar services, prebuild status).
  - Project metadata (git remote, branch, repo root).
- **Format**: JSON, YAML, TOML, or a bespoke format. Should be parseable by both agents and shell scripts.
- **Conditioning logic**: how to detect "am I in a lace container?" reliably.
  - Env var presence (e.g., `LACE_CONTAINER=1`).
  - File sentinel (e.g., `/etc/lace/context.json`).
  - devcontainer metadata inspection.
- **Freshness**: static (baked at container build) vs. dynamic (queried at runtime) vs. hybrid.
- **Extensibility**: can users or features append custom context fields?

## Open Questions

- Should this replace or supplement the current CLAUDE.md approach for container orientation?
- How do we handle context for nested agents (subagents spawned by Claude Code) - do they inherit, re-query, or get a subset?
- What is the minimal viable context that eliminates 90% of the "you're in a container" briefing?
- Should the context provider also expose actions (e.g., "reconnect to host", "list other containers") or strictly be read-only metadata?
- How does this interact with the existing `lace-discover` tool and `sprack` daemon?
- Is there a prior art format (e.g., devcontainer metadata spec, Twelve-Factor config) worth adopting directly?

## Known Requirements

- Must work for Claude Code sessions (primary consumer).
- Must work for MCP-connected agents that may not have filesystem access.
- Must be no-op or gracefully degraded outside lace containers.
- Must not leak sensitive information (SSH keys, tokens) into agent context.
- Should be cheap to query: agents may check it at session start and on demand.

## Prior Art

- devcontainer metadata (`/.devcontainer/devcontainer.json`, `devcontainer metadata` CLI).
- `lace-discover`: existing JSON output for container/port discovery.
- `sprack`: daemon providing container lifecycle and IPC.
- Twelve-Factor App config conventions (env-var-based configuration).
- Claude Code CLAUDE.md project instructions (static context injection).
