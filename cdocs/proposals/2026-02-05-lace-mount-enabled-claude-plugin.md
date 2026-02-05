---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:00:00-08:00
type: proposal
state: live
status: review_ready
tags: [lace, plugins, claude-code, managed-plugins, mounts, devcontainer, agent-awareness]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:30:00-08:00
  round: 1
revisions:
  - at: 2026-02-05T17:45:00-08:00
    by: "@claude-opus-4-6"
    round: 1
    summary: >
      Applied review feedback: [blocking] added sshPort parameter to resolveClaudeAccess
      signature, specified postStartCommand merging strategy (always normalize to object format)
      for all original formats with multiple lace-injected commands. [non-blocking] Fixed
      background table to reference claude-access.ts, clarified forwardApiKey defaults to
      always-include unless explicitly false, added settings-vs-project precedence documentation,
      fixed LACE_WORKSPACE_ROOT to be container path not host path, added claudeAccess phase
      to UpResult.phases, fixed .claude.local.md heredoc example consistency, added settings/project
      conflict resolution test cases, renamed Phase 1 for accuracy.
---

# Mount-Enabled Claude Plugin: Managed Plugin API and First Integration

> **BLUF:** This proposal extends the lace plugin system with a "managed plugin" concept -- built-in plugins that generate mounts, environment variables, and devcontainer features without requiring a git repo. The first managed plugin, `customizations.lace.claude`, provides one-line Claude Code access in any lace container by auto-injecting the `ghcr.io/anthropics/devcontainer-features/claude-code:1` feature, a `~/.claude/` bind mount, `CLAUDE_CONFIG_DIR`, and `ANTHROPIC_API_KEY` forwarding. The implementation extends `generateExtendedConfig` in `up.ts` to support `features`, `containerEnv`, and `remoteEnv` merging, adds runtime user detection for proper mount targeting, and includes a lightweight agent awareness layer via `LACE_*` environment variables and a generated `.claude.local.md`. The design is validated at each phase against the Claude access use case, ensuring the API works before generalizing. Based on findings from four research reports: plugin system architecture (Report 1), Claude devcontainer bundling (Report 2), claude-tools session portability (Report 3), and agent situational awareness (Report 4).

## Objective

Deliver a small, concrete extension to the lace plugin system that:

1. Proves the `generateExtendedConfig` API can support features, env vars, and managed plugins -- not just mounts.
2. Provides one-line Claude Code access for any lace-managed devcontainer.
3. Establishes a session bridge for host/container session portability.
4. Injects lightweight agent orientation context so Claude Code agents can self-orient inside lace containers.

The explicit non-goal is building a general-purpose managed plugin framework. This proposal builds exactly what is needed for the Claude access use case and leaves generalization for later proposals if/when a second managed plugin is needed.

## Background

### Current Plugin System

The lace plugin system (proposal: `cdocs/proposals/2026-02-04-lace-plugins-system.md`, status: `implementation_complete`) handles git-repo-based plugins declared in `customizations.lace.plugins`. The pipeline flows from project declaration through user settings to mount resolution, config generation, and `devcontainer up`. All 254+ tests pass. The system is complete for its designed scope: mounting directories into containers.

### Gaps Identified by Research

Four research reports identified the gaps this proposal addresses:

**Report 1** (Plugin System State) identified that `generateExtendedConfig` in `up.ts:243-311` merges `mounts`, `postCreateCommand`, and `appPort` but not `features`, `containerEnv`, or `remoteEnv`. It also noted that `generateExtendedConfig` is module-private and that the `ResolvedPlugin` interface tracks mounts but not env vars. Key extension points: `generateExtendedConfig`, `ResolvedPlugin`, `PluginOptions`, `PluginSettings`, and the `extractPlugins` discriminated-union pattern.

**Report 2** (Claude Devcontainer Bundling) determined that Claude Code access requires three coordinated mechanisms: the official devcontainer feature for CLI installation, a read-write `~/.claude/` bind mount for credentials and sessions, and environment variable forwarding for `CLAUDE_CONFIG_DIR` and optionally `ANTHROPIC_API_KEY`. It recommended a dedicated `customizations.lace.claude` field (not a git-repo plugin) and a `resolveClaudeConfig` function that detects `remoteUser`, generates mount specs, feature specs, and env var specs.

**Report 3** (Claude-Tools Streamlining) found that session portability between host and container requires a symlink bridge in `~/.claude/projects/` mapping the container path encoding to the host path encoding. The symlink should be created in `postStartCommand` for idempotency. claude-tools installation is optional and orthogonal.

**Report 4** (Agent Situational Awareness) proposed injecting `LACE_*` environment variables via `containerEnv` and generating `.claude.local.md` with runtime context via `postStartCommand`. The environment variables require approximately 15 lines of code in `generateExtendedConfig`. The `.claude.local.md` generation handles per-worktree agent orientation.

### Key Source Files

| File | Current Role | Changes Needed |
|------|-------------|----------------|
| `packages/lace/src/lib/up.ts` | `runUp` orchestration, `generateExtendedConfig` | Extend config generation, add claude resolution phase |
| `packages/lace/src/lib/devcontainer.ts` | Config parsing, `extractPlugins` | Pattern reference for discriminated-union extraction |
| `packages/lace/src/lib/mounts.ts` | Mount resolution, spec generation | Reuse `generateMountSpec` for claude mounts |
| `packages/lace/src/lib/settings.ts` | User settings discovery | Extend `LaceSettings` with `claude` field |
| `packages/lace/src/lib/claude-access.ts` | (new) | Claude extraction, resolution, session bridge, agent context |

## Proposed Solution

### Architecture Overview

The implementation adds a new parallel path in the `runUp` pipeline for managed plugins, running alongside the existing git-repo plugin pipeline:

```
devcontainer.json                settings.json
(customizations.lace.claude)     (~/.config/lace/settings.json)
(customizations.lace.plugins)
         |                              |
         v                              v
    extractClaudeConfig()          loadSettings()
    extractPlugins()                    |
         |                              |
         +------+-----------------------+
                |                       |
                v                       v
    resolveClaudeAccess()    resolvePluginMounts()
         |                              |
         v                              v
    ClaudeAccessResult          ResolvedMounts
    (mounts, features,         (mounts, symlinks)
     containerEnv, remoteEnv,
     postStartCommand,
     postCreateCommand)
                |                       |
                +----------+------------+
                           |
                           v
                generateExtendedConfig()
                (now merges: mounts, features,
                 containerEnv, remoteEnv,
                 postCreateCommand, postStartCommand,
                 appPort)
                           |
                           v
                 .lace/devcontainer.json
                           |
                           v
                    devcontainer up
```

### Module: `src/lib/claude-access.ts`

A new module that encapsulates all Claude access resolution logic. This keeps the managed plugin logic separate from the generic plugin system.

#### Types

```typescript
/** Claude access configuration from devcontainer.json */
export type ClaudeAccessConfig = boolean | {
  mountMcpConfig?: boolean;    // Mount ~/.claude.json (default: false)
  installClaudeTools?: boolean; // Install claude-tools (default: false)
  sessionBridge?: boolean;     // Create session symlink bridge (default: true)
};

/** Result of claude access resolution */
export interface ClaudeAccessResult {
  mountSpecs: string[];
  featureSpecs: Record<string, Record<string, unknown>>;
  containerEnvSpecs: Record<string, string>;
  remoteEnvSpecs: Record<string, string>;
  postStartCommands: string[];   // Session bridge symlink, .claude.local.md
  postCreateCommands: string[];  // claude-tools install (optional)
}
```

#### Core Functions

```typescript
/**
 * Extract claude access configuration from parsed devcontainer.json.
 * Follows the same discriminated-union pattern as extractPlugins/extractPrebuildFeatures.
 */
export type ClaudeAccessExtraction =
  | { kind: "enabled"; config: ClaudeAccessConfig }
  | { kind: "absent" }
  | { kind: "disabled" };

export function extractClaudeAccess(raw: Record<string, unknown>): ClaudeAccessExtraction;

/**
 * Resolve the container's remote user from devcontainer.json.
 * Resolution order: remoteUser > containerUser > 'root' (with warning).
 */
export function resolveRemoteUser(raw: Record<string, unknown>): string;

/**
 * Resolve the home directory for a remote user.
 */
export function resolveRemoteHome(remoteUser: string): string;

/**
 * Resolve all claude access configuration into concrete specs.
 * Validates host ~/.claude/ exists (warns if not, skips mount).
 * Reads settings for user overrides (configSource, remoteUser, etc.).
 */
export function resolveClaudeAccess(options: {
  raw: Record<string, unknown>;
  settings: LaceSettings;
  workspaceFolder: string;
  containerWorkspaceFolder?: string;
  sshPort?: number;
}): ClaudeAccessResult;
```

#### Resolution Logic

`resolveClaudeAccess` performs the following steps:

1. **Detect remote user**: Call `resolveRemoteUser(raw)`. Check settings for `claude.remoteUser` override.
2. **Resolve remote home**: `resolveRemoteHome(remoteUser)`.
3. **Resolve host claude dir**: Use `settings.claude?.configSource` if set, otherwise `os.homedir() + '/.claude'`. Validate existence (warn and skip mount if absent).
4. **Generate mount specs**: `type=bind,source=${hostClaudeDir},target=${remoteHome}/.claude` (read-write, no readonly flag). Optionally add `~/.claude.json` mount (read-only) if `mountMcpConfig` is true.
5. **Generate feature specs**: `{ "ghcr.io/anthropics/devcontainer-features/claude-code:1": {} }`.
6. **Generate containerEnv**: `CLAUDE_CONFIG_DIR=${remoteHome}/.claude` plus `LACE_*` variables (see Agent Awareness section).
7. **Generate remoteEnv**: Always include `ANTHROPIC_API_KEY: ${localEnv:ANTHROPIC_API_KEY}` unless `settings.claude?.forwardApiKey` is explicitly `false`. The `${localEnv:...}` syntax is a devcontainer directive evaluated at attach time, so the host variable does not need to be set at config-generation time. If the variable is unset on the host, it will be empty or omitted at attach time depending on the devcontainer CLI implementation.
8. **Generate session bridge command**: A `postStartCommand` that creates the symlink from the container's project encoding to the host's project encoding in `~/.claude/projects/`.
9. **Generate `.claude.local.md` command**: A `postStartCommand` script that writes runtime context to the workspace's `.claude.local.md`.

### Extension: `generateExtendedConfig`

The `generateExtendedConfig` function in `up.ts:243-311` currently handles `mounts`, `postCreateCommand`, and `appPort`. This proposal extends its interface and merging logic:

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
  postStartCommands?: string[];
  postCreateCommands?: string[];  // Additional postCreateCommand entries
}
```

New merging blocks follow the same pattern as existing `mounts` merging:

**Features merging**: Shallow merge into `features` object. Existing features are preserved; new features are added. If a feature key already exists, the managed plugin's version is skipped (project author's config takes precedence).

```typescript
if (featureSpecs && Object.keys(featureSpecs).length > 0) {
  const existing = (original.features ?? {}) as Record<string, unknown>;
  // Project-declared features take precedence
  extended.features = { ...featureSpecs, ...existing };
}
```

**containerEnv merging**: Shallow merge. Existing vars take precedence.

```typescript
if (containerEnvSpecs && Object.keys(containerEnvSpecs).length > 0) {
  const existing = (original.containerEnv ?? {}) as Record<string, string>;
  extended.containerEnv = { ...containerEnvSpecs, ...existing };
}
```

**remoteEnv merging**: Same pattern.

**postStartCommand merging**: Unlike `postCreateCommand` (which may have a single lace-injected command), `postStartCommand` can have multiple lace-injected commands (session bridge, agent context). To avoid the string concatenation quoting issues that exist in the current `postCreateCommand` handling (`up.ts:278-281`), the strategy is: **always normalize to object format**.

For all original `postStartCommand` formats:
- **None/absent**: Set to object with lace entries.
- **String**: Wrap as `{ "original": original, "lace-session-bridge": [...], "lace-agent-context": [...] }`.
- **Array**: Wrap as `{ "original": ["sh", "-c", original.join(" ")], "lace-session-bridge": [...], "lace-agent-context": [...] }`.
- **Object**: Spread existing and add lace entries.

```typescript
// Normalize to object format for clean multi-command composition:
const lacePostStart: Record<string, unknown> = {};
if (sessionBridgeCmd) {
  lacePostStart["lace-session-bridge"] = ["sh", "-c", sessionBridgeCmd];
}
if (agentContextCmd) {
  lacePostStart["lace-agent-context"] = ["sh", "-c", agentContextCmd];
}

const existing = original.postStartCommand;
if (!existing) {
  extended.postStartCommand = lacePostStart;
} else if (typeof existing === "string") {
  extended.postStartCommand = { "original": existing, ...lacePostStart };
} else if (Array.isArray(existing)) {
  extended.postStartCommand = { "original": existing, ...lacePostStart };
} else if (typeof existing === "object") {
  extended.postStartCommand = { ...(existing as Record<string, unknown>), ...lacePostStart };
}
```

This avoids the `${existing} && ${bridge} && ${context}` string concatenation approach and its quoting pitfalls.

**postCreateCommand extension**: Additional `postCreateCommand` entries (e.g., claude-tools installation) are merged into the existing handling, following the same string/array/object pattern already implemented.

### Extension: `LaceSettings`

The `LaceSettings` interface in `settings.ts` gains a `claude` field for user-level overrides:

```typescript
export interface LaceSettings {
  plugins?: {
    [repoId: string]: PluginSettings;
  };
  // New:
  claude?: ClaudeUserSettings;
}

export interface ClaudeUserSettings {
  /** Override auto-detected remoteUser for mount targeting */
  remoteUser?: string;
  /** Override ~/.claude source directory */
  configSource?: string;
  /** Forward ANTHROPIC_API_KEY from host (default: true) */
  forwardApiKey?: boolean;
  /** Mount ~/.claude.json for MCP config (default: false) */
  mountMcpConfig?: boolean;
  /** Disable Claude telemetry in container (default: false) */
  disableTelemetry?: boolean;
}
```

**Settings vs. project config precedence:** When a field appears in both `ClaudeUserSettings` (settings.json) and `ClaudeAccessConfig` (devcontainer.json), settings.json takes precedence. The rationale: settings.json is the user's personal override, analogous to how `overrideMount` in settings overrides project-level plugin declarations. Concretely: if the project sets `mountMcpConfig: false` but the user's settings.json sets `mountMcpConfig: true`, the MCP config is mounted. If the user sets `forwardApiKey: false`, the API key is not forwarded regardless of what the project requests. The project config establishes defaults; the user config overrides them.

```typescript
// Pseudocode for option resolution
const mountMcpConfig = settings.claude?.mountMcpConfig
  ?? (typeof projectConfig === 'object' ? projectConfig.mountMcpConfig : undefined)
  ?? false;
```

Path expansion (tilde) is applied to `configSource` during `readSettingsConfig`, following the existing pattern for `overrideMount.source`.

### Extension: `runUp` Orchestration

A new phase is inserted in `runUp` between "Resolve mounts" and "Generate extended config":

```
Phase 0: Port assignment (existing)
Phase 1: Prebuild (existing, if configured)
Phase 2: Resolve mounts (existing, if plugins configured)
Phase 2.5: Resolve claude access (new, if claude enabled)
Phase 3: Generate extended config (modified to accept new spec types)
Phase 4: Devcontainer up (existing)
```

Phase 2.5 calls `resolveClaudeAccess` and collects the results. The results are passed as additional options to `generateExtendedConfig` in Phase 3. If claude access is not configured (`extractClaudeAccess` returns `absent` or `disabled`), Phase 2.5 is skipped entirely.

The `UpResult.phases` type gains a `claudeAccess?: { exitCode: number; message: string }` field to report the outcome of Phase 2.5, following the same pattern as the existing `portAssignment`, `prebuild`, and `resolveMounts` phase results.

### Agent Awareness Layer

The agent awareness layer is lightweight and piggybacks on the claude access infrastructure.

#### LACE_* Environment Variables

Injected via `containerEnv` whenever `customizations.lace.claude` is enabled (or independently if desired later):

| Variable | Value | Source |
|----------|-------|--------|
| `LACE_MANAGED` | `"true"` | Static |
| `LACE_PROJECT_NAME` | Derived from workspace folder basename | `deriveProjectId(workspaceFolder)` from `plugin-clones.ts` |
| `LACE_WORKSPACE_ROOT` | Container workspace root | From `raw.workspaceFolder` if set, else devcontainer default `/workspaces/${basename}` |
| `LACE_SSH_PORT` | Assigned SSH port | From `sshPort` parameter (sourced from `portResult.assignment.hostPort` in `runUp`) |
| `LACE_HOST_WORKSPACE` | Host workspace path | From `workspaceFolder` argument to `lace up` |

> NOTE: `LACE_WORKSPACE_ROOT` must be the **container** workspace path (e.g., `/workspaces/lace`), not the host path. The `workspaceFolder` option passed to `runUp` is the host path. The container workspace path is derived from `raw.workspaceFolder` (the `workspaceFolder` field in devcontainer.json) or the devcontainer default convention (`/workspaces/${basename(hostPath)}`). This is the same derivation used for the session bridge.

These are generated in `resolveClaudeAccess` (or a companion `resolveLaceEnv` function) and merged into `containerEnvSpecs`.

#### `.claude.local.md` Generation

A `postStartCommand` script writes runtime context to `.claude.local.md` in the workspace root. This file is gitignored by Claude Code and provides per-instance agent orientation:

The TypeScript code builds the shell command by substituting the container workspace folder and remote home path before assembling the heredoc. The heredoc delimiter is single-quoted (`'LOCALEOF'`) so that `$LACE_SSH_PORT` is written literally for agent runtime evaluation, not expanded at generation time:

```bash
# Example generated command (TypeScript substitutes /workspaces/lace and /home/node):
cat > /workspaces/lace/.claude.local.md << 'LOCALEOF'
## Lace Container Environment (auto-generated)

This project runs inside a lace-managed devcontainer.

- Container managed by: lace
- SSH port (host): check $LACE_SSH_PORT
- Plugins mount at: /mnt/lace/plugins/<name> (readonly unless overridden)
- Persistent Claude state: /home/node/.claude (bind-mounted from host)

To list available plugins: ls /mnt/lace/plugins/ 2>/dev/null
LOCALEOF
```

The concrete paths (`/workspaces/lace`, `/home/node`) are substituted by TypeScript string interpolation when `generateAgentContextCommand` builds the command. The `$LACE_SSH_PORT` reference is left as a literal shell variable for the agent to evaluate at runtime via `env`.

### Session Bridge

The session bridge creates a symlink in `~/.claude/projects/` that maps the container's path encoding to the host's path encoding. This allows Claude Code running inside the container to see host sessions natively.

```typescript
function generateSessionBridgeCommand(options: {
  hostWorkspacePath: string;
  containerWorkspacePath: string;
  remoteHome: string;
}): string {
  const hostEncoded = hostWorkspacePath.replace(/\//g, '-');
  const containerEncoded = containerWorkspacePath.replace(/\//g, '-');
  const projectsDir = `${remoteHome}/.claude/projects`;

  // Only create bridge if encodings differ
  if (hostEncoded === containerEncoded) return '';

  return `mkdir -p '${projectsDir}' && ln -sfn '${projectsDir}/${hostEncoded}' '${projectsDir}/${containerEncoded}' 2>/dev/null || true`;
}
```

The bridge is created via `postStartCommand` (not `postCreateCommand`) so it is refreshed on every container start, surviving `claude-clean` runs or manual deletion.

### User Experience

#### Project Author

```jsonc
// .devcontainer/devcontainer.json
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
        "sessionBridge": true
      }
    }
  }
}
```

#### Developer

```
$ lace up
Assigning port for wezterm SSH server...
Using port 22425
Resolving Claude Code access...
  Mounting ~/.claude -> /home/node/.claude (read-write)
  Adding feature ghcr.io/anthropics/devcontainer-features/claude-code:1
  Forwarding ANTHROPIC_API_KEY from host
  Session bridge: -var-home-mjr-code-weft-lace -> container encoding
Generating extended devcontainer.json...
Starting devcontainer...
```

Inside the container, `claude` is immediately available with host credentials.

#### Developer with Custom Config

```jsonc
// ~/.config/lace/settings.json
{
  "claude": {
    "configSource": "~/code/dev_records/weft/claude",
    "remoteUser": "node"
  }
}
```

## Important Design Decisions

### D1: Dedicated `customizations.lace.claude` Field (Not a Plugin)

**Decision:** Claude access is a first-class `customizations.lace.claude` field, not a git-repo plugin entry in `customizations.lace.plugins`.

**Why:** Claude access is fundamentally different from git-repo plugins. It does not have a `repoId`, does not require cloning, and generates features and env vars (not just mounts). Forcing it into the plugin abstraction would require extending `parseRepoId`, `ensurePlugin`, and `resolvePluginMounts` to handle a non-git case, contaminating the existing clean design. Report 2 (Section 7.2) analyzed both options and recommended Option A (dedicated field) for clarity and discoverability.

**Trade-off:** This creates a precedent where each managed integration gets its own top-level field. If a second managed integration arises (e.g., `customizations.lace.copilot`), the approach should be reconsidered in favor of a generalized `managedPlugins` mechanism.

### D2: Extend `generateExtendedConfig` In-Place

**Decision:** Extend the existing `generateExtendedConfig` function with new optional parameters rather than creating a separate config generation function.

**Why:** `generateExtendedConfig` is the single point where the extended devcontainer.json is assembled. Creating a parallel function would either duplicate the base config reading/writing logic or require extracting shared logic into a third function -- added complexity for no benefit. The function is already module-private (`up.ts`), so the interface change is internal-only.

### D3: `containerEnv` for Fixed Values, `remoteEnv` for Host-Forwarded Values

**Decision:** Use `containerEnv` for `CLAUDE_CONFIG_DIR` and `LACE_*` variables (known at config generation time). Use `remoteEnv` for `ANTHROPIC_API_KEY` (forwarded from host via `${localEnv:...}` syntax).

**Why:** Report 2 (Section 6.3) analyzed the distinction. `containerEnv` values are set at container creation and visible to all processes. `remoteEnv` values are set at attach time and only visible to the dev tool's process tree. Using `remoteEnv` for API keys limits credential exposure. `CLAUDE_CONFIG_DIR` must be `containerEnv` because it needs to be available during `postCreateCommand` execution.

### D4: Session Bridge via postStartCommand

**Decision:** Create the session bridge symlink in `postStartCommand`, not `postCreateCommand`.

**Why:** `postStartCommand` runs every time the container starts, not just on creation. The symlink lives on the bind-mounted `~/.claude/` filesystem and can be destroyed by `claude-clean` or manual deletion. Using `postStartCommand` ensures it is recreated on each start. The `ln -sfn` operation is idempotent and fast. Report 3 (Section 7.7 and Q5) recommended this approach.

### D5: Project-Declared Features Take Precedence

**Decision:** When merging features, the project's existing `features` object takes precedence over lace-injected features.

**Why:** If a project author explicitly declares the Claude Code feature with specific options, lace should not override that. The `{ ...featureSpecs, ...existing }` spread order ensures project declarations win. This matches devcontainer merge semantics where later/explicit values take precedence.

### D6: Warn-and-Skip When Host `~/.claude/` Missing

**Decision:** If `~/.claude/` does not exist on the host, skip the bind mount but still inject the feature and env vars.

**Why:** The user may want Claude Code installed in the container even without pre-existing credentials. They can run `claude login` inside the container. Failing hard would prevent legitimate use cases (new Claude users, API-key-only users). Report 2 (Section 8.4) specified this behavior.

### D7: LACE_* Environment Variables Bundled with Claude Access (Initially)

**Decision:** The `LACE_*` environment variables are generated as part of the claude access resolution for Phase 1. They can be extracted into a standalone function later.

**Why:** Pragmatism. The claude access pipeline already generates `containerEnvSpecs`. Adding `LACE_*` variables there is trivial. Creating a separate "lace awareness" module before there is a second consumer adds unnecessary abstraction. When a non-claude use case needs `LACE_*` variables, the extraction is straightforward.

## Edge Cases

### E1: macOS Host with Keychain-Stored Credentials

**Trigger:** macOS host where Claude Code stores credentials in the system Keychain, not `~/.claude/.credentials.json`.

**Behavior:** The `~/.claude/` directory exists but `.credentials.json` is absent or empty. The mount proceeds normally. Claude Code in the container will not find OAuth credentials.

**Guidance:** Log a message: `Info: On macOS hosts, Claude OAuth credentials are stored in the system Keychain and cannot be forwarded via bind mount. Use ANTHROPIC_API_KEY or run 'claude login' inside the container.` Recommend `ANTHROPIC_API_KEY` via `remoteEnv`.

### E2: No `remoteUser` in devcontainer.json

**Trigger:** devcontainer.json has no `remoteUser` or `containerUser` field.

**Behavior:** Default to `root`. Emit a prominent warning: `Warning: No remoteUser detected in devcontainer.json. Defaulting to 'root'. Mount target will be /root/.claude. If this is incorrect, set remoteUser in devcontainer.json or override in ~/.config/lace/settings.json under claude.remoteUser.`

**Why:** Defaulting to `root` is conservative. Common images (node:*, mcr.microsoft.com/devcontainers/*) use non-root users, but detecting the user from the Dockerfile/image is fragile. The warning plus settings override provides a clear remediation path.

### E3: `customizations.lace.claude` Set by Untrusted Project

**Trigger:** A cloned project includes `"customizations.lace.claude": true` in its devcontainer.json, causing `lace up` to mount the user's `~/.claude/` credentials.

**Behavior:** The mount proceeds. The user's credentials are exposed to the project's container.

**Mitigation:** This is analogous to any devcontainer configuration mounting host paths. The user trusts the devcontainer.json when they run `lace up`. For Phase 1, this is accepted as a known trade-off. A future enhancement could add a global opt-in requirement in `settings.json` (e.g., `"claude": { "enabled": true }`) before any project-level `customizations.lace.claude` takes effect. Report 2 (Section 9.1) flagged this and proposed the global opt-in as a stronger default.

### E4: Multiple Containers Sharing `~/.claude/`

**Trigger:** Multiple lace containers running for different projects, all mounting `~/.claude/`.

**Behavior:** All containers share credentials and session data. Claude Code uses UUID-based session files, so different sessions do not conflict. The session bridge symlinks are per-project (different path encodings), so they coexist.

**Risk:** Concurrent OAuth token refresh from multiple containers is theoretically possible but Claude Code handles this gracefully (last write wins for the refresh token).

### E5: `devcontainer up` Does Not Process Injected Features

**Trigger:** Features in the extended `.lace/devcontainer.json` are not processed because the devcontainer CLI caches feature installation from the initial build.

**Behavior:** Claude Code is not installed in the container despite being in the config.

**Mitigation:** Report 2 (Q1) flagged this as needing empirical verification. The extended config replaces the original config entirely when passed via `--config`, so features should be processed. If they are not, the fallback is to require the user to add the feature to their base devcontainer.json (two lines instead of one). Phase 2 includes a test for this.

### E6: Session Bridge with Identical Paths

**Trigger:** Host workspace path and container workspace path produce the same encoding (unlikely but possible, e.g., both are `/workspaces/lace`).

**Behavior:** `generateSessionBridgeCommand` detects identical encodings and returns an empty string. No symlink is created (none needed).

### E7: Settings `configSource` Points to Non-Existent Directory

**Trigger:** `~/.config/lace/settings.json` specifies `"configSource": "~/nonexistent/path"`.

**Behavior:** Warn and skip the mount, same as E1 fallback: `Warning: Claude configSource '~/nonexistent/path' does not exist. Skipping ~/.claude mount.` The feature and env vars are still injected.

## Implementation Phases

### Phase 1: Config Generation API Extension and Claude Extraction

**Goal:** Extend `generateExtendedConfig` to support all the config merging capabilities needed by the claude access plugin, add runtime user detection, and implement the Claude config extraction logic. This phase establishes both the generic API surface and the Claude-specific extraction/utility functions that Phase 2 will compose.

**Changes:**

1. **`packages/lace/src/lib/up.ts`**: Extend `GenerateExtendedConfigOptions` interface with `featureSpecs`, `containerEnvSpecs`, `remoteEnvSpecs`, `postStartCommands`, and `postCreateCommands`. Add merging blocks for each new field in `generateExtendedConfig`.

2. **`packages/lace/src/lib/claude-access.ts`** (new file): Implement `resolveRemoteUser`, `resolveRemoteHome`, and `extractClaudeAccess`. These are independently testable without the full claude resolution pipeline.

3. **`packages/lace/src/lib/settings.ts`**: Add `ClaudeUserSettings` interface and `claude` field to `LaceSettings`. Add tilde expansion for `configSource` in `readSettingsConfig`.

**Tests (`packages/lace/src/lib/__tests__/claude-access.test.ts`):**

| Scenario | Expected |
|----------|----------|
| `resolveRemoteUser` with explicit `remoteUser` | Returns the user |
| `resolveRemoteUser` with only `containerUser` | Returns containerUser |
| `resolveRemoteUser` with neither | Returns `'root'` |
| `resolveRemoteHome('node')` | Returns `/home/node` |
| `resolveRemoteHome('root')` | Returns `/root` |
| `extractClaudeAccess` with `true` | Returns `{ kind: 'enabled', config: true }` |
| `extractClaudeAccess` with options object | Returns `{ kind: 'enabled', config: { ... } }` |
| `extractClaudeAccess` with `false` | Returns `{ kind: 'disabled' }` |
| `extractClaudeAccess` absent | Returns `{ kind: 'absent' }` |

**Tests (`packages/lace/src/lib/__tests__/up-extended-config.test.ts`):**

| Scenario | Expected |
|----------|----------|
| Features merging (empty original) | Features injected |
| Features merging (existing features preserved) | Original features take precedence |
| containerEnv merging | Vars merged, original precedence |
| remoteEnv merging | Vars merged, original precedence |
| postStartCommand merging (none existing) | Command set |
| postStartCommand merging (existing string) | Commands joined |
| postStartCommand merging (existing object) | New entries added |
| Additional postCreateCommand entries | Merged into existing |

**Tests (`packages/lace/src/lib/__tests__/settings-claude.test.ts`):**

| Scenario | Expected |
|----------|----------|
| Settings with `claude` section | Parsed correctly |
| Settings with `claude.configSource` tilde | Path expanded |
| Settings without `claude` section | Returns `{}` for claude |

**Success criteria:** `generateExtendedConfig` can produce a devcontainer.json that includes all of: mounts, features, containerEnv, remoteEnv, postCreateCommand, postStartCommand, and appPort. All new utility functions pass their unit tests.

**Dependencies:** None. This phase modifies internals only.

### Phase 2: Claude Access Managed Plugin

**Goal:** Implement `resolveClaudeAccess` and wire it into `runUp` so that `"customizations.lace.claude": true` produces a working container with Claude Code.

**Changes:**

1. **`packages/lace/src/lib/claude-access.ts`**: Implement `resolveClaudeAccess`. This is the core function that takes the parsed devcontainer config and settings, and produces `ClaudeAccessResult` with all mount specs, feature specs, env specs, and commands.

2. **`packages/lace/src/lib/up.ts`**: Add Phase 2.5 in `runUp` that calls `resolveClaudeAccess` when `extractClaudeAccess` returns `enabled`. Pass the resulting specs to `generateExtendedConfig`.

3. **Console output**: Add informational logging during Phase 2.5 (what is being mounted, what features are being added, what env vars are being forwarded).

**Tests (`packages/lace/src/lib/__tests__/claude-access-resolve.test.ts`):**

| Scenario | Expected |
|----------|----------|
| `claude: true`, host `~/.claude` exists | Mount spec, feature spec, containerEnv, remoteEnv all generated |
| `claude: true`, host `~/.claude` missing | No mount spec, feature still injected, warning logged |
| `claude: { mountMcpConfig: true }` | Additional `~/.claude.json` mount (readonly) |
| `claude: true` with settings `configSource` | Uses settings source instead of `~/.claude` |
| `claude: true` with settings `remoteUser` | Uses settings remoteUser override |
| `claude: true` with settings `forwardApiKey: false` | No `ANTHROPIC_API_KEY` in remoteEnv |
| `claude: true` with settings `disableTelemetry: true` | `DISABLE_TELEMETRY=1` in containerEnv |
| remoteUser detection from devcontainer.json | Correct mount target paths |
| `claude: { mountMcpConfig: false }` with settings `mountMcpConfig: true` | Settings wins: MCP config mounted |
| `claude: true` with settings `forwardApiKey: false` | Settings wins: no `ANTHROPIC_API_KEY` in remoteEnv |

**Tests (`packages/lace/src/commands/__tests__/up-claude.integration.test.ts`):**

| Scenario | Expected |
|----------|----------|
| Full `lace up` with `claude: true` | Extended config includes features, mounts, envs |
| `lace up` with `claude: true` and plugins | Both claude mounts and plugin mounts present |
| `lace up` with `claude: false` | No claude-related config injected |
| `lace up` with no claude config | Standard behavior unchanged |

**Manual verification:**
1. Create a test devcontainer.json with `"customizations.lace.claude": true`.
2. Run `lace up --skip-devcontainer-up` (or equivalent dry-run).
3. Inspect `.lace/devcontainer.json` for correct features, mounts, containerEnv, remoteEnv.
4. Verify the feature spec is `ghcr.io/anthropics/devcontainer-features/claude-code:1`.
5. Verify mount source is the host `~/.claude/` path.
6. Verify mount target uses the correct `remoteUser` home.
7. Run `devcontainer up` with the generated config and verify `claude --version` works inside the container.

**Success criteria:** `"customizations.lace.claude": true` in devcontainer.json produces a container where `claude` CLI is available and authenticated with host credentials. The generated `.lace/devcontainer.json` contains all expected fields.

**Dependencies:** Phase 1 (API extension).

### Phase 3: Session Bridge and LACE_* Environment Variables

**Goal:** Add the session bridge symlink for cross-context session portability and inject `LACE_*` environment variables for agent and developer orientation.

**Changes:**

1. **`packages/lace/src/lib/claude-access.ts`**: Implement `generateSessionBridgeCommand`. Derive the container workspace path from `raw.workspaceFolder` or the devcontainer default convention (`/workspaces/${basename}`). Generate the `ln -sfn` command mapping container encoding to host encoding in `~/.claude/projects/`.

2. **`packages/lace/src/lib/claude-access.ts`**: Add `LACE_*` environment variables to `containerEnvSpecs` in `resolveClaudeAccess`. The variables are: `LACE_MANAGED`, `LACE_PROJECT_NAME`, `LACE_WORKSPACE_ROOT`, `LACE_SSH_PORT`, `LACE_HOST_WORKSPACE`.

3. **`packages/lace/src/lib/up.ts`**: Pass the port result to `resolveClaudeAccess` so it can include `LACE_SSH_PORT`.

**Tests (`packages/lace/src/lib/__tests__/claude-access-bridge.test.ts`):**

| Scenario | Expected |
|----------|----------|
| Host `/var/home/mjr/code/weft/lace`, container `/workspaces/lace` | Symlink from `-workspaces-lace` to `-var-home-mjr-code-weft-lace` |
| Host and container paths identical | Empty command (no symlink needed) |
| Container workspace from `raw.workspaceFolder` | Uses explicit value |
| Container workspace default derivation | `/workspaces/${basename(hostPath)}` |
| Path encoding preserves leading dash | Encoded paths start with `-` |
| `LACE_*` variables in containerEnvSpecs | All expected vars present with correct values |
| `LACE_SSH_PORT` with port 22430 | Value is `"22430"` |

**Success criteria:** The session bridge symlink is created on container start. Host sessions are visible when running `claude` inside the container (manual verification). `LACE_*` environment variables are present in the container (`env | grep LACE_`).

**Dependencies:** Phase 2 (claude access pipeline must be working).

### Phase 4: Agent Awareness -- `.claude.local.md` Generation

**Goal:** Generate `.claude.local.md` with runtime context so Claude Code agents can self-orient in lace containers.

**Changes:**

1. **`packages/lace/src/lib/claude-access.ts`**: Implement `generateAgentContextCommand` that produces a shell command to write `.claude.local.md` in the workspace root. The content includes: lace container identification, SSH port, plugin mount prefix, persistent state location, and key commands.

2. **Integration in `resolveClaudeAccess`**: Add the agent context command to `postStartCommands`.

**Tests (`packages/lace/src/lib/__tests__/claude-access-agent.test.ts`):**

| Scenario | Expected |
|----------|----------|
| Agent context command generation | Valid shell command that writes `.claude.local.md` |
| Content includes lace identification | "lace-managed devcontainer" present |
| Content references `$LACE_SSH_PORT` | Variable reference (not expanded) present |
| Content references plugin mount path | `/mnt/lace/plugins/` present |
| Command writes to correct workspace path | Uses container workspace folder |

**Success criteria:** `.claude.local.md` is generated on container start. Claude Code agents receive the environment context at session start. Manual verification: start a Claude session inside the container, ask "what environment am I in?", and verify the agent can answer correctly based on the context.

**Dependencies:** Phase 3 (LACE_* variables must be available for the context to reference them).

## Test Plan Summary

### Unit Tests (per Phase)

| Module | Test File | Test Count (est.) |
|--------|-----------|-------------------|
| claude-access (extraction, user detection) | `claude-access.test.ts` | ~10 |
| up.ts extended config | `up-extended-config.test.ts` | ~8 |
| settings claude extension | `settings-claude.test.ts` | ~3 |
| claude-access resolve | `claude-access-resolve.test.ts` | ~8 |
| session bridge | `claude-access-bridge.test.ts` | ~7 |
| agent context | `claude-access-agent.test.ts` | ~5 |

### Integration Tests

| Module | Test File | Test Count (est.) |
|--------|-----------|-------------------|
| lace up with claude | `up-claude.integration.test.ts` | ~4 |

### Manual Verification Checklist

- [ ] `lace up` with `claude: true` produces working Claude Code in container
- [ ] Host credentials are available (OAuth or API key)
- [ ] Session bridge symlink is present in `~/.claude/projects/`
- [ ] Host sessions are visible from inside the container
- [ ] `LACE_*` environment variables are set
- [ ] `.claude.local.md` is generated in workspace root
- [ ] Claude agent can self-orient when asked about environment
- [ ] Existing plugin mounts still work alongside claude access
- [ ] No regressions in `pnpm test`

## Resolved Questions

> NOTE: These questions were surfaced during Phase 4 (User Clarification) and resolved with user input on 2026-02-05.

### Q1: No global opt-in required (Resolved)

**Decision:** Match the standard devcontainer trust model. No global opt-in in settings.json is required. The user trusts the devcontainer config when they run `lace up`. Revisit if adoption widens beyond the current single-user context.

### Q2: Feature injection verified inline in Phase 2 (Resolved)

**Decision:** Empirical verification of feature injection via extended configs is the first task of Phase 2. If `devcontainer up --config` does not process injected features, the fallback is requiring users to add the feature to their base devcontainer.json (two lines instead of one).

### Q3: Claude-only initially, extract later (Resolved)

**Decision:** `LACE_*` environment variables and `.claude.local.md` generation are bundled with claude access initially. Extract into a standalone "lace awareness" feature in a follow-up if a non-claude use case arises. A more detailed specification of `.claude.local.md` content and project-level customization will be covered in the detailed implementation proposal.

### Q4: Install claude-tools from source; plan devcontainer feature long-term (Resolved)

**Decision:** The `installClaudeTools` flag is actively implemented (not dormant). The initial approach installs claude-tools from source via `postCreateCommand` (OCaml/opam build). Long-term, claude-tools should be bundled in its own devcontainer feature (analogous to the wezterm server feature at `ghcr.io/weftwiseink/devcontainer-features/wezterm-server`). This changes the scope: Phase 3 now includes claude-tools source installation alongside the session bridge.

## Related Documents

- **Plugin System Proposal:** `cdocs/proposals/2026-02-04-lace-plugins-system.md` (status: implementation_complete)
- **Report 1 -- Plugin System State:** `cdocs/reports/2026-02-05-lace-plugin-system-state.md`
- **Report 2 -- Claude Devcontainer Bundling:** `cdocs/reports/2026-02-05-claude-devcontainer-bundling.md`
- **Report 3 -- Claude-Tools Streamlining:** `cdocs/reports/2026-02-05-claude-tools-streamlining.md`
- **Report 4 -- Agent Situational Awareness:** `cdocs/reports/2026-02-05-agent-situational-awareness.md`
- **RFP: Plugin Host Setup:** `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md`
- **RFP: Plugin Conditional Loading:** `cdocs/proposals/2026-02-04-rfp-plugin-conditional-loading.md`
