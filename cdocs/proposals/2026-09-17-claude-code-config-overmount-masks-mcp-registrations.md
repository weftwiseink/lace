---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-17T12:00:00-07:00
task_list: devcontainer/claude-code-mcp-overmount
type: proposal
state: live
status: request_for_proposal
tags: [devcontainer_features, claude-code, mcp, mounts, footgun, graphify]
related_to:
  - cdocs/proposals/2026-09-15-graphify-lace-devcontainer-feature.md
---

# RFP: claude-code config over-mount masks in-container MCP registrations

> **BLUF:** The `claude-code` feature bind-mounts the host `~/.claude.json` over the container's Claude user-config path, so any build-time in-container `claude mcp add -s user` registration writes to a file the running CLI never reads. The registration "succeeds" but the MCP is invisible at runtime. This is a silent footgun for every feature that offers an `installMcpServer`-style option, empirically hit by graphify in the clauthier lace container.
>
> - **Motivated by:** `cdocs/proposals/2026-09-15-graphify-lace-devcontainer-feature.md` (the concrete instance)

## Objective

The `claude-code` feature declares a `config-json` lace mount that binds host `~/.claude.json` onto the container's Claude user-config path (`/home/${_REMOTE_USER}/.claude/.claude.json`), to share host onboarding/account state and avoid re-onboarding in containers. That mount is presumably intentional and worth preserving.

But it collides with build-time, in-container user-scope MCP registration. A feature's `install.sh` that runs `claude mcp add <name> -s user -- <cmd>` writes to the container's HOME config at build time. At runtime the mounted host file masks that write: the CLI reads user scope from the bind-mounted host config, which lacks the entry. The registration reports success and produces a valid config entry, yet `claude mcp list` / `claude mcp get <name>` never show it.

The goal of the full proposal is to let MCP-providing features register a server that the in-container agent can actually see, without giving up the host-config share the `claude-code` feature relies on.

## Context

Empirically confirmed in the clauthier lace container during graphify verification. The graphify feature's `installMcpServer: true` option runs `claude mcp add graphify -s user -- graphify-mcp` at install time. It fired successfully and wrote a valid stdio entry to `/home/node/.claude.json`, but `claude mcp list` / `claude mcp get graphify` do not show it, because the CLI reads user scope from the host-bind-mounted config, which lacks the entry. The `graphify-mcp` binary itself is functional; this is purely a config-path collision, not a broken server.

Relevant lace source:
- `devcontainers/features/src/claude-code/devcontainer-feature.json` declares the `config-json` mount: `target` `/home/${_REMOTE_USER}/.claude/.claude.json`, `recommendedSource` `~/.claude.json`.
- `devcontainers/features/src/graphify/` is the concrete MCP-providing feature that trips it.

## Scope

The full proposal should explore:

- **Root cause framing.** A build-time write vs a runtime bind-mount that masks the same path: the user-scope registration lands in a file the running CLI does not read. Confirm the exact write path (`/home/node/.claude.json` HOME vs the mounted `.claude/.claude.json` under `CLAUDE_CONFIG_DIR`) and how `CLAUDE_CONFIG_DIR` resolution interacts with the mount.
- **Blast radius.** Any feature offering an `installMcpServer`-style option is affected, not just graphify. The failure is silent: consumers believe the MCP is wired when it is not.
- **Candidate fix directions** (for the full proposal to weigh, none picked here):
  - Register at RUNTIME after the mount is in place (e.g. a `postStartCommand` / `postAttachCommand`) rather than at build time.
  - Register at a scope the host user-config mount does not mask (project scope / `.mcp.json`).
  - Have the `claude-code` feature MERGE the in-container registration into the mounted config rather than fully over-mounting it.
  - A lace-level, mount-aware MCP-registration mechanism that features declare into.
- **Preserving the host share.** The host-config bind-mount is presumably intentional (share host auth/config, avoid re-onboarding). Any fix must keep that while not masking in-container registrations.

## Known Requirements

- The chosen fix must leave the `claude-code` feature's host onboarding/account-state share intact.
- After the fix, an MCP registered by a feature at install/provision time MUST be visible to `claude mcp list` for the in-container agent, or the feature must fail loudly rather than silently.
- The mechanism should generalize to any MCP-providing feature, not be graphify-specific.

## Prior Art

- `cdocs/proposals/2026-09-15-graphify-lace-devcontainer-feature.md` -- the MCP-providing feature where this was found; its Phase 3 registers via `claude mcp add graphify -s user` and asserts `claude mcp list` reports it (the assertion this footgun breaks in the mounted container).
- `cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md` -- prior RFP on the claude-code feature surface, including the `~/.claude.json` MCP-config mount (`mountMcpConfig`).

## Open Questions

1. Does `CLAUDE_CONFIG_DIR` point at `~/.claude/` (so the masked file is `.claude/.claude.json`) while `claude mcp add -s user` writes `~/.claude.json` at HOME, i.e. is this a path divergence as well as a mount mask? Confirm the exact read and write paths against the installed CLI.
2. Is runtime registration (`postStartCommand`) reliable given the mount is a single file, or does the CLI rewrite/replace the file on startup in a way that races the registration?
3. Would project-scope / `.mcp.json` registration satisfy the in-container agent's discovery without polluting the consumer's working tree, and is it masked by any other mount?
4. Can the `claude-code` feature merge rather than over-mount `.claude.json` without breaking the host onboarding/account-state share it exists to provide?
5. Should this be solved once at the lace/`claude-code`-feature level (a shared, mount-aware registration path) or left to each MCP-providing feature? What is the ownership boundary?
