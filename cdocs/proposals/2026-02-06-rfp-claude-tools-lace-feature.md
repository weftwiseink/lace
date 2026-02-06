---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T12:00:00-08:00
task_list: lace/claude-tools-feature
type: proposal
state: live
status: request_for_proposal
tags: [lace, claude-code, devcontainer-features, extensibility, ghcr, template-variables]
supersedes:
  - cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md
  - cdocs/proposals/2026-02-05-lace-claude-access-detailed-implementation.md
related_to:
  - cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md
---

# RFP: Claude Tools as a Lace-Aware Devcontainer Feature

> **BLUF:** Repackage Claude Code container access -- credential mounting, session bridge, env var forwarding, agent awareness -- as a standard devcontainer feature published to ghcr.io, declared via `customizations.lace.features` with lace template variable resolution, replacing the earlier "managed plugin" approach that would have hardcoded Claude-specific logic into lace's codebase.
>
> - **Motivated by:** `cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md`, `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md`, `cdocs/proposals/2026-02-05-lace-claude-access-detailed-implementation.md`

## Objective

The earlier proposals (`2026-02-05-lace-mount-enabled-claude-plugin.md` and `2026-02-05-lace-claude-access-detailed-implementation.md`) designed Claude Code access as a "managed plugin" -- a hardcoded config transform inside lace that generates mounts, features, env vars, and lifecycle commands when `customizations.lace.claude: true` is set. The architecture analysis report (`2026-02-05-plugin-architecture-devcontainer-features-analysis.md`) identified this as architecturally suspect: it is not really a plugin, it is a hardcoded feature of lace dressed up in plugin vocabulary.

The devcontainer feature spec already provides the mechanisms needed: `install.sh` for tool installation, `containerEnv`/`remoteEnv` for environment variables, `mounts` for bind mounts, lifecycle hooks for session bridge and agent context generation, and typed `options` for configuration. Lace's role should be limited to the host-side orchestration that features cannot do: template variable resolution (`${lace.local.home}`, `${lace.container.username}`, etc.) and feature promotion into the extended config.

This RFP proposes building Claude Code access as a self-contained devcontainer feature that is declared through `customizations.lace.features` and resolved by lace's template variable system before being passed to the devcontainer CLI.

## Scope

The full proposal should explore:

### The Claude Code Devcontainer Feature

A devcontainer feature published to `ghcr.io/weftwiseink/devcontainer-features/claude-code` (or similar) that handles:

- **Claude Code CLI installation** via `install.sh` -- installing the Claude Code CLI binary into the container
- **`~/.claude/` mount** -- bind-mounting the host's Claude config directory into the container for credential and session persistence. The host path is resolved by lace templating (`${lace.local.home}/.claude`), the container target by `${lace.container.home}/.claude`
- **`ANTHROPIC_API_KEY` forwarding** -- injecting the host API key via `remoteEnv` using `${localEnv:ANTHROPIC_API_KEY}`
- **Session bridge symlink** -- a `postStartCommand` that creates a symlink in `~/.claude/projects/` mapping the container's path encoding to the host's path encoding for cross-context session portability
- **`.claude.local.md` generation** -- a `postStartCommand` that writes runtime context (lace container identification, SSH port, plugin mount prefix, persistent state location) to the workspace root for agent situational awareness
- **Optional claude-tools (OCaml) installation** -- an opt-in option to install `claude-tools` from source via opam/dune in `postCreateCommand`

### Feature Options Schema

What options should the feature expose via `devcontainer-feature.json`? Candidates:

- `hostClaudeDir` (string): host path to `~/.claude/` -- resolved by lace template `${lace.local.home}/.claude`
- `containerUser` (string): target container user -- resolved by `${lace.container.username}`
- `containerHome` (string): target container home directory -- resolved by `${lace.container.home}`
- `hostWorkspaceFolder` (string): host workspace path for session bridge -- resolved by `${lace.local.workspaceFolder}`
- `containerWorkspaceFolder` (string): container workspace path -- resolved by `${lace.container.workspaceFolder}`
- `forwardApiKey` (boolean): whether to forward `ANTHROPIC_API_KEY` (default: true)
- `mountMcpConfig` (boolean): whether to mount `~/.claude.json` for MCP config (default: false)
- `sessionBridge` (boolean): whether to create the session bridge symlink (default: true)
- `agentContext` (boolean): whether to generate `.claude.local.md` (default: true)
- `installClaudeTools` (boolean): whether to install claude-tools from source (default: false)

### Declaration via `customizations.lace.features`

How the feature is declared in a project's devcontainer.json, using lace template variables for host-side dynamic values:

```jsonc
{
  "customizations": {
    "lace": {
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
          "hostClaudeDir": "${lace.local.home}/.claude",
          "containerUser": "${lace.container.username}",
          "containerHome": "${lace.container.home}",
          "hostWorkspaceFolder": "${lace.local.workspaceFolder}",
          "containerWorkspaceFolder": "${lace.container.workspaceFolder}"
        }
      }
    }
  }
}
```

Lace resolves the template variables, then promotes the feature into the top-level `features` object of `.lace/devcontainer.json` for the devcontainer CLI to process.

### Lace's Role

Lace's responsibilities for this feature are limited to:

- **Template variable resolution** -- resolving `${lace.*}` variables in `customizations.lace.features` option values to concrete host-side and container-side values
- **Feature promotion** -- moving resolved feature declarations from `customizations.lace.features` into the extended config's top-level `features` object
- **Port management** -- if the feature needs the SSH port (for agent context), lace injects it via the existing `${lace.local.openPort()}` or similar mechanism

Lace does NOT contain any Claude-specific logic. The feature's `install.sh`, lifecycle hooks, mount declarations, and env var specs live entirely in the feature package.

### What Survives from the Earlier Proposals

The `generateExtendedConfig` extension work from the earlier proposals -- features merging, containerEnv merging, remoteEnv merging, postStartCommand object-format normalization -- remains useful. This is the "feature promotion" mechanism that lace needs regardless of which features are being promoted. The claude-specific resolution logic (`claude-access.ts`) is replaced by the feature's own declarations plus lace's generic template variable system.

### User Settings Integration

How does `~/.config/lace/settings.json` interact with lace-templated features? The earlier proposals had a dedicated `claude` section in settings. With the features approach, user overrides could be more generic:

- Per-feature option overrides in settings (analogous to per-plugin `overrideMount`)
- Global template variable overrides (e.g., override `${lace.local.home}` for non-standard layouts)
- Feature-level enable/disable flags

## Known Requirements

The following concrete requirements were identified and validated in the earlier proposals and remain applicable:

1. **Mount the host `~/.claude/` directory read-write** into the container at the correct user home. The mount must be read-write for credential persistence and session state.
2. **Forward `ANTHROPIC_API_KEY`** via `remoteEnv` using `${localEnv:ANTHROPIC_API_KEY}` to limit credential exposure to the dev tool's process tree.
3. **Session bridge symlink** in `postStartCommand` (not `postCreateCommand`) so it is refreshed on every container start, surviving `claude-clean` runs.
4. **`.claude.local.md`** uses a single-quoted heredoc delimiter (`'LOCALEOF'`) so `$LACE_SSH_PORT` is written literally for agent runtime evaluation.
5. **Project-declared features take precedence** over lace-injected features when the same feature key exists.
6. **Warn-and-skip when host `~/.claude/` is missing** -- still inject the feature for CLI installation, allow in-container `claude login`.
7. **claude-tools installation is opt-in** (`installClaudeTools: false` default) due to OCaml toolchain requirement and 5-10 minute build time.

## Prior Art

- **Earlier proposals (superseded):** `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md` and `cdocs/proposals/2026-02-05-lace-claude-access-detailed-implementation.md` -- the "managed plugin" approach with `customizations.lace.claude: true`
- **Architecture analysis:** `cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md` -- recommended features as the extensibility unit
- **Existing wezterm server feature:** `ghcr.io/weftwiseink/devcontainer-features/wezterm-server` -- prior art for lace-aware devcontainer features published to ghcr.io
- **Devcontainer feature spec:** `containers.dev/implementors/features/` -- the upstream specification for feature packaging, options, lifecycle hooks, and OCI distribution

## Open Questions

1. **Feature self-sufficiency vs. lace dependency:** Can the feature be useful without lace (with manually specified options), or is lace templating a hard requirement? Ideally, a user could declare the feature in standard `features` with hardcoded values and still get Claude Code access without lace.

2. **Mount declaration ownership:** The devcontainer feature spec supports `mounts` in `devcontainer-feature.json`, but the host source path (`~/.claude/`) is dynamic. Should the feature declare the mount with a placeholder that lace fills in, or should lace generate the mount separately and the feature only handle installation and lifecycle?

3. **Template variable system scope:** The analysis report proposed `${lace.local.*}` and `${lace.container.*}` variables. What is the minimum viable set for this feature? Is `${lace.local.home}`, `${lace.container.username}`, `${lace.container.home}`, `${lace.local.workspaceFolder}`, and `${lace.container.workspaceFolder}` sufficient?

4. **Feature versioning and update strategy:** How does the feature version relate to Claude Code CLI versions? Pin to feature major version and let `install.sh` fetch the latest CLI? Or version-lock?

5. **Interaction with `customizations.lace.repos`:** If the project also uses repo mounts (the renamed "plugins"), how do LACE_* env vars and `.claude.local.md` reference those mounts? Should LACE_* vars be a separate concern from the Claude feature, injected by lace's template system regardless of which features are active?

6. **Settings override granularity:** Should users be able to override individual feature options in `~/.config/lace/settings.json`, or only enable/disable features wholesale? The earlier proposals had fine-grained `claude.forwardApiKey`, `claude.mountMcpConfig`, etc. -- do those map 1:1 to feature options?

7. **Rename timing:** The analysis report recommended renaming `customizations.lace.plugins` to `customizations.lace.repos`. Should this rename be bundled with the `customizations.lace.features` introduction, or sequenced separately?
