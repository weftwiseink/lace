---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T10:30:00-08:00
revisions:
  - by: "@claude-opus-4-6"
    at: 2026-02-05T14:00:00-08:00
    note: "Applied review feedback: removed fabricated CLAUDE_CODE_OAUTH_TOKEN env var, noted devcontainer feature uses deprecated npm install method, added implicit credential mounting threat, corrected containerEnv rationale, flagged unverified commands, consolidated overlapping open questions, and other non-blocking fixes."
type: report
state: live
status: revised
tags: [claude-code, devcontainer, mounting, authentication, lace-plugins, security]
---

# Bundling Claude Code as a Devcontainer Feature for Lace Containers

> BLUF: Prebuilt one-line Claude Code access in lace containers requires three coordinated mechanisms: (1) the official `ghcr.io/anthropics/devcontainer-features/claude-code:1` devcontainer feature for CLI installation, (2) bind mounts for `~/.claude/` (credentials, settings, session data) with write access, and (3) environment variable forwarding for `CLAUDE_CONFIG_DIR` and optional `ANTHROPIC_API_KEY`. The lace plugin system already supports mounts and extended config generation but needs new capabilities for feature injection, environment variable forwarding, and runtime user detection. This can be implemented as a "managed plugin" -- a built-in plugin type that does not require a git repo but generates mounts, env vars, and feature references as part of `generateExtendedConfig`. The user experience is a single flag in devcontainer.json (`"customizations.lace.claude": true`) or a settings.json toggle.

---

## 1. Executive Summary

Claude Code is Anthropic's agentic coding CLI that operates from the terminal. Running it inside devcontainers requires three things that the standard devcontainer feature alone does not handle: persistent authentication credentials, proper mount targets for the runtime user, and environment variable configuration.

Lace is already well-positioned to solve this. The existing plugin system handles mount resolution, extended config generation, and `postCreateCommand` injection. The primary gaps are:

1. **No feature injection**: `generateExtendedConfig` merges `mounts`, `postCreateCommand`, and `appPort`, but not `features`, `containerEnv`, or `remoteEnv`.
2. **No environment variable forwarding in plugins**: The `ResolvedPlugin` interface tracks mounts but not env vars.
3. **No runtime user detection**: Mount targets like `/home/node/.claude` require knowing the container's `remoteUser`, which varies across projects.
4. **No built-in managed plugins**: All current plugins are git-repo-based. Claude access is not a repo to clone -- it is a bundle of config to inject.

The recommended approach is a "managed plugin" concept: a first-class lace feature that generates the necessary mounts, env vars, and devcontainer feature references without requiring a git repo. Implementation requires approximately 4 changes to the codebase and can be done incrementally.

---

## 2. Claude Code Installation Analysis

### 2.1 Installation Methods

Claude Code can be installed via three mechanisms relevant to containers:

| Method | Command | Notes |
|--------|---------|-------|
| **Devcontainer feature** (recommended) | `ghcr.io/anthropics/devcontainer-features/claude-code:1` | Installs globally via npm, auto-installs Node.js if missing |
| **npm global** (deprecated) | `npm install -g @anthropic-ai/claude-code` | Requires Node.js 18+, deprecated in favor of native install |
| **Native installer** | `curl -fsSL https://claude.ai/install.sh \| bash` | Installs to `~/.local/bin/claude`, auto-updates |

For devcontainers, the **official devcontainer feature** is the correct choice. It:
- Is published at `ghcr.io/anthropics/devcontainer-features/claude-code:1` (currently v1.0.5)
- Has no user-configurable options (empty options object)
- Requires Node.js (auto-installs Node.js 18.x on Debian/Ubuntu/Alpine/Fedora if missing)
- Installs via `npm install -g @anthropic-ai/claude-code`
- Lists `ghcr.io/devcontainers/features/node` in `installsAfter` (ordering dependency)
- Automatically includes the VS Code extension `anthropic.claude-code`

> **Installation method discrepancy**: The devcontainer feature installs Claude Code via `npm install -g @anthropic-ai/claude-code`, which is the **deprecated** npm-based installation method. Anthropic's recommended installation for non-container environments is the native installer (`curl -fsSL https://claude.ai/install.sh | bash`). The npm package is functionally equivalent but may lag behind the native installer in updates. For containerized use, this is an acceptable trade-off because the devcontainer feature handles installation transparently -- users do not need to manage the installation method directly. However, lace should be prepared for the possibility that a future version of the devcontainer feature may switch to the native installer, which would change the installation path from a global npm binary to `~/.local/bin/claude`.

### 2.2 What Claude Code Needs at Runtime

Once installed, Claude Code requires:

| Requirement | Purpose | Notes |
|-------------|---------|-------|
| `~/.claude/` directory (writable) | Credentials, settings, session data, agents | Must be writable; read-only mounts break auth |
| `CLAUDE_CONFIG_DIR` env var | Override config directory location | Optional; defaults to `~/.claude` relative to `$HOME` |
| Network access to `api.anthropic.com` | API calls | Required unless using Bedrock/Vertex |
| Network access to `statsig.anthropic.com` | Telemetry | Can be disabled via `DISABLE_TELEMETRY` (official docs) or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (may also work; verify which is canonical before implementing) |

### 2.3 Anthropic's Own Devcontainer Setup

Anthropic's reference devcontainer (from `anthropics/claude-code/.devcontainer/`) uses:

```json
{
  "remoteUser": "node",
  "mounts": [
    "source=claude-code-bashhistory-${devcontainerId},target=/commandhistory,type=volume",
    "source=claude-code-config-${devcontainerId},target=/home/node/.claude,type=volume"
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  }
}
```

Key observations:
- They use **Docker named volumes** (not bind mounts) for `~/.claude/`, which means credentials do not persist across `devcontainer rebuild` (volumes are tied to `${devcontainerId}`).
- They hardcode `remoteUser: "node"` and the mount target `/home/node/.claude`.
- They set `CLAUDE_CONFIG_DIR` explicitly.

For lace, we want **bind mounts** instead of volumes, so that the host's Claude credentials are forwarded into the container and persist across rebuilds.

---

## 3. Authentication Forwarding Design

### 3.1 Authentication Methods

Claude Code supports multiple authentication approaches:

| Method | Storage | Env Var | Use Case |
|--------|---------|---------|----------|
| **OAuth (Pro/Max/Teams)** | `~/.claude/.credentials.json` (Linux/Windows); macOS Keychain | N/A (credential file only; no supported env var for OAuth tokens) | Interactive users with subscriptions |
| **API Key (Console)** | Not stored on disk | `ANTHROPIC_API_KEY` | CI, headless, pay-as-you-go |
| **Bedrock** | AWS credentials chain | `CLAUDE_CODE_USE_BEDROCK=1` | Enterprise AWS |
| **Vertex AI** | GCP credentials | `CLAUDE_CODE_USE_VERTEX=1` | Enterprise GCP |

> **Note on OAuth forwarding**: There is no documented environment variable for forwarding OAuth tokens into a container. OAuth token forwarding relies entirely on bind-mounting `~/.claude/` (which contains `.credentials.json` on Linux/Windows). On macOS, where credentials are stored in the system Keychain rather than on disk, OAuth forwarding via bind mount is not possible -- see Section 3.4 for workarounds. The `ANTHROPIC_API_KEY` environment variable path is the confirmed, documented alternative for containerized use.

### 3.2 Recommended Forwarding Strategy

The design supports two complementary paths:

**Path A: Bind-mount `~/.claude/` from host (interactive users)**

This is the primary path for developers who have authenticated on their host machine. The `~/.claude/` directory contains:

| File/Dir | Purpose | Mount Mode |
|----------|---------|------------|
| `.credentials.json` | OAuth tokens (Linux/Windows only; macOS uses Keychain) | read-write |
| `settings.json` | User-level Claude settings | read-write |
| `settings.local.json` | Local user settings | read-write |
| `CLAUDE.md` | Global instructions | read-only would suffice, but bundled |
| `statsig/` | Analytics cache | read-write |
| `commands/` | Custom slash commands | read-only would suffice, but bundled |
| `agents/` | Custom subagents | read-only would suffice, but bundled |
| `projects/` | Session history per-project | read-write |

The entire `~/.claude/` must be mounted **read-write** because:
1. Claude writes to `.credentials.json` to refresh OAuth tokens.
2. Claude writes session data to `projects/`.
3. Claude writes analytics state to `statsig/`.
4. Read-only mounts cause authentication failures (confirmed in community reports).

**Path B: Environment variable API key (headless/CI)**

For CI or headless use, set `ANTHROPIC_API_KEY` as an environment variable. No mount needed. Lace should forward this from the host environment if present.

### 3.3 Host Directory Resolution

The source directory on the host depends on the host user's home directory. Lace can resolve this at `lace up` time:

```
Source: ${HOME}/.claude    (host, resolved at runtime via process.env.HOME or os.homedir())
Target: /home/${remoteUser}/.claude  (container, derived from remoteUser)
```

### 3.4 macOS Keychain Limitation

On macOS, Claude Code stores credentials in the system Keychain, not in `~/.claude/.credentials.json`. This means bind-mounting `~/.claude/` alone is **insufficient** on macOS hosts for OAuth-authenticated users. Options:

1. **Export credentials first**: Run `claude setup-token` on the host to generate a credential file, then mount. **Warning**: `claude setup-token` does not appear in official Claude Code documentation and may be an undocumented/internal command. It has been referenced in GitHub issues (e.g., #19274) but relying on it in production is fragile -- it may change or be removed without notice.
2. **Use API key**: Set `ANTHROPIC_API_KEY` instead.
3. **Login inside container**: Run `claude login` in the container (requires browser access for OAuth callback).

Lace should document this limitation and recommend Path B (API key) for macOS users. The `claude setup-token` workaround should be mentioned as an option but flagged as depending on an undocumented command.

---

## 4. Mount Requirements

### 4.1 Required Mounts

| Mount | Source (host) | Target (container) | Mode | Purpose |
|-------|--------------|-------------------|------|---------|
| Claude config | `~/.claude` | `/home/${remoteUser}/.claude` | bind, read-write | Auth, settings, sessions |

### 4.2 Optional Mounts

| Mount | Source (host) | Target (container) | Mode | Purpose |
|-------|--------------|-------------------|------|---------|
| MCP config | `~/.claude.json` | `/home/${remoteUser}/.claude.json` | bind, read-only | Global MCP server definitions |

### 4.3 Mount Spec Generation

Using the existing `generateMountSpec` pattern:

```
type=bind,source=/home/mjr/.claude,target=/home/node/.claude
type=bind,source=/home/mjr/.claude.json,target=/home/node/.claude.json,readonly
```

### 4.4 What Not to Mount

- `~/.local/bin/claude`: The container gets its own Claude installation via the devcontainer feature. Do not mount the host binary.
- `~/.local/share/claude`: Auto-update state. Container manages its own version.
- Individual credential files: Mount the entire `~/.claude/` directory, not individual files, because Claude creates and manages files within it dynamically.

---

## 5. Runtime User Detection

### 5.1 The Problem

Mount targets must reference the container user's home directory. Different projects use different `remoteUser` values:

| Base Image | Typical remoteUser | Home Directory |
|-----------|-------------------|----------------|
| `node:*` | `node` | `/home/node` |
| `mcr.microsoft.com/devcontainers/*` | `vscode` | `/home/vscode` |
| `ubuntu:*` | `root` (or custom) | `/root` or `/home/$user` |
| Custom | varies | varies |

### 5.2 Detection Strategy

The `remoteUser` can be determined from the devcontainer.json at parse time. The resolution order (matching the devcontainer spec) is:

1. `remoteUser` field in devcontainer.json (explicit)
2. `containerUser` field in devcontainer.json (fallback)
3. Dockerfile `USER` directive (default if neither is set)
4. `root` (final default)

For lace, the practical approach is:

```typescript
function resolveRemoteUser(raw: Record<string, unknown>): string {
  // Check explicit remoteUser
  if (typeof raw.remoteUser === 'string') return raw.remoteUser;
  // Check containerUser as fallback
  if (typeof raw.containerUser === 'string') return raw.containerUser;
  // Default: no explicit user found
  return 'root';
}

function resolveRemoteHome(remoteUser: string): string {
  if (remoteUser === 'root') return '/root';
  return `/home/${remoteUser}`;
}
```

> **Caveat on defaulting to `root`**: Defaulting to `root` when no `remoteUser` or `containerUser` is set is conservative but may produce incorrect mount targets for common devcontainer images. Microsoft's base images (`mcr.microsoft.com/devcontainers/*`) default to a `vscode` user, and Node images default to `node`. Defaulting to `root` will generate mount targets under `/root/` which will be wrong for these common cases. A smarter heuristic (e.g., checking the `image` field for known patterns like `node:*` -> `node`, or `mcr.microsoft.com/devcontainers/*` -> `vscode`) could improve accuracy but adds maintenance burden. At minimum, the warning emitted when defaulting to `root` (see 5.3) should be prominent and actionable.

### 5.3 Limitation: Dockerfile USER Detection

If neither `remoteUser` nor `containerUser` is set in devcontainer.json, the actual runtime user depends on the Dockerfile's `USER` directive. Parsing Dockerfiles to extract this is fragile (multi-stage builds, ARG substitution, base image defaults). The recommended approach is:

1. Read `remoteUser` / `containerUser` from devcontainer.json.
2. If absent, default to `root` and emit a **prominent warning** recommending that the user set `remoteUser` explicitly in their devcontainer.json or override it in `settings.json`.
3. Allow the user to override via `~/.config/lace/settings.json`:

```jsonc
{
  "claude": {
    "remoteUser": "node"  // Override if auto-detection gets it wrong
  }
}
```

### 5.4 UID/GID Considerations

On Linux hosts, bind-mounted files retain host UID/GID. The devcontainer spec automatically updates the container user's UID/GID to match the host user on Linux (via `updateRemoteUserUID`, which defaults to `true`). This means:

- **Linux hosts**: UID mapping is handled automatically by the devcontainer CLI. No special handling needed.
- **macOS/Windows hosts**: Docker Desktop virtualizes UID/GID. No special handling needed.

---

## 6. Environment Variable Forwarding

### 6.1 Required Environment Variables

| Variable | Value | Injection Target | Purpose |
|----------|-------|-----------------|---------|
| `CLAUDE_CONFIG_DIR` | `/home/${remoteUser}/.claude` | `containerEnv` | Points Claude to mounted config |

### 6.2 Optional Environment Variables (Forward from Host)

| Variable | When to Forward | Injection Target | Purpose |
|----------|----------------|-----------------|---------|
| `ANTHROPIC_API_KEY` | If set on host | `remoteEnv` | API key auth (alternative to OAuth) |
| `CLAUDE_CODE_USE_BEDROCK` | If set on host | `remoteEnv` | AWS Bedrock routing |
| `CLAUDE_CODE_USE_VERTEX` | If set on host | `remoteEnv` | GCP Vertex routing |
| `DISABLE_TELEMETRY` (or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) | Optional | `containerEnv` | Disable telemetry (verify canonical env var name before implementing) |

### 6.3 containerEnv vs remoteEnv

- `containerEnv`: Set at container creation. Good for fixed values like `CLAUDE_CONFIG_DIR`.
- `remoteEnv`: Set at attach time. Good for values that may change between sessions. Supports `${localEnv:VAR}` syntax for forwarding host variables.

For host-forwarded variables, `remoteEnv` with `${localEnv:...}` is preferred:

```json
{
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  },
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  }
}
```

### 6.4 Security Considerations for Env Vars

- `ANTHROPIC_API_KEY` should be forwarded via `remoteEnv` (not `containerEnv`) to limit its visibility. Both `containerEnv` and `remoteEnv` are runtime configuration -- neither bakes values into the container image. The real distinction is **process scope**: `containerEnv` values are set at container creation and visible to all container processes (including background services, accessible via `/proc/*/environ`), while `remoteEnv` values are set at attach time and only visible to the dev tool's process tree (terminals, tasks, debugging). Using `remoteEnv` for API keys limits exposure to only the user's interactive sessions.
- The `${localEnv:ANTHROPIC_API_KEY}` syntax forwards the value from the host environment. If unset on the host, the behavior may vary by devcontainer CLI implementation (some set it to an empty string, some omit it). The devcontainer spec supports a default value syntax (`${localEnv:VAR:default}`) which can be used if explicit control is needed. This should be tested empirically before relying on it.
- Never log or persist API keys in resolved-mounts.json or other debug output.

---

## 7. Plugin API Changes Required

### 7.1 New: Feature Injection in `generateExtendedConfig`

Currently, `generateExtendedConfig` merges `mounts`, `postCreateCommand`, and `appPort`. It must also merge:

- `features`: Add the Claude Code devcontainer feature.
- `containerEnv`: Add `CLAUDE_CONFIG_DIR` and other fixed env vars.
- `remoteEnv`: Add `${localEnv:ANTHROPIC_API_KEY}` and other forwarded vars.

The merging logic follows the same pattern as `mounts`:

```typescript
// Add features
if (featureSpecs && Object.keys(featureSpecs).length > 0) {
  const existingFeatures = (original.features ?? {}) as Record<string, unknown>;
  extended.features = { ...existingFeatures, ...featureSpecs };
}

// Add containerEnv
if (containerEnvSpecs && Object.keys(containerEnvSpecs).length > 0) {
  const existingEnv = (original.containerEnv ?? {}) as Record<string, string>;
  extended.containerEnv = { ...existingEnv, ...containerEnvSpecs };
}

// Add remoteEnv
if (remoteEnvSpecs && Object.keys(remoteEnvSpecs).length > 0) {
  const existingEnv = (original.remoteEnv ?? {}) as Record<string, string>;
  extended.remoteEnv = { ...existingEnv, ...remoteEnvSpecs };
}
```

### 7.2 New: Managed Plugin Type

The current plugin system is git-repo-based. Claude access is a "managed plugin" that:
- Does not have a `repoId`
- Does not require cloning
- Generates mounts, env vars, and feature references
- Is toggled by a configuration flag, not a plugin declaration

Two design options:

**Option A: Dedicated `customizations.lace.claude` field**

```jsonc
{
  "customizations": {
    "lace": {
      "claude": true  // or { "apiKeyForward": true, "mountMcp": true }
    }
  }
}
```

This is simpler and more discoverable. Claude access is a first-class lace concern, not a generic plugin.

**Option B: Built-in plugin with special repoId**

```jsonc
{
  "customizations": {
    "lace": {
      "plugins": {
        "lace:claude": {}  // Special prefix indicates managed plugin
      }
    }
  }
}
```

This reuses the plugin system but requires extending it to handle non-git plugins.

**Recommendation**: Option A. Claude access is a core lace feature, not a generic plugin. A dedicated field is clearer, easier to document, and does not require changing the plugin system's assumptions about git repos.

> **Trade-off: field proliferation.** Option A introduces a precedent where each new "managed" integration gets its own top-level field under `customizations.lace` (e.g., `customizations.lace.claude`, `customizations.lace.copilot`, `customizations.lace.cursor`). For a single integration this is clean and discoverable, but if a second managed integration arises, the approach should be reconsidered in favor of a generalized mechanism (Option B or a new `managedPlugins` field) to avoid field proliferation.

### 7.3 New: `resolveClaudeConfig` Function

A new function in a new module (`src/lib/claude.ts` or within `up.ts`) that:

1. Detects `remoteUser` from devcontainer.json
2. Resolves the host `~/.claude` path
3. Validates the source exists (or warns)
4. Generates mount specs, feature specs, and env var specs
5. Returns them for `generateExtendedConfig` to merge

```typescript
interface ClaudeConfig {
  mountSpecs: string[];
  featureSpecs: Record<string, Record<string, unknown>>;
  containerEnvSpecs: Record<string, string>;
  remoteEnvSpecs: Record<string, string>;
}

function resolveClaudeConfig(raw: Record<string, unknown>): ClaudeConfig {
  const remoteUser = resolveRemoteUser(raw);
  const remoteHome = resolveRemoteHome(remoteUser);
  const hostClaudeDir = join(homedir(), '.claude');

  const mountSpecs: string[] = [];
  if (existsSync(hostClaudeDir)) {
    mountSpecs.push(
      `type=bind,source=${hostClaudeDir},target=${remoteHome}/.claude`
    );
  }

  return {
    mountSpecs,
    featureSpecs: {
      'ghcr.io/anthropics/devcontainer-features/claude-code:1': {}
    },
    containerEnvSpecs: {
      'CLAUDE_CONFIG_DIR': `${remoteHome}/.claude`
    },
    remoteEnvSpecs: {
      'ANTHROPIC_API_KEY': '${localEnv:ANTHROPIC_API_KEY}'
    }
  };
}
```

### 7.4 Changes to `generateExtendedConfig`

The function signature and options interface need to accept the new spec types:

```typescript
interface GenerateExtendedConfigOptions {
  workspaceFolder: string;
  mountSpecs: string[];
  symlinkCommand: string | null;
  portMapping: string | null;
  // New fields:
  featureSpecs?: Record<string, Record<string, unknown>>;
  containerEnvSpecs?: Record<string, string>;
  remoteEnvSpecs?: Record<string, string>;
}
```

### 7.5 Changes to `runUp` Orchestration

A new phase in `runUp` between "Resolve mounts" and "Generate extended config":

```
Phase 0: Port assignment (existing)
Phase 1: Prebuild (existing, if configured)
Phase 2: Resolve mounts (existing, if plugins configured)
Phase 2.5: Resolve Claude config (new, if claude enabled)
Phase 3: Generate extended config (modified to accept new specs)
Phase 4: Devcontainer up (existing)
```

### 7.6 Settings Extension

`~/.config/lace/settings.json` should support Claude overrides:

```jsonc
{
  "claude": {
    "remoteUser": "node",        // Override auto-detected remoteUser
    "configSource": "~/code/dev_records/weft/claude",  // Override ~/.claude source
    "forwardApiKey": true,       // Default: true if ANTHROPIC_API_KEY is set
    "mountMcpConfig": false,     // Default: false (mount ~/.claude.json)
    "disableTelemetry": false    // Set DISABLE_TELEMETRY (verify canonical env var name)
  }
}
```

---

## 8. One-Line Access Design

### 8.1 User Experience: Project Author

A project author adds one line to their devcontainer.json:

```jsonc
{
  "customizations": {
    "lace": {
      "claude": true
    }
  }
}
```

Or with options:

```jsonc
{
  "customizations": {
    "lace": {
      "claude": {
        "mountMcpConfig": true,
        "disableTelemetry": true
      }
    }
  }
}
```

### 8.2 User Experience: Developer

A developer runs `lace up` as normal. The output includes:

```
Assigning port for wezterm SSH server...
Using port 22425
Resolving Claude Code access...
  Mounting ~/.claude -> /home/node/.claude
  Adding feature ghcr.io/anthropics/devcontainer-features/claude-code:1
  Forwarding ANTHROPIC_API_KEY from host
Generating extended devcontainer.json...
Starting devcontainer...
```

Inside the container, `claude` is available immediately with the host's authentication.

### 8.3 Generated Extended Config

Given a base devcontainer.json:

```jsonc
{
  "build": { "dockerfile": "Dockerfile" },
  "remoteUser": "node",
  "customizations": {
    "lace": {
      "claude": true,
      "plugins": {
        "github.com/user/dotfiles": {}
      }
    }
  }
}
```

Lace generates `.lace/devcontainer.json`:

```jsonc
{
  "build": { "dockerfile": "Dockerfile" },
  "remoteUser": "node",
  "customizations": {
    "lace": {
      "claude": true,
      "plugins": {
        "github.com/user/dotfiles": {}
      }
    }
  },
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
  },
  "mounts": [
    "type=bind,source=/home/mjr/.claude,target=/home/node/.claude",
    "type=bind,source=/home/mjr/.config/lace/lace/plugins/dotfiles,target=/mnt/lace/plugins/dotfiles,readonly"
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  },
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  },
  "appPort": ["22425:2222"]
}
```

### 8.4 Fallback: No Host Credentials

If `~/.claude/` does not exist on the host:

1. Skip the mount (no mount for a nonexistent source).
2. Still inject the feature (Claude CLI is installed).
3. Still forward `ANTHROPIC_API_KEY` if set.
4. Log: `Info: ~/.claude not found on host. Claude will require in-container authentication.`

The user can then run `claude login` inside the container to authenticate.

---

## 9. Security Considerations

### 9.1 Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| **Credential exposure via mount** | Medium | `~/.claude/.credentials.json` is mounted into the container. A compromised container process could read OAuth tokens. | Mount as read-write (required) but scope access to the container user. |
| **API key in env var** | Medium | `ANTHROPIC_API_KEY` is visible to all processes in the container via `/proc/*/environ`. | Use `remoteEnv` (not `containerEnv`) to limit visibility. Accept this as a known trade-off for convenience. |
| **OAuth token refresh writes** | Low | Claude writes to `~/.claude/.credentials.json` to refresh tokens. A malicious process could overwrite with invalid tokens. | Accept; same risk as any local tool with write access to its config. |
| **Cross-container credential sharing** | Low | If the host `~/.claude/` is mounted into multiple containers, all share the same credentials. | Acceptable for single-user development. Document as expected behavior. |
| **API key logging** | Medium | Resolved-mounts.json or lace debug output could inadvertently log the API key. | Never include environment variable values in resolved output. Only include variable names. |
| **DNS exfiltration** | Low | A compromised container could exfiltrate credentials via DNS queries. | Out of scope for lace; this is a general container isolation concern. |
| **Implicit credential mounting via malicious project devcontainer.json** | Medium | A cloned project could include `"customizations.lace.claude": true` in its devcontainer.json, causing `lace up` to mount the user's `~/.claude/` credentials into that project's container without explicit user consent beyond running `lace up`. Unlike the existing plugin system (where the user must configure settings.json overrides), this would be triggered by project-controlled config alone. | Consider requiring a global opt-in in `~/.config/lace/settings.json` (e.g., `"claude": { "enabled": true }`) before any project-level `customizations.lace.claude` takes effect. The mount only occurs if host `~/.claude/` exists, which provides a weak gate. A stronger default would be: global default of "disabled" with per-project override requiring explicit global opt-in first. |

### 9.2 Mount Permission Model

| Mount | Host Path | Read/Write | Rationale |
|-------|-----------|-----------|-----------|
| `~/.claude/` | User home | Read-write | Required for OAuth token refresh and session data |
| `~/.claude.json` | User home | Read-only | MCP config is read at startup, not written |

### 9.3 Comparison with Anthropic's Approach

Anthropic's reference devcontainer uses **Docker named volumes** for `~/.claude/`, not bind mounts. This means:
- Credentials are isolated per container (more secure).
- Credentials do not persist across rebuilds (less convenient).
- The user must re-authenticate after every rebuild.

Lace's approach (bind mounts) trades some isolation for significant convenience. This is the right trade-off for a development tool where the user explicitly opts in to credential forwarding.

### 9.4 Recommendations

1. **Document the security implications** of mounting `~/.claude/` in the user-facing docs.
2. **Never mount `~/.claude/` as read-only** -- this breaks Claude authentication and causes confusing errors.
3. **Support opt-out**: If `customizations.lace.claude` is absent or `false`, no Claude-related mounts or env vars are injected.
4. **Support API-key-only mode**: If a user sets `configSource: null` in settings, skip the bind mount and only forward the API key.
5. **Log mount operations** but never log credential contents or env var values.

---

## 10. Open Questions

### Q1: Should the devcontainer feature be auto-injected, and will `devcontainer up` process it from the extended config?

**Option A**: Lace injects `"ghcr.io/anthropics/devcontainer-features/claude-code:1": {}` into the extended config's `features` field. The user does not need to add it to their base devcontainer.json.

**Option B**: Lace documents that the user should add the feature to their devcontainer.json manually. Lace only handles mounts and env vars.

Recommendation: Option A. The whole point is one-line access. If the user has to separately add the feature, it is two lines, not one.

**Key concern**: Does `devcontainer up --config .lace/devcontainer.json` process features from the extended config? If features are already processed during the initial build and cached, injecting them into the extended config may have no effect. This is how lace already works for `mounts` and `appPort` -- the extended config is the complete config passed to the CLI, which replaces the original config entirely. So features in the extended config should be processed. However, **empirical testing is required** to confirm this, as feature installation involves build-time steps (layer caching, `install.sh` execution) that may behave differently from runtime fields like `mounts`.

If features in extended configs are not processed, the fallback is Option B: require the user to add the feature to their base devcontainer.json, with lace only handling mounts and env vars.

### Q2: How should lace handle the macOS Keychain limitation?

macOS stores Claude credentials in the system Keychain, not in `~/.claude/.credentials.json`. The bind mount of `~/.claude/` will not include Keychain-stored OAuth tokens.

Options:
1. Document the limitation and recommend `ANTHROPIC_API_KEY` for macOS users.
2. Add a `claude setup-token` step that exports Keychain credentials to a file. (Note: `claude setup-token` is undocumented -- see Section 3.4 caveat.)
3. Detect macOS hosts and skip credential mounting, only forwarding env vars.

Recommendation: Option 1 for v1, with a note that `claude setup-token` can be used as a workaround (with the caveat that it is an undocumented command).

### Q3: Should lace support per-project Claude config directories?

Lace's own devcontainer.json mounts a project-specific Claude config:

```
"source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind"
```

Should the managed plugin support this pattern via `configSource` in settings, or should it always use `~/.claude/`?

Recommendation: Support `configSource` in settings for power users, default to `~/.claude/`.

### Q4: Should Claude access be opt-in per project or opt-in globally?

**Per-project (current proposal)**: Each project opts in via `"customizations.lace.claude": true`.

**Global via settings**: A `~/.config/lace/settings.json` flag like `"claude": { "enabled": true }` that applies to all lace containers.

Recommendation: Support both. Global setting provides the default; per-project setting overrides it (can enable or disable).

### Q5: Container startup ordering

Claude Code installation via the devcontainer feature happens during container build. Mount injection happens at container start. This ordering is correct -- the Claude CLI is available before mounts are active. However, if Claude has a `postCreateCommand` or `postStartCommand` that needs credentials (e.g., `claude doctor`), the mount must be available at that point. Devcontainer bind mounts are available from container start, so this should work, but it needs verification.

---

## Appendix A: Complete Environment Variable Reference

The following environment variables are relevant to Claude Code in containers. Only the first three are recommended for lace injection; the rest are documented for reference.

### Injected by Lace

| Variable | Injection | Value |
|----------|----------|-------|
| `CLAUDE_CONFIG_DIR` | `containerEnv` | `/home/${remoteUser}/.claude` |
| `ANTHROPIC_API_KEY` | `remoteEnv` | `${localEnv:ANTHROPIC_API_KEY}` |
| `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `containerEnv` (opt-in) | `1` | Note: Official docs reference `DISABLE_TELEMETRY` for Statsig opt-out. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` may also work but should be verified as canonical before use. |

### User-configurable (not injected by default)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_MODEL` | Override default model |
| `ANTHROPIC_SMALL_FAST_MODEL` | Override fast model |
| `CLAUDE_CODE_USE_BEDROCK` | Route through AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX` | Route through GCP Vertex |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Override token limits |
| `CLAUDE_CODE_ACTION` | Permission mode (`acceptEdits`, `bypassPermissions`) |
| `HTTP_PROXY` / `HTTPS_PROXY` | Proxy configuration |
| `NODE_EXTRA_CA_CERTS` | Custom CA certificates |

## Appendix B: File Reference

| File | Role in This Proposal |
|------|----------------------|
| `packages/lace/src/lib/up.ts` | `generateExtendedConfig` needs feature/env injection |
| `packages/lace/src/lib/up.ts` | `runUp` needs new Claude resolution phase |
| `packages/lace/src/lib/devcontainer.ts` | `extractPlugins` pattern to follow for `extractClaudeConfig` |
| `packages/lace/src/lib/mounts.ts` | `generateMountSpec` reused for Claude mounts |
| `packages/lace/src/lib/settings.ts` | `LaceSettings` needs `claude` field |
| `packages/lace/src/lib/resolve-mounts.ts` | Reference for orchestration pattern |

## Appendix C: Related Documents

- **Plugin System State Report**: `cdocs/reports/2026-02-05-lace-plugin-system-state.md`
- **Plugin System Proposal**: `cdocs/proposals/2026-02-04-lace-plugins-system.md`
- **RFP: Plugin Host Setup**: `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md`
- **RFP: Plugin Conditional Loading**: `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md`
- **Anthropic devcontainer-features**: https://github.com/anthropics/devcontainer-features
- **Claude Code devcontainer docs**: https://code.claude.com/docs/en/devcontainer
- **Claude Code settings docs**: https://code.claude.com/docs/en/settings
- **Claude Code setup docs**: https://code.claude.com/docs/en/setup
