---
first_authored:
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:38:42.000Z
task_list: lace/opencode-devcontainer-feature
type: proposal
state: live
status: implementation_ready
last_reviewed:
  status: accepted
  by: '@opencode/gpt-5.5'
  at: 2026-05-27T23:41:17.000Z
  round: 1
tags:
  - lace
  - opencode
  - devcontainer_features
  - agent_access
guid: pHWJgO1dTCmXQ
---

# OpenCode Devcontainer Feature

> BLUF: Add a lace-aware `opencode` devcontainer feature alongside the existing `claude-code` feature.
> The feature should install the OpenCode CLI and declare lace mounts for OpenCode's host state: config, auth/session data, and package/model cache.
> Unlike Claude Code, OpenCode splits state across `~/.config/opencode`, `~/.local/share/opencode`, and `~/.cache/opencode`, so the implementation should start with explicit mount declarations and verify which state is actually required for authentication, plugins, commands, agents, skills, and session continuity.
> The first implementation should be minimal: CLI install, state mounts, docs, and smoke tests, with advanced session-bridge behavior deferred until empirical gaps appear.

## Objective

Provide one-line OpenCode availability inside lace-managed devcontainers.
The feature should let a container run `opencode` with the user's existing provider authentication, OpenCode plugins, commands, agents, skills, and cache where safe.

The feature should follow the existing `devcontainers/features/src/claude-code/` pattern.
It should be publishable as `ghcr.io/weftwiseink/devcontainer-features/opencode:1` after local validation.

## Background

Lace already has a `claude-code` devcontainer feature.
That feature installs `@anthropic-ai/claude-code` with npm and declares lace mounts for `~/.claude` and `~/.claude.json`.

OpenCode uses a different state layout.
The current OpenCode documentation says provider credentials from `/connect` are stored in `~/.local/share/opencode/auth.json`.
Troubleshooting documentation says logs and project/session storage live under `~/.local/share/opencode/`.
Plugin documentation says npm plugins are automatically installed with Bun and cached in `~/.cache/opencode/node_modules/`.
Configuration documentation says global config and global `.opencode` directories live under `~/.config/opencode/`, while project config uses `opencode.json` and project-local `.opencode/`.

The existing lace repo already uses project-local OpenCode configuration.
`opencode.json` references `@weftwise/cdocs-opencode`.
`.opencode/commands/` and `.opencode/skills/` provide current local CDocs workflow support.
Those project-local files travel with the workspace and do not need host-home mounts.

The host-home state is still important.
Without `~/.local/share/opencode/auth.json`, a container likely needs a separate `/connect` flow or environment-based provider credentials.
Without `~/.cache/opencode`, container startup may re-download OpenCode plugins and provider packages.
Without `~/.config/opencode`, user-level plugins, rules, agents, commands, themes, providers, and model preferences may not match the host.

The main design question is how much host OpenCode state should be mounted by default.
Mounting too little makes containers inconvenient.
Mounting too much can leak credentials and can let host-specific global config affect every container.

## Proposed Solution

Add a new feature at `devcontainers/features/src/opencode/`.
The first version should install the OpenCode CLI and declare three lace-managed mounts:

1. `opencode/config`: host `~/.config/opencode` to container user `~/.config/opencode`.
2. `opencode/data`: host `~/.local/share/opencode` to container user `~/.local/share/opencode`.
3. `opencode/cache`: host `~/.cache/opencode` to container user `~/.cache/opencode`.

The feature should depend on `ghcr.io/devcontainers/features/node:1` unless the install path uses the upstream curl installer instead of npm.
The recommended first install path is `npm install -g opencode-ai@${VERSION}` because it mirrors the existing `claude-code` feature and keeps version pinning simple.

The feature manifest should expose a `version` option with default `latest`.
It should also expose mount-control options only if devcontainer feature metadata can express them cleanly.
If mount options would make metadata unclear, start with documented lace mount overrides in user settings instead of feature options.

The install script should create the OpenCode config, data, and cache directories for the remote user with conservative permissions.
It should not create fake credentials or run `/connect`.
It should print `opencode --version` after installation.

The README should explain the difference between project-local OpenCode config and mounted host state.
Project `opencode.json` and `.opencode/` remain in the workspace.
Mounted host state provides user authentication, global config, global plugins, and cache reuse.

### Candidate Feature Metadata

The manifest should follow the shape of `claude-code`:

```jsonc
{
  "id": "opencode",
  "version": "1.0.0",
  "name": "OpenCode",
  "description": "Installs OpenCode CLI globally and declares lace mounts for OpenCode config, data, and cache.",
  "options": {
    "version": {
      "type": "string",
      "default": "latest",
      "description": "OpenCode version to install from npm."
    }
  },
  "dependsOn": {
    "ghcr.io/devcontainers/features/node:1": {}
  },
  "customizations": {
    "lace": {
      "mounts": {
        "config": {
          "target": "/home/${_REMOTE_USER}/.config/opencode",
          "recommendedSource": "~/.config/opencode",
          "description": "OpenCode global config, plugins, agents, commands, skills, tools, and themes",
          "sourceMustBe": "directory"
        },
        "data": {
          "target": "/home/${_REMOTE_USER}/.local/share/opencode",
          "recommendedSource": "~/.local/share/opencode",
          "description": "OpenCode auth, logs, and project/session storage",
          "sourceMustBe": "directory"
        },
        "cache": {
          "target": "/home/${_REMOTE_USER}/.cache/opencode",
          "recommendedSource": "~/.cache/opencode",
          "description": "OpenCode plugin, provider, and package cache",
          "sourceMustBe": "directory"
        }
      }
    }
  }
}
```

The exact target paths must account for `root` remote users.
The existing `claude-code` feature uses `/home/${_REMOTE_USER}` in metadata and handles `root` in `install.sh`.
This proposal keeps that pattern unless lace mount template resolution gains a better remote-home variable.

## Important Design Decisions

### Mount OpenCode State by Category

OpenCode state is not a single `~/.opencode` directory.
The feature should mount config, data, and cache separately so users can override or disable one category without changing the others.

The `data` mount is the most sensitive because it includes `auth.json`.
The README and mount descriptions should say this directly.

### Keep Project Configuration in the Workspace

Project `opencode.json` and `.opencode/` should remain workspace files.
They are versioned project configuration, not host identity state.

The feature should not copy project commands or skills from the host home into the workspace.

### Do Not Build a Session Bridge First

Claude Code needed session-path bridge work because its project session storage encodes workspace paths under `~/.claude/projects/`.
OpenCode stores project/session data under `~/.local/share/opencode/project/`, but the exact portability behavior needs empirical validation.

The first feature should mount data and verify whether session continuity works.
Only add path-bridge logic if tests prove host/container session continuity is broken and the storage format is safe to manipulate.

### Prefer Npm Install for the First Version

OpenCode supports curl, npm, bun, pnpm, yarn, Homebrew, and other install methods.
The existing lace feature style already uses npm for Claude Code.
Using npm keeps this feature small and version-pinnable.

If npm global installation proves unreliable for OpenCode, switch to the upstream install script in a follow-up revision.

### Avoid Global Config Mutation

The feature may create missing directories in the container.
It should not write or rewrite user OpenCode config files.
Users should run `opencode auth login`, `/connect`, or host-side setup themselves when credentials are missing.

## Edge Cases / Challenging Scenarios

### Missing Host State Directories

New OpenCode users may not have `~/.config/opencode`, `~/.local/share/opencode`, or `~/.cache/opencode` yet.
The feature should document first-run setup.
Lace mount validation may need to create recommended directories or prompt the user to do so, depending on existing mount behavior.

### Credential Leakage

Mounting `~/.local/share/opencode` exposes provider credentials to the container.
That is probably the desired behavior for a trusted devcontainer, but it should be explicit.
Users who prefer environment-variable credentials should be able to override or omit the data mount.

### Host-Specific Global Config

Global `~/.config/opencode` may reference host-only paths, global plugins, or MCP servers that do not work inside a container.
The feature should not hide this risk.
Runtime smoke tests should include a project that relies only on project-local `opencode.json` as a fallback.

### Cache Compatibility

The `~/.cache/opencode` directory may contain packages installed for the host architecture.
If host and container architectures differ, cache reuse could fail or be unsafe.
The first implementation should test Linux host to Linux container behavior and document any architecture caveat.

### File Ownership

Bind-mounted state may be owned by the host user while the container remote user is `node` or another non-root account.
The install script can create container directories before mounts are applied, but it cannot chown bind-mounted host files safely.
Verification should include write access to cache and data paths.

### OpenCode Autoupdate

OpenCode can autoupdate depending on installation method and config.
The feature should not rely on autoupdate for correctness.
Version pinning through the feature option should be the reproducible path.

## Test Plan

### Feature Build Checks

Run the repository's devcontainer feature packaging or smoke workflow for the new feature.
Verify `devcontainer-feature.json` is valid JSON and follows existing feature metadata conventions.
Verify `install.sh` is executable and shellcheck-clean if shellcheck is available.

### Install Checks

Build a devcontainer that uses the local feature path.
Verify `opencode --version` works as the remote user.
Verify `which opencode` resolves to the installed binary.
Verify the install succeeds with `version: latest` and with a pinned version.

### Mount Checks

Run `lace up` with the feature enabled.
Verify lace injects mounts for config, data, and cache.
Verify the resolved targets point at the remote user's OpenCode paths.
Verify host source directories are created or validation errors are actionable.

### Runtime Checks

Inside the container, run `opencode auth list` or an equivalent non-mutating credential check.
Verify the container can see expected providers when host auth exists.
Run `opencode models` if credentials are configured and network access is available.
Start `opencode` or `opencode run` in the workspace and verify project `opencode.json` and `.opencode/` are discovered.

### Plugin and Cache Checks

Use the lace repo's `opencode.json` with `@weftwise/cdocs-opencode` after that package is current.
Verify npm plugin installation uses or populates the mounted cache.
Verify a second container start does not redownload the same package unnecessarily.

### Session Continuity Checks

Create a short OpenCode session on the host and a separate short session in the container.
Inspect whether both appear under the expected `~/.local/share/opencode/project/` storage without corrupting each other.
Do not implement path rewriting unless this check shows a concrete portability issue.

## Verification Methodology

Validate in increasing scope.
First verify the feature installs OpenCode in an isolated devcontainer.
Then verify lace mount resolution and host state visibility.
Then verify real OpenCode startup in the lace workspace.
Then verify plugin cache reuse and session behavior.

The acceptance standard is a container where `opencode` starts, uses the intended project config, can access expected provider credentials or reports their absence clearly, and does not require global host mutations beyond existing OpenCode state directories.

## Implementation Phases

### Phase 1: Scaffold the Feature

Create `devcontainers/features/src/opencode/devcontainer-feature.json`, `install.sh`, and `README.md`.
Mirror the existing `claude-code` feature structure where possible.
Add the `version` option and npm install path.

Success criteria: local feature metadata is valid and `install.sh` installs `opencode` in a test container.

### Phase 2: Add Lace Mount Declarations

Declare config, data, and cache mounts under `customizations.lace.mounts`.
Use recommended host paths from OpenCode documentation.
Document sensitivity and override expectations in the README.

Success criteria: `lace up` injects the expected mounts with actionable source validation.

### Phase 3: Runtime Smoke Test

Run OpenCode inside the lace container.
Verify CLI startup, provider visibility, project config discovery, and CDocs plugin behavior where available.
Record missing auth, cache, or config behavior explicitly.

Success criteria: OpenCode works in-container without manually copying host files into the workspace.

### Phase 4: Cache and Session Validation

Verify plugin/provider cache reuse across container restarts.
Verify session storage behavior across host and container use.
Decide whether any session bridge or cache isolation follow-up is needed.

Success criteria: no state corruption is observed, and any portability limitation is documented with a concrete follow-up.

### Phase 5: Publish Readiness

Update feature docs and any feature packaging metadata required by the repository's publishing workflow.
Reference the feature by local path during validation and by registry path only after publication.

Success criteria: the feature is ready for the same publication path used by existing lace devcontainer features.

## Summary

OpenCode should get its own lace-aware devcontainer feature rather than being folded into the Claude Code feature.
The two tools have different install packages and different state layouts.

The minimal useful feature is straightforward: install the CLI and mount OpenCode config, data, and cache.
The risky parts are not installation but state semantics: credentials, cache compatibility, global config portability, and session continuity.
Those should be verified before adding bridging or materialization logic.
