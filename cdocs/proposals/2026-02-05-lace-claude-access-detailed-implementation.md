---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T20:00:00-08:00
type: proposal
state: evolved
status: review_ready
superseded_by: cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md
tags: [lace, claude-code, managed-plugins, implementation, devcontainer, mounts, features, agent-awareness, subagent-ready]
---

# Lace Claude Access: Detailed Implementation Proposal

> **BLUF:** Line-level implementation spec for the claude access feature designed in the mid-level proposal. Four phases: (1) extend `generateExtendedConfig` + create `claude-access.ts`, (2) wire `resolveClaudeAccess` into `runUp`, (3) session bridge + `LACE_*` vars + claude-tools, (4) `.claude.local.md` generation. ~64 tests total. Structured for subagent-driven development with explicit phase dependencies.

## Objective

Translate the mid-level proposal's design into implementation-ready specifications that a developer or subagent can execute phase-by-phase without needing to make design decisions. Every function signature, type definition, merge strategy, and test case should be fully specified.

## Background

### Source Documents

- **Mid-level proposal:** `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md` (status: review_ready, revised round 1)
- **Self-review:** `cdocs/reviews/2026-02-05-review-of-lace-mount-enabled-claude-plugin.md` (status: done)
- **Executive summary:** `cdocs/reports/2026-02-05-mount-plugin-workstream-executive-summary.md`
- **Research reports:** Claude devcontainer bundling, claude-tools streamlining, agent situational awareness

### Resolved Decisions from User Clarification (Phase 4)

1. **No global opt-in** for credential mounting -- match standard devcontainer trust model.
2. **Feature injection verification** is the first task of Phase 2, inline.
3. **LACE_* vars and .claude.local.md** are claude-only initially; extract later if needed.
4. **claude-tools** installed from source via `postCreateCommand` (OCaml/opam build). Long-term goal is a devcontainer feature. The `installClaudeTools` flag is actively implemented.

### Key Source Files (Current State)

| File | Lines | Role |
|------|-------|------|
| `packages/lace/src/lib/up.ts` | 344 | `runUp` orchestration, `generateExtendedConfig` (L243-311) |
| `packages/lace/src/lib/devcontainer.ts` | 342 | Config parsing, `extractPlugins` discriminated-union pattern |
| `packages/lace/src/lib/mounts.ts` | 331 | Mount resolution, `generateMountSpec` |
| `packages/lace/src/lib/settings.ts` | 143 | User settings, `LaceSettings`, path expansion |
| `packages/lace/src/lib/plugin-clones.ts` | 210 | `deriveProjectId` utility |
| `packages/lace/src/lib/resolve-mounts.ts` | 210 | Orchestration pattern reference |

## Proposed Solution

### Phase 1: Config Generation API Extension + Claude Extraction Utilities

#### 1.1 Extend `GenerateExtendedConfigOptions` in `up.ts`

**File:** `packages/lace/src/lib/up.ts`
**Location:** Lines 229-234 (current `GenerateExtendedConfigOptions` interface)

Replace the current interface:

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
  postCreateCommands?: string[];
}
```

#### 1.2 Add Feature Merging Block in `generateExtendedConfig`

**File:** `packages/lace/src/lib/up.ts`
**Location:** After the mounts merging block (after current L268), before postCreateCommand handling.

```typescript
// Add features (project-declared features take precedence)
if (featureSpecs && Object.keys(featureSpecs).length > 0) {
  const existing = (original.features ?? {}) as Record<string, unknown>;
  extended.features = { ...featureSpecs, ...existing };
}
```

**Merge semantics:** Spread order `{ ...featureSpecs, ...existing }` ensures project-declared features override lace-injected features when the same feature key exists. If the project already has `ghcr.io/anthropics/devcontainer-features/claude-code:1` with custom options, those options are preserved.

#### 1.3 Add containerEnv Merging Block

**File:** `packages/lace/src/lib/up.ts`
**Location:** After features merging block.

```typescript
// Add containerEnv (project-declared vars take precedence)
if (containerEnvSpecs && Object.keys(containerEnvSpecs).length > 0) {
  const existing = (original.containerEnv ?? {}) as Record<string, string>;
  extended.containerEnv = { ...containerEnvSpecs, ...existing };
}
```

#### 1.4 Add remoteEnv Merging Block

**File:** `packages/lace/src/lib/up.ts`
**Location:** After containerEnv merging block.

```typescript
// Add remoteEnv (project-declared vars take precedence)
if (remoteEnvSpecs && Object.keys(remoteEnvSpecs).length > 0) {
  const existing = (original.remoteEnv ?? {}) as Record<string, string>;
  extended.remoteEnv = { ...remoteEnvSpecs, ...existing };
}
```

#### 1.5 Add postStartCommand Merging Block (Object Normalization)

**File:** `packages/lace/src/lib/up.ts`
**Location:** After remoteEnv merging block, before the port mapping block.

This is the most complex merge. The strategy is: **always normalize to object format** when lace needs to inject commands. This avoids string concatenation quoting issues.

```typescript
// Add postStartCommand entries (always normalize to object format)
if (postStartCommands && postStartCommands.length > 0) {
  const lacePostStart: Record<string, unknown> = {};
  postStartCommands.forEach((cmd, i) => {
    lacePostStart[`lace-post-start-${i}`] = ["sh", "-c", cmd];
  });

  const existing = original.postStartCommand;
  if (!existing) {
    extended.postStartCommand = lacePostStart;
  } else if (typeof existing === "string") {
    extended.postStartCommand = { original: existing, ...lacePostStart };
  } else if (Array.isArray(existing)) {
    extended.postStartCommand = { original: existing, ...lacePostStart };
  } else if (typeof existing === "object") {
    extended.postStartCommand = {
      ...(existing as Record<string, unknown>),
      ...lacePostStart,
    };
  }
}
```

**Format conversion cases:**

| Original Format | Example | Resulting Format |
|----------------|---------|-----------------|
| Absent/undefined | `undefined` | `{ "lace-post-start-0": ["sh", "-c", cmd0], ... }` |
| String | `"echo hello"` | `{ "original": "echo hello", "lace-post-start-0": ["sh", "-c", cmd0], ... }` |
| Array | `["echo", "hello"]` | `{ "original": ["echo", "hello"], "lace-post-start-0": ["sh", "-c", cmd0], ... }` |
| Object | `{ "setup": "echo hello" }` | `{ "setup": "echo hello", "lace-post-start-0": ["sh", "-c", cmd0], ... }` |

#### 1.6 Add Additional postCreateCommand Entries

**File:** `packages/lace/src/lib/up.ts`
**Location:** Within the existing postCreateCommand merging block (current L271-289), extended to handle the new `postCreateCommands` array.

The existing postCreateCommand merging handles a single `symlinkCommand`. The extension appends additional commands from `postCreateCommands`. For each additional command, the same merge strategy applies:

```typescript
// After the existing symlinkCommand merging...
// Add additional postCreateCommand entries (e.g., claude-tools install)
if (postCreateCommands && postCreateCommands.length > 0) {
  // Normalize to object format for clean multi-command composition,
  // matching the postStartCommand approach from section 1.5.
  const lacePostCreate: Record<string, unknown> = {};
  postCreateCommands.forEach((cmd, i) => {
    lacePostCreate[`lace-post-create-${i}`] = ["sh", "-c", cmd];
  });

  const current = extended.postCreateCommand ?? original.postCreateCommand;
  if (!current) {
    extended.postCreateCommand = lacePostCreate;
  } else if (typeof current === "string") {
    extended.postCreateCommand = { original: current, ...lacePostCreate };
  } else if (Array.isArray(current)) {
    extended.postCreateCommand = { original: current, ...lacePostCreate };
  } else if (typeof current === "object") {
    extended.postCreateCommand = {
      ...(current as Record<string, unknown>),
      ...lacePostCreate,
    };
  }
}
```

> NOTE: This normalization to object format is a deliberate departure from the existing `symlinkCommand` merge pattern (which uses string concatenation with `&&`). The object format avoids the known quoting issue with array-format commands and is consistent with the `postStartCommand` approach in section 1.5. The existing `symlinkCommand` merge is left unchanged for backwards compatibility; a follow-up could migrate it to object format as well.

#### 1.7 Create `claude-access.ts` with Extraction and Utility Functions

**File:** `packages/lace/src/lib/claude-access.ts` (new)

```typescript
// packages/lace/src/lib/claude-access.ts

import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { LaceSettings } from "./settings";

// --- Types ---

/** Claude access configuration from devcontainer.json */
export type ClaudeAccessConfig =
  | boolean
  | {
      mountMcpConfig?: boolean;
      installClaudeTools?: boolean;
      sessionBridge?: boolean;
    };

/** Result of claude access resolution */
export interface ClaudeAccessResult {
  mountSpecs: string[];
  featureSpecs: Record<string, Record<string, unknown>>;
  containerEnvSpecs: Record<string, string>;
  remoteEnvSpecs: Record<string, string>;
  postStartCommands: string[];
  postCreateCommands: string[];
}

/** Discriminated-union extraction result */
export type ClaudeAccessExtraction =
  | { kind: "enabled"; config: ClaudeAccessConfig }
  | { kind: "absent" }
  | { kind: "disabled" };

// --- Extraction ---

/**
 * Extract claude access configuration from parsed devcontainer.json.
 * Follows the same discriminated-union pattern as extractPlugins.
 */
export function extractClaudeAccess(
  raw: Record<string, unknown>,
): ClaudeAccessExtraction {
  const customizations = raw.customizations as
    | Record<string, unknown>
    | undefined;
  if (!customizations) return { kind: "absent" };

  const lace = customizations.lace as Record<string, unknown> | undefined;
  if (!lace) return { kind: "absent" };

  if (!("claude" in lace)) return { kind: "absent" };

  const claude = lace.claude;
  if (claude === false) return { kind: "disabled" };
  if (claude === null) return { kind: "disabled" };

  return {
    kind: "enabled",
    config: claude as ClaudeAccessConfig,
  };
}

// --- User Detection ---

/**
 * Resolve the container's remote user from devcontainer.json.
 * Resolution order: remoteUser > containerUser > 'root'.
 * Callers should emit a warning when the result is 'root' (default fallback).
 */
export function resolveRemoteUser(raw: Record<string, unknown>): string {
  if (typeof raw.remoteUser === "string") return raw.remoteUser;
  if (typeof raw.containerUser === "string") return raw.containerUser;
  return "root";
}

/**
 * Resolve the home directory for a remote user.
 */
export function resolveRemoteHome(remoteUser: string): string {
  if (remoteUser === "root") return "/root";
  return `/home/${remoteUser}`;
}

// --- Container Workspace Derivation ---

/**
 * Derive the container workspace folder from devcontainer.json or
 * fall back to the devcontainer default convention.
 */
export function deriveContainerWorkspaceFolder(
  raw: Record<string, unknown>,
  hostWorkspaceFolder: string,
): string {
  if (typeof raw.workspaceFolder === "string") {
    return raw.workspaceFolder;
  }
  return `/workspaces/${basename(hostWorkspaceFolder)}`;
}
```

#### 1.8 Extend `LaceSettings` with `claude` Field

**File:** `packages/lace/src/lib/settings.ts`

Add after the `PluginSettings` interface (after current L28):

```typescript
/** User-level Claude access settings. */
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

Modify the `LaceSettings` interface (current L10-14):

```typescript
export interface LaceSettings {
  plugins?: {
    [repoId: string]: PluginSettings;
  };
  claude?: ClaudeUserSettings;
}
```

Add tilde expansion for `configSource` in `readSettingsConfig` (after the existing plugin path expansion block, current L117-126):

```typescript
// Expand paths in claude settings
if (raw.claude?.configSource) {
  raw.claude.configSource = resolveSettingsPath(raw.claude.configSource);
}
```

#### 1.9 Phase 1 Test Specifications

**Test file:** `packages/lace/src/lib/__tests__/claude-access.test.ts` (new)

```typescript
// Tests for extractClaudeAccess
describe("extractClaudeAccess", () => {
  it("returns enabled with boolean true", () => {
    const raw = { customizations: { lace: { claude: true } } };
    const result = extractClaudeAccess(raw);
    expect(result).toEqual({ kind: "enabled", config: true });
  });

  it("returns enabled with options object", () => {
    const raw = {
      customizations: {
        lace: { claude: { mountMcpConfig: true, sessionBridge: false } },
      },
    };
    const result = extractClaudeAccess(raw);
    expect(result).toEqual({
      kind: "enabled",
      config: { mountMcpConfig: true, sessionBridge: false },
    });
  });

  it("returns disabled when claude is false", () => {
    const raw = { customizations: { lace: { claude: false } } };
    expect(extractClaudeAccess(raw)).toEqual({ kind: "disabled" });
  });

  it("returns disabled when claude is null", () => {
    const raw = { customizations: { lace: { claude: null } } };
    expect(extractClaudeAccess(raw)).toEqual({ kind: "disabled" });
  });

  it("returns absent when customizations missing", () => {
    expect(extractClaudeAccess({})).toEqual({ kind: "absent" });
  });

  it("returns absent when lace missing", () => {
    expect(extractClaudeAccess({ customizations: { vscode: {} } })).toEqual({
      kind: "absent",
    });
  });

  it("returns absent when claude key missing", () => {
    expect(
      extractClaudeAccess({ customizations: { lace: { plugins: {} } } }),
    ).toEqual({ kind: "absent" });
  });
});

// Tests for resolveRemoteUser
describe("resolveRemoteUser", () => {
  it("returns explicit remoteUser", () => {
    expect(resolveRemoteUser({ remoteUser: "node" })).toBe("node");
  });

  it("falls back to containerUser", () => {
    expect(resolveRemoteUser({ containerUser: "vscode" })).toBe("vscode");
  });

  it("prefers remoteUser over containerUser", () => {
    expect(
      resolveRemoteUser({ remoteUser: "node", containerUser: "vscode" }),
    ).toBe("node");
  });

  it("defaults to root when neither is set", () => {
    expect(resolveRemoteUser({})).toBe("root");
  });
});

// Tests for resolveRemoteHome
describe("resolveRemoteHome", () => {
  it("returns /root for root user", () => {
    expect(resolveRemoteHome("root")).toBe("/root");
  });

  it("returns /home/<user> for non-root users", () => {
    expect(resolveRemoteHome("node")).toBe("/home/node");
    expect(resolveRemoteHome("vscode")).toBe("/home/vscode");
  });
});

// Tests for deriveContainerWorkspaceFolder
describe("deriveContainerWorkspaceFolder", () => {
  it("uses explicit workspaceFolder from devcontainer.json", () => {
    const raw = { workspaceFolder: "/workspace/main" };
    expect(deriveContainerWorkspaceFolder(raw, "/var/home/mjr/code/weft/lace")).toBe(
      "/workspace/main",
    );
  });

  it("derives default from host path basename", () => {
    expect(
      deriveContainerWorkspaceFolder({}, "/var/home/mjr/code/weft/lace"),
    ).toBe("/workspaces/lace");
  });

  it("handles host path with trailing slash", () => {
    expect(
      deriveContainerWorkspaceFolder({}, "/var/home/mjr/code/weft/lace/"),
    ).toBe("/workspaces/lace");
  });
});
```

**Test file:** `packages/lace/src/lib/__tests__/up-extended-config.test.ts` (new)

This test file validates the new merging blocks in `generateExtendedConfig` by calling the exported function directly. Each test creates a temp workspace directory with a devcontainer.json containing the desired original fields, calls `generateExtendedConfig` with the new spec parameters, and reads back the generated `.lace/devcontainer.json` to verify merge results.

```
Test cases (input devcontainer.json -> expected output in .lace/devcontainer.json):

1. Features merging (empty original):
   Input: no features field, featureSpecs: { "ghcr.io/.../claude-code:1": {} }
   Expected: extended.features = { "ghcr.io/.../claude-code:1": {} }

2. Features merging (project features preserved):
   Input: features: { "ghcr.io/.../claude-code:1": { "version": "custom" } }
   featureSpecs: { "ghcr.io/.../claude-code:1": {} }
   Expected: extended.features["ghcr.io/.../claude-code:1"] = { "version": "custom" }

3. Features merging (both present, different keys):
   Input: features: { "ghcr.io/devcontainers/features/git:1": {} }
   featureSpecs: { "ghcr.io/.../claude-code:1": {} }
   Expected: both features present

4. containerEnv merging (empty original):
   Input: no containerEnv, containerEnvSpecs: { "CLAUDE_CONFIG_DIR": "/home/node/.claude" }
   Expected: extended.containerEnv = { "CLAUDE_CONFIG_DIR": "/home/node/.claude" }

5. containerEnv merging (project vars preserved):
   Input: containerEnv: { "CLAUDE_CONFIG_DIR": "/custom" }
   containerEnvSpecs: { "CLAUDE_CONFIG_DIR": "/home/node/.claude" }
   Expected: extended.containerEnv.CLAUDE_CONFIG_DIR = "/custom"

6. remoteEnv merging:
   Input: no remoteEnv, remoteEnvSpecs: { "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}" }
   Expected: extended.remoteEnv = { "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}" }

7. postStartCommand merging (none existing):
   Input: no postStartCommand, postStartCommands: ["cmd1"]
   Expected: extended.postStartCommand = { "lace-post-start-0": ["sh", "-c", "cmd1"] }

8. postStartCommand merging (existing string):
   Input: postStartCommand: "echo hello", postStartCommands: ["cmd1"]
   Expected: extended.postStartCommand = { "original": "echo hello", "lace-post-start-0": ["sh", "-c", "cmd1"] }

9. postStartCommand merging (existing array):
   Input: postStartCommand: ["echo", "hello"], postStartCommands: ["cmd1"]
   Expected: extended.postStartCommand = { "original": ["echo", "hello"], "lace-post-start-0": ["sh", "-c", "cmd1"] }

10. postStartCommand merging (existing object):
    Input: postStartCommand: { "setup": "echo hello" }, postStartCommands: ["cmd1"]
    Expected: extended.postStartCommand = { "setup": "echo hello", "lace-post-start-0": ["sh", "-c", "cmd1"] }

11. postStartCommand merging (multiple lace commands):
    Input: no postStartCommand, postStartCommands: ["bridge-cmd", "context-cmd"]
    Expected: extended.postStartCommand = {
      "lace-post-start-0": ["sh", "-c", "bridge-cmd"],
      "lace-post-start-1": ["sh", "-c", "context-cmd"]
    }

12. Additional postCreateCommand entries (string original, no symlink):
    Input: postCreateCommand: "echo existing", postCreateCommands: ["install-cmd"], symlinkCommand: null
    Expected: extended.postCreateCommand = { "original": "echo existing", "lace-post-create-0": ["sh", "-c", "install-cmd"] }
    NOTE: symlinkCommand is null in this test so the symlink merge block does not modify
    extended.postCreateCommand before the postCreateCommands merge runs. If symlinkCommand
    were non-null, the intermediate state after the symlink merge would be
    "echo existing && symlink-cmd" (string concatenation), and the postCreateCommands merge
    would then normalize that concatenated string into object format as { "original": "echo existing && symlink-cmd", "lace-post-create-0": ... }.

13. Additional postCreateCommand entries (no original, no symlink):
    Input: no postCreateCommand, postCreateCommands: ["install-cmd"]
    Expected: extended.postCreateCommand = { "lace-post-create-0": ["sh", "-c", "install-cmd"] }
```

> NOTE: Per design decision D1, `generateExtendedConfig` is exported from `up.ts` for direct unit testing. These tests call `generateExtendedConfig` directly with a temp workspace directory, providing the desired original devcontainer.json content and the new spec fields. This avoids the overhead of full `runUp` integration test setup (mock subprocess, port assignment, etc.) and focuses purely on the merge logic.

**Test file:** `packages/lace/src/lib/__tests__/settings.test.ts` (extend existing)

Add to the existing `readSettingsConfig` describe block:

```
13. Settings with claude section parsed correctly:
    Input: { "claude": { "remoteUser": "node", "configSource": "/custom/path" } }
    Expected: result.claude.remoteUser === "node", result.claude.configSource === "/custom/path"

14. Settings with claude.configSource tilde expansion:
    Input: { "claude": { "configSource": "~/code/claude-config" } }
    Expected: result.claude.configSource === join(homedir(), "code/claude-config")

15. Settings without claude section:
    Input: { "plugins": {} }
    Expected: result.claude === undefined
```

#### 1.10 Phase 1 Dependencies and Constraints

**Dependencies:** None. Phase 1 modifies only internal interfaces.

**Constraints:**
- Do NOT modify `runUp` orchestration flow (that is Phase 2).
- Do NOT call `resolveClaudeAccess` (that does not exist yet).
- The new `generateExtendedConfig` options are all optional -- existing callers continue to work without changes.
- Existing tests MUST continue to pass with zero modifications.

**Success Criteria:**
1. `generateExtendedConfig` accepts and correctly merges all new field types.
2. The `extractClaudeAccess` function correctly handles all discriminated-union cases.
3. `resolveRemoteUser` and `resolveRemoteHome` produce correct results for all user scenarios.
4. `deriveContainerWorkspaceFolder` correctly handles explicit and default workspace folders.
5. `LaceSettings` type includes `claude?: ClaudeUserSettings`.
6. Tilde expansion works for `configSource` in settings.
7. All existing tests pass without modification (`pnpm test`).

---

### Phase 2: Claude Access Managed Plugin (End-to-End)

#### 2.1 First Task: Empirical Feature Injection Verification

Before implementing the full resolution pipeline, verify that `devcontainer up --config .lace/devcontainer.json` processes features from the extended config. Create a minimal test:

1. Write a `.lace/devcontainer.json` with `"features": { "ghcr.io/devcontainers/features/git:1": {} }` and a base image.
2. Run `devcontainer up --config .lace/devcontainer.json --workspace-folder .`.
3. Verify the feature was installed (e.g., `git --version` returns a version).

If this fails, the fallback approach is to document that users must add the Claude Code feature to their base `devcontainer.json`. The rest of the implementation proceeds unchanged (mounts, env vars, session bridge all still work through extended config).

#### 2.2 Implement `resolveClaudeAccess`

**File:** `packages/lace/src/lib/claude-access.ts`

Add the following function to the existing module:

```typescript
/**
 * Resolve all claude access configuration into concrete specs.
 */
export function resolveClaudeAccess(options: {
  raw: Record<string, unknown>;
  config: ClaudeAccessConfig;
  settings: LaceSettings;
  workspaceFolder: string;
  sshPort?: number;
}): ClaudeAccessResult {
  const { raw, config, settings, workspaceFolder, sshPort } = options;

  // 1. Resolve remote user (settings override takes precedence)
  const remoteUser = settings.claude?.remoteUser ?? resolveRemoteUser(raw);
  const remoteHome = resolveRemoteHome(remoteUser);

  // 1a. Warn when defaulting to root (see mid-level proposal E2)
  if (remoteUser === "root" && !settings.claude?.remoteUser) {
    console.warn(
      `Warning: No remoteUser detected in devcontainer.json. Defaulting to 'root'. ` +
        `Mount target will be /root/.claude. If this is incorrect, set remoteUser ` +
        `in devcontainer.json or override in ~/.config/lace/settings.json under claude.remoteUser.`,
    );
  }

  // 2. Resolve host claude directory
  const hostClaudeDir =
    settings.claude?.configSource ?? join(homedir(), ".claude");

  // 3. Resolve options (settings override > project config > defaults)
  const projectConfig = typeof config === "object" ? config : {};
  const mountMcpConfig =
    settings.claude?.mountMcpConfig ?? projectConfig.mountMcpConfig ?? false;
  const installClaudeTools =
    projectConfig.installClaudeTools ?? false;
  const sessionBridge =
    projectConfig.sessionBridge ?? true;
  const forwardApiKey = settings.claude?.forwardApiKey ?? true;
  const disableTelemetry = settings.claude?.disableTelemetry ?? false;

  // 4. Generate mount specs
  const mountSpecs: string[] = [];
  if (existsSync(hostClaudeDir)) {
    mountSpecs.push(
      `type=bind,source=${hostClaudeDir},target=${remoteHome}/.claude`,
    );
  } else {
    console.log(
      `Info: ${hostClaudeDir} not found on host. Skipping ~/.claude mount. ` +
        `Claude will require in-container authentication.`,
    );
  }

  if (mountMcpConfig) {
    const hostMcpConfig = join(homedir(), ".claude.json");
    if (existsSync(hostMcpConfig)) {
      mountSpecs.push(
        `type=bind,source=${hostMcpConfig},target=${remoteHome}/.claude.json,readonly`,
      );
    }
  }

  // 5. Generate feature specs
  const featureSpecs: Record<string, Record<string, unknown>> = {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
  };

  // 6. Generate containerEnv
  const containerEnvSpecs: Record<string, string> = {
    CLAUDE_CONFIG_DIR: `${remoteHome}/.claude`,
  };
  if (disableTelemetry) {
    containerEnvSpecs.DISABLE_TELEMETRY = "1";
  }

  // 7. Generate remoteEnv
  const remoteEnvSpecs: Record<string, string> = {};
  if (forwardApiKey) {
    remoteEnvSpecs.ANTHROPIC_API_KEY = "${localEnv:ANTHROPIC_API_KEY}";
  }

  // 8. Generate postStartCommands (populated in Phase 3)
  const postStartCommands: string[] = [];

  // 9. Generate postCreateCommands
  const postCreateCommands: string[] = [];
  if (installClaudeTools) {
    postCreateCommands.push(generateClaudeToolsInstallCommand());
  }

  return {
    mountSpecs,
    featureSpecs,
    containerEnvSpecs,
    remoteEnvSpecs,
    postStartCommands,
    postCreateCommands,
  };
}

/**
 * Generate the command to install claude-tools from source.
 * This builds claude-tools from the upstream OCaml source via opam/dune.
 * The command is idempotent: it checks if claude-ls is already available.
 */
export function generateClaudeToolsInstallCommand(): string {
  // The command chain:
  // 1. Check if already installed
  // 2. Ensure opam is initialized (it may already be from the base image)
  // 3. Install OCaml build dependencies
  // 4. Clone, build, and install claude-tools
  // 5. Clean up build artifacts
  // NOTE: The repository URL (github.com/dlond/claude-tools) was provided by the
  // user in the original request context, not sourced from the research reports.
  // It should be verified during implementation before merging to main.
  return [
    "command -v claude-ls >/dev/null 2>&1 && exit 0",
    "command -v opam >/dev/null 2>&1 || { echo 'claude-tools install skipped: opam not available'; exit 0; }",
    "opam init --auto-setup --bare 2>/dev/null || true",
    "eval $(opam env 2>/dev/null) || true",
    "opam install -y dune yojson cmdliner uuidm 2>/dev/null || { echo 'claude-tools install skipped: opam dependencies failed'; exit 0; }",
    "git clone --depth 1 https://github.com/dlond/claude-tools.git /tmp/claude-tools 2>/dev/null || { echo 'claude-tools install skipped: clone failed'; exit 0; }",
    "cd /tmp/claude-tools && eval $(opam env) && dune build && dune install --prefix /usr/local 2>/dev/null || echo 'claude-tools install skipped: build failed'",
    "rm -rf /tmp/claude-tools",
  ].join(" && ");
}
```

#### 2.3 Wire into `runUp`

**File:** `packages/lace/src/lib/up.ts`

Add imports at top:

```typescript
import {
  extractClaudeAccess,
  resolveClaudeAccess,
  type ClaudeAccessResult,
} from "./claude-access";
import { loadSettings } from "./settings";
```

Add Phase 2.5 between the existing Phase 2 (resolve mounts, L151-175) and Phase 3 (generate extended config, L177-200):

```typescript
// Phase 2.5: Resolve claude access (if configured)
const claudeExtraction = extractClaudeAccess(configMinimal.raw);
let claudeResult: ClaudeAccessResult | null = null;

if (claudeExtraction.kind === "enabled") {
  console.log("Resolving Claude Code access...");
  try {
    const settings = loadSettings();
    claudeResult = resolveClaudeAccess({
      raw: configMinimal.raw,
      config: claudeExtraction.config,
      settings,
      workspaceFolder,
      sshPort: portResult.assignment.hostPort,
    });

    // Log what was resolved
    if (claudeResult.mountSpecs.length > 0) {
      claudeResult.mountSpecs.forEach((spec) => {
        console.log(`  ${spec}`);
      });
    }
    if (Object.keys(claudeResult.featureSpecs).length > 0) {
      console.log(
        `  Adding feature ${Object.keys(claudeResult.featureSpecs).join(", ")}`,
      );
    }
    if (Object.keys(claudeResult.remoteEnvSpecs).length > 0) {
      console.log(
        `  Forwarding ${Object.keys(claudeResult.remoteEnvSpecs).join(", ")} from host`,
      );
    }

    result.phases.claudeAccess = {
      exitCode: 0,
      message: "Claude access resolved",
    };
  } catch (err) {
    result.phases.claudeAccess = {
      exitCode: 1,
      message: (err as Error).message,
    };
    // Claude access failure is non-fatal; log warning and continue
    console.warn(
      `Warning: Claude access resolution failed: ${(err as Error).message}`,
    );
  }
}
```

Update the `generateExtendedConfig` call (currently L182-187) to include claude specs:

```typescript
generateExtendedConfig({
  workspaceFolder,
  mountSpecs: [
    ...mountSpecs,
    ...(claudeResult?.mountSpecs ?? []),
  ],
  symlinkCommand,
  portMapping,
  featureSpecs: claudeResult?.featureSpecs,
  containerEnvSpecs: claudeResult?.containerEnvSpecs,
  remoteEnvSpecs: claudeResult?.remoteEnvSpecs,
  postStartCommands: claudeResult?.postStartCommands,
  postCreateCommands: claudeResult?.postCreateCommands,
});
```

Update the `UpResult.phases` type (L32-38):

```typescript
phases: {
  portAssignment?: { exitCode: number; message: string; port?: number };
  prebuild?: { exitCode: number; message: string };
  resolveMounts?: { exitCode: number; message: string };
  claudeAccess?: { exitCode: number; message: string };
  generateConfig?: { exitCode: number; message: string };
  devcontainerUp?: { exitCode: number; stdout: string; stderr: string };
};
```

> NOTE: `loadSettings()` is already called in the `runResolveMounts` path. In Phase 2, when both plugins and claude access are configured, settings are loaded twice. This is acceptable because `loadSettings()` is a synchronous file read and the second call is cheap. If deduplication is desired, settings can be loaded once at the top of `runUp` and passed to both paths. This is a minor optimization that can be done as a follow-up.

#### 2.4 Phase 2 Test Specifications

**Test file:** `packages/lace/src/lib/__tests__/claude-access-resolve.test.ts` (new)

Each test mocks `existsSync` for the host `~/.claude/` directory and creates a minimal `raw` devcontainer config.

```
1. claude: true, host ~/.claude exists:
   Input: config=true, existsSync(homedir()+'/.claude') mocked true, raw={remoteUser:"node"}
   Expected: mountSpecs contains "type=bind,source=<homedir>/.claude,target=/home/node/.claude"
             featureSpecs has "ghcr.io/anthropics/devcontainer-features/claude-code:1"
             containerEnvSpecs has CLAUDE_CONFIG_DIR="/home/node/.claude"
             remoteEnvSpecs has ANTHROPIC_API_KEY="${localEnv:ANTHROPIC_API_KEY}"

2. claude: true, host ~/.claude missing:
   Input: config=true, existsSync mocked false
   Expected: mountSpecs is empty, featureSpecs still present, containerEnvSpecs still present

3. claude: { mountMcpConfig: true }, ~/.claude.json exists:
   Input: config={mountMcpConfig:true}, both existsSync calls mocked true
   Expected: mountSpecs has 2 entries, second is readonly

4. claude: true with settings configSource override:
   Input: config=true, settings={claude:{configSource:"/custom/claude"}}
   Expected: mountSpecs source is /custom/claude

5. claude: true with settings remoteUser override:
   Input: config=true, raw={remoteUser:"node"}, settings={claude:{remoteUser:"vscode"}}
   Expected: mount target is /home/vscode/.claude

6. claude: true with settings forwardApiKey: false:
   Input: config=true, settings={claude:{forwardApiKey:false}}
   Expected: remoteEnvSpecs does not contain ANTHROPIC_API_KEY

7. claude: true with settings disableTelemetry: true:
   Input: config=true, settings={claude:{disableTelemetry:true}}
   Expected: containerEnvSpecs has DISABLE_TELEMETRY="1"

8. Settings mountMcpConfig: true overrides project config false:
   Input: config={mountMcpConfig:false}, settings={claude:{mountMcpConfig:true}}
   Expected: MCP config mount IS present (settings wins)

9. Settings forwardApiKey: false overrides default:
   Input: config=true, settings={claude:{forwardApiKey:false}}
   Expected: no ANTHROPIC_API_KEY in remoteEnvSpecs

10. installClaudeTools: true generates postCreateCommand:
    Input: config={installClaudeTools:true}
    Expected: postCreateCommands has 1 entry containing "claude-tools"

11. Root user detection (no remoteUser set):
    Input: config=true, raw={}
    Expected: mount target /root/.claude, containerEnvSpecs.CLAUDE_CONFIG_DIR="/root/.claude"
```

**Test file:** `packages/lace/src/commands/__tests__/up-claude.integration.test.ts` (new)

Integration tests exercise `runUp` end-to-end with mock subprocess.

```
1. Full lace up with claude: true:
   Input: devcontainer.json with { customizations: { lace: { claude: true } } }, remoteUser: "node"
   Expected: .lace/devcontainer.json has features, mounts (if host ~/.claude exists), containerEnv, remoteEnv

2. lace up with claude: true AND plugins:
   Input: devcontainer.json with both claude and plugins
   Expected: Both claude mounts and plugin mounts present in .lace/devcontainer.json

3. lace up with claude: false:
   Input: devcontainer.json with { customizations: { lace: { claude: false } } }
   Expected: No claude-related config in .lace/devcontainer.json

4. lace up with no claude config:
   Input: devcontainer.json with no claude customization
   Expected: Standard behavior unchanged, no claude fields in extended config
```

#### 2.5 Phase 2 Dependencies and Constraints

**Dependencies:** Phase 1 (all new types, interfaces, and merging blocks must be in place).

**Constraints:**
- Do NOT implement the session bridge command or LACE_* vars yet (those are Phase 3).
- Do NOT implement `.claude.local.md` generation yet (that is Phase 4).
- The `postStartCommands` and some `containerEnvSpecs` will be empty in Phase 2; they are populated in Phase 3 and 4.
- Claude access failure is **non-fatal** -- it logs a warning and continues. This is a design decision: the user may still want their plugins and port mapping even if claude resolution fails.

**Success Criteria:**
1. `"customizations.lace.claude": true` in devcontainer.json causes `.lace/devcontainer.json` to include the Claude Code feature, mounts, and env vars.
2. The `UpResult.phases.claudeAccess` field reports the phase outcome.
3. All existing tests pass without modification.
4. The generated config is valid JSON and can be passed to `devcontainer up --config`.

---

### Phase 3: Session Bridge + LACE_* Environment Variables + claude-tools Source Installation

#### 3.1 Implement `generateSessionBridgeCommand`

**File:** `packages/lace/src/lib/claude-access.ts`

```typescript
/**
 * Generate the shell command to create the session bridge symlink.
 * The symlink maps the container's path encoding to the host's path
 * encoding in ~/.claude/projects/, enabling session portability.
 *
 * Returns empty string if encodings are identical (no bridge needed).
 */
export function generateSessionBridgeCommand(options: {
  hostWorkspacePath: string;
  containerWorkspacePath: string;
  remoteHome: string;
}): string {
  const { hostWorkspacePath, containerWorkspacePath, remoteHome } = options;

  const hostEncoded = hostWorkspacePath.replace(/\//g, "-");
  const containerEncoded = containerWorkspacePath.replace(/\//g, "-");

  // No bridge needed if encodings are identical
  if (hostEncoded === containerEncoded) return "";

  const projectsDir = `${remoteHome}/.claude/projects`;
  return `mkdir -p '${projectsDir}' && ln -sfn '${projectsDir}/${hostEncoded}' '${projectsDir}/${containerEncoded}' 2>/dev/null || true`;
}
```

#### 3.2 Compute `containerWorkspaceFolder` and Add LACE_* Environment Variables

**File:** `packages/lace/src/lib/claude-access.ts`

Modify `resolveClaudeAccess` to compute `containerWorkspaceFolder` once (before steps 8 and 9) and inject LACE_* variables into `containerEnvSpecs`. Add these after the existing `CLAUDE_CONFIG_DIR` assignment (in step 6):

```typescript
// Compute container workspace folder (used by LACE_* vars, session bridge, and agent context)
const containerWorkspaceFolder = deriveContainerWorkspaceFolder(
  raw,
  workspaceFolder,
);

// LACE_* environment variables
containerEnvSpecs.LACE_MANAGED = "true";
containerEnvSpecs.LACE_PROJECT_NAME = deriveProjectId(workspaceFolder);
containerEnvSpecs.LACE_WORKSPACE_ROOT = containerWorkspaceFolder;
containerEnvSpecs.LACE_HOST_WORKSPACE = workspaceFolder;
if (sshPort !== undefined) {
  containerEnvSpecs.LACE_SSH_PORT = String(sshPort);
}
```

This requires importing `deriveProjectId` from `plugin-clones.ts`:

```typescript
import { deriveProjectId } from "./plugin-clones";
```

The `containerWorkspaceFolder` variable is computed once at this point and is available to both step 8 (session bridge, section 3.3) and step 9 (agent context, Phase 4 section 4.2).

#### 3.3 Wire Session Bridge into `resolveClaudeAccess`

Modify `resolveClaudeAccess` step 8 to generate the session bridge command. The `containerWorkspaceFolder` variable is already available from step 6 (section 3.2 above):

```typescript
// 8. Generate session bridge command
if (sessionBridge) {
  const bridgeCmd = generateSessionBridgeCommand({
    hostWorkspacePath: workspaceFolder,
    containerWorkspacePath: containerWorkspaceFolder,
    remoteHome,
  });
  if (bridgeCmd) {
    postStartCommands.push(bridgeCmd);
  }
}
```

#### 3.4 claude-tools Source Installation

The `generateClaudeToolsInstallCommand` function was already defined in Phase 2 (section 2.2) and is wired into `resolveClaudeAccess` via `postCreateCommands` when `installClaudeTools: true`. Phase 3 verifies this works with real opam environments.

The install command chain is designed to be maximally resilient:
- Skips if `claude-ls` is already installed
- Skips if `opam` is not available (requires base image with OCaml)
- Each step fails gracefully with an informative message
- Cleans up build artifacts

The `installClaudeTools` flag is controlled by the project config:

```jsonc
{
  "customizations": {
    "lace": {
      "claude": {
        "installClaudeTools": true
      }
    }
  }
}
```

> NOTE: claude-tools installation requires an OCaml toolchain (opam, dune). Most devcontainer base images do not include this. The `installClaudeTools` flag should only be set `true` when the base image includes OCaml or when the project is willing to accept the 5-10 minute build time for opam dependency installation. The long-term solution is a devcontainer feature (`ghcr.io/weftwiseink/devcontainer-features/claude-tools:1`). The flag defaults to `false` and is opt-in.

#### 3.5 Phase 3 Test Specifications

**Test file:** `packages/lace/src/lib/__tests__/claude-access-bridge.test.ts` (new)

```
1. Host /var/home/mjr/code/weft/lace, container /workspaces/lace:
   Expected: ln -sfn command with source '-var-home-mjr-code-weft-lace' and link '-workspaces-lace'

2. Host and container paths produce identical encoding:
   Expected: empty string (no bridge needed)

3. Container workspace from raw.workspaceFolder:
   Input: raw.workspaceFolder = "/workspace/main"
   Expected: uses /workspace/main for container encoding

4. Container workspace default derivation:
   Input: no raw.workspaceFolder, hostPath="/var/home/mjr/code/project"
   Expected: container path is /workspaces/project

5. Path encoding produces leading dash:
   Input: hostPath="/var/home/mjr"
   Expected: encoded starts with "-var-"

6. LACE_* variables present in containerEnvSpecs:
   Input: workspaceFolder="/var/home/mjr/code/weft/lace", sshPort=22430
   Expected: containerEnvSpecs contains:
     LACE_MANAGED="true"
     LACE_PROJECT_NAME="lace"
     LACE_WORKSPACE_ROOT="/workspaces/lace"
     LACE_SSH_PORT="22430"
     LACE_HOST_WORKSPACE="/var/home/mjr/code/weft/lace"

7. LACE_SSH_PORT omitted when sshPort undefined:
   Input: sshPort=undefined
   Expected: LACE_SSH_PORT not in containerEnvSpecs

8. Session bridge disabled via config:
   Input: config={ sessionBridge: false }
   Expected: postStartCommands is empty

9. Session bridge projects dir creation:
   Expected: command includes mkdir -p for the projects directory

10. claude-tools install command structure:
    Input: generateClaudeToolsInstallCommand()
    Expected: command contains "opam", "dune build", "dune install", "claude-tools"
```

#### 3.6 Phase 3 Dependencies and Constraints

**Dependencies:** Phase 2 (the `resolveClaudeAccess` function must exist and be wired into `runUp`).

**Constraints:**
- Do NOT modify the session bridge to handle worktree-specific paths (out of scope).
- Do NOT implement the MCP server or `/etc/lace/environment.json` (those are future work from the agent awareness report).
- The `deriveProjectId` import from `plugin-clones.ts` is read-only -- do not modify that module.

**Success Criteria:**
1. The session bridge symlink command is generated correctly for differing host/container paths.
2. No symlink command is generated when paths produce identical encodings.
3. All LACE_* environment variables are present in the generated `.lace/devcontainer.json`.
4. `LACE_SSH_PORT` matches the assigned port.
5. `LACE_WORKSPACE_ROOT` is the container workspace path, not the host path.
6. `installClaudeTools: true` produces a postCreateCommand with the opam/dune build chain.
7. All existing tests pass without modification.

---

### Phase 4: Agent Awareness -- `.claude.local.md` Generation

#### 4.1 Implement `generateAgentContextCommand`

**File:** `packages/lace/src/lib/claude-access.ts`

```typescript
/**
 * Generate a shell command that writes .claude.local.md with runtime
 * context for agent situational awareness.
 *
 * The heredoc uses single-quoted delimiter ('LOCALEOF') so that
 * $LACE_SSH_PORT is written literally for agent runtime evaluation.
 * Concrete paths (workspace folder, remote home) are substituted by
 * TypeScript string interpolation when building the command.
 */
export function generateAgentContextCommand(options: {
  containerWorkspaceFolder: string;
  remoteHome: string;
}): string {
  const { containerWorkspaceFolder, remoteHome } = options;

  return `cat > ${containerWorkspaceFolder}/.claude.local.md << 'LOCALEOF'
## Lace Container Environment (auto-generated)

This project runs inside a lace-managed devcontainer.

- Container managed by: lace
- SSH port (host): check $LACE_SSH_PORT
- Plugins mount at: /mnt/lace/plugins/<name> (readonly unless overridden)
- Persistent Claude state: ${remoteHome}/.claude (bind-mounted from host)

To list available plugins: ls /mnt/lace/plugins/ 2>/dev/null
LOCALEOF`;
}
```

**Key design points:**
- The heredoc delimiter is single-quoted (`'LOCALEOF'`) so shell variables like `$LACE_SSH_PORT` are written literally, not expanded at generation time. The agent evaluates them at runtime via `env`.
- The concrete paths (`containerWorkspaceFolder`, `remoteHome`) are substituted by TypeScript string interpolation when building the command string. These are known at config generation time.
- The file is written to the workspace root, which is the container workspace folder.
- `.claude.local.md` is automatically loaded by Claude Code and is gitignored.

#### 4.2 Wire into `resolveClaudeAccess`

Add to `resolveClaudeAccess` after the session bridge command (step 8), as a new step 9. The `containerWorkspaceFolder` variable is already computed in step 6 (Phase 3, section 3.2) and is available regardless of whether `sessionBridge` is enabled:

```typescript
// 9. Generate .claude.local.md command
const agentContextCmd = generateAgentContextCommand({
  containerWorkspaceFolder,
  remoteHome,
});
postStartCommands.push(agentContextCmd);
```

#### 4.3 Phase 4 Test Specifications

**Test file:** `packages/lace/src/lib/__tests__/claude-access-agent.test.ts` (new)

```
1. Agent context command produces valid shell heredoc:
   Input: containerWorkspaceFolder="/workspaces/lace", remoteHome="/home/node"
   Expected: command starts with "cat > /workspaces/lace/.claude.local.md"

2. Content includes lace identification:
   Expected: output contains "lace-managed devcontainer"

3. Content references $LACE_SSH_PORT literally (not expanded):
   Expected: output contains literal "$LACE_SSH_PORT"

4. Content references plugin mount path:
   Expected: output contains "/mnt/lace/plugins/"

5. Command writes to correct workspace path:
   Input: containerWorkspaceFolder="/workspace/main"
   Expected: command writes to /workspace/main/.claude.local.md

6. Remote home path is substituted (not a shell variable):
   Input: remoteHome="/home/node"
   Expected: output contains "/home/node/.claude" (not "${remoteHome}")

7. Heredoc delimiter is single-quoted:
   Expected: command contains "'LOCALEOF'" (preventing shell expansion)
```

#### 4.4 Phase 4 Dependencies and Constraints

**Dependencies:** Phase 3 (LACE_* variables must be set for the `.claude.local.md` content to reference them meaningfully).

**Constraints:**
- Do NOT modify CLAUDE.md (that is a separate Tier A task from the agent awareness report).
- Do NOT create `.claude/rules/` files (that is Tier 2 work from the agent awareness report).
- The `.claude.local.md` content should be minimal and stable -- it is auto-generated on every container start.

**Success Criteria:**
1. `.claude.local.md` generation command is included in `postStartCommands`.
2. The command produces a valid shell heredoc that writes to the correct path.
3. The content includes lace identification, SSH port reference, plugin mount path, and persistent state location.
4. `$LACE_SSH_PORT` is a literal shell variable in the output (not expanded at generation time).
5. Concrete paths (`remoteHome`, `containerWorkspaceFolder`) are substituted at generation time.
6. All existing tests pass without modification.

## Important Design Decisions

### D1: Export `generateExtendedConfig` for Testing

**Decision:** Export `generateExtendedConfig` as a named export from `up.ts` (changing from module-private to exported).

**Why:** The new merging logic (features, containerEnv, remoteEnv, postStartCommand normalization) is complex enough to warrant direct unit testing. Testing through `runUp` requires full workspace setup with temp directories, mock subprocess runners, and devcontainer.json files -- significantly more scaffolding than testing the merge function directly. The function has no side effects beyond file I/O (which can be mocked or tested via temp dirs). The export is internal to the `lace` package and not part of the public CLI API.

**Trade-off:** Slightly increases the public surface area of `up.ts`. This is acceptable because the function is consumed only within the package.

### D2: Non-Fatal Claude Access Resolution

**Decision:** Claude access resolution failure in `runUp` logs a warning and continues rather than aborting the pipeline.

**Why:** A user who configures both plugins and claude access should not lose their plugin mounts because of a claude resolution error (e.g., an invalid settings.json `configSource` path). The port mapping and plugin mounts are independent of claude access. The `UpResult.phases.claudeAccess` field reports the failure for diagnostic purposes.

**Trade-off:** Users may not notice that claude access silently failed. The console warning mitigates this, and the generated `.lace/devcontainer.json` can be inspected to verify.

### D3: Settings Override Takes Precedence Over Project Config

**Decision:** When a field appears in both `ClaudeUserSettings` (settings.json) and `ClaudeAccessConfig` (devcontainer.json), settings.json takes precedence.

**Why:** Settings.json represents the user's personal preferences. If a user sets `forwardApiKey: false` in their settings, they do not want any project to override that decision. This is analogous to how `overrideMount` in plugin settings overrides project-level plugin declarations. The project config establishes defaults; the user config overrides them.

**Resolution order:** `settings.claude?.field ?? projectConfig.field ?? default`

### D4: Always Normalize postStartCommand to Object Format

**Decision:** When lace needs to inject `postStartCommand` entries and the original format is string or array, convert to object format rather than concatenating with `&&`.

**Why:** The current `postCreateCommand` handling (`up.ts:276-281`) uses string concatenation (`${existing} && ${new}`), which has known quoting issues when the array format is joined with spaces. The session bridge and agent context are two separate commands that should run independently. Object format (`{ "original": ..., "lace-post-start-0": [...] }`) provides clean separation, independent execution, and clear naming. Each command gets its own entry and can fail independently without affecting others.

### D5: claude-tools Installation Behind Opt-In Flag

**Decision:** The `installClaudeTools` flag defaults to `false` and must be explicitly set to `true` in the project's `customizations.lace.claude` config.

**Why:** claude-tools installation from source requires an OCaml toolchain and takes 5-10 minutes. This is inappropriate as a default for all containers with claude access. Users who want claude-tools must either ensure their base image includes OCaml or accept the build time cost. The flag is in the project config (not user settings) because it is a property of the development environment, not a user preference.

### D6: containerWorkspaceFolder Computed Once, Used for Both Bridge and Agent Context

**Decision:** The `containerWorkspaceFolder` derivation is computed once at the top of the resolution logic and used by both the session bridge (Phase 3) and agent context (Phase 4).

**Why:** Both features need the same value. Computing it twice would be redundant and risk inconsistency. The `deriveContainerWorkspaceFolder` function is deterministic.

### D7: `resolveClaudeAccess` Signature Divergence from Mid-Level Proposal

**Decision:** The detailed proposal's `resolveClaudeAccess` signature differs from the mid-level proposal in two ways: (a) it adds a `config: ClaudeAccessConfig` parameter (the mid-level expected extraction to happen internally), and (b) it removes the `containerWorkspaceFolder` parameter (now computed internally via `deriveContainerWorkspaceFolder`).

**Why:** (a) Separating extraction (`extractClaudeAccess`) from resolution (`resolveClaudeAccess`) improves testability -- callers can test resolution with specific config values without constructing full devcontainer.json structures. The extraction is performed in `runUp` before calling `resolveClaudeAccess`, matching the existing `extractPlugins` -> `runResolveMounts` pattern. (b) Computing `containerWorkspaceFolder` internally reduces the caller's burden and ensures consistency between the session bridge and agent context paths (see D6).

**The detailed proposal is authoritative for implementation.** Subagents should use the signature specified in section 2.2, not the mid-level proposal's version.

## Edge Cases / Challenging Scenarios

### E1: postStartCommand Object Key Collision

**Trigger:** The original devcontainer.json has a `postStartCommand` object with a key named `lace-post-start-0`.

**Behavior:** The lace-injected key overwrites the original entry.

**Mitigation:** The `lace-post-start-N` naming convention is unlikely to collide with user-defined keys. If collision becomes a practical issue, prefix with a UUID or use a more unique naming scheme. For Phase 1, this is accepted as a low-probability edge case.

### E2: configSource Points to Symlinked Directory

**Trigger:** `settings.claude.configSource` is a path like `~/code/dev_records/weft/claude` which is a symlink.

**Behavior:** `resolveSettingsPath` calls `resolve()` which resolves `..` components but does NOT resolve symlinks (Node.js `path.resolve` is pure string manipulation). The mount source is the symlink path, which Docker will follow when creating the bind mount.

**Mitigation:** This is correct behavior. Docker bind mounts follow symlinks on the host. No special handling needed.

### E3: Multiple lace Containers with Different remoteUser

**Trigger:** Two projects use `lace up` with `claude: true`, one with `remoteUser: "node"` and one with `remoteUser: "vscode"`.

**Behavior:** Each container gets correctly targeted mounts (`/home/node/.claude` vs `/home/vscode/.claude`). The host source is the same `~/.claude/` directory. Both containers share credentials.

**Mitigation:** This is working as designed. Claude Code handles concurrent access gracefully (UUID-based sessions, last-write-wins for token refresh).

### E4: `postCreateCommand` Array Format Quoting

**Trigger:** The original devcontainer.json has `"postCreateCommand": ["npm", "install", "some package"]` and lace needs to add a postCreateCommand.

**Behavior:** The pre-existing `symlinkCommand` merge uses string concatenation with `&&`, which loses quoting when the original is array format (`existing.join(" ")` produces `npm install some package && symlink-cmd`). However, the new `postCreateCommands` extension (section 1.6) uses object-format normalization, which avoids this issue entirely: the original array is preserved as `{ "original": ["npm", "install", "some package"], "lace-post-create-0": ["sh", "-c", "install-cmd"] }`. Each entry retains its original format and executes independently.

**Mitigation:** The quoting issue only affects the pre-existing `symlinkCommand` string-concatenation pattern, not the new `postCreateCommands` object-format merge. A follow-up could migrate the `symlinkCommand` merge to object format as well for full consistency.

### E5: Session Bridge with Worktree-Based Workspace

**Trigger:** The project uses `workspaceMount` and `workspaceFolder` to mount a parent directory and work in a subdirectory (e.g., `workspaceFolder: "/workspace/main"`).

**Behavior:** `deriveContainerWorkspaceFolder` returns the explicit `raw.workspaceFolder` value (`/workspace/main`). The session bridge creates a symlink mapping the container encoding of this specific path to the host encoding.

**Mitigation:** This is correct. Each worktree path gets its own session encoding and its own bridge symlink. If the user works in multiple worktrees, each needs its own bridge. Phase 3 creates the bridge for the declared `workspaceFolder` only. Additional worktree bridges are out of scope.

### E6: Empty `.claude/` Directory on Host

**Trigger:** `~/.claude/` exists on the host but is empty (e.g., freshly created, never used Claude).

**Behavior:** `existsSync` returns true, the mount is created. Claude Code in the container writes to it normally. This is a valid use case (fresh setup).

**Mitigation:** No special handling needed. This works correctly.

## Test Plan

### Test Count Summary

| Phase | Test File | Est. Count |
|-------|-----------|-----------|
| 1 | `claude-access.test.ts` | 16 |
| 1 | `up-extended-config.test.ts` | 13 |
| 1 | `settings.test.ts` (extend) | 3 |
| 2 | `claude-access-resolve.test.ts` | 11 |
| 2 | `up-claude.integration.test.ts` | 4 |
| 3 | `claude-access-bridge.test.ts` | 10 |
| 4 | `claude-access-agent.test.ts` | 7 |
| **Total** | | **~64** |

### Testing Strategy

**Unit tests** mock `existsSync`, `homedir()`, and `process.cwd()` to test pure logic. The extraction functions (`extractClaudeAccess`, `resolveRemoteUser`, etc.) need no mocking.

**Integration tests** use temp directories with real file I/O, following the pattern established in `up.integration.test.ts`. They create workspace directories, write devcontainer.json files, run `runUp` with mock subprocess, and inspect the generated `.lace/devcontainer.json`.

**Manual verification** (after all phases):
- [ ] `lace up` with `claude: true` generates correct `.lace/devcontainer.json`
- [ ] `devcontainer up` with the generated config installs Claude Code
- [ ] Host credentials are available (`claude auth status`)
- [ ] Session bridge symlink exists in `~/.claude/projects/`
- [ ] `env | grep LACE_` shows all expected variables
- [ ] `.claude.local.md` is generated in workspace root
- [ ] Existing plugin mounts still work alongside claude access
- [ ] `installClaudeTools: true` generates a postCreateCommand with the opam/dune build chain (or gracefully skips when opam is unavailable with informative message)
- [ ] No regressions in `pnpm test`

## Implementation Phases

### Summary

| Phase | Description | New Files | Modified Files | Est. Tests |
|-------|-------------|-----------|---------------|-----------|
| 1 | Config API + Extraction | `claude-access.ts`, `claude-access.test.ts`, `up-extended-config.test.ts` | `up.ts`, `settings.ts`, `settings.test.ts` | 30 |
| 2 | Managed Plugin E2E | `claude-access-resolve.test.ts`, `up-claude.integration.test.ts` | `up.ts`, `claude-access.ts` | 15 |
| 3 | Bridge + LACE_* + claude-tools | `claude-access-bridge.test.ts` | `claude-access.ts` | 10 |
| 4 | .claude.local.md | `claude-access-agent.test.ts` | `claude-access.ts` | 7 |

### Dependency Graph

```
Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4
```

All phases are strictly sequential. Phase 1 must complete before Phase 2 can start (Phase 2 uses the types and merging blocks from Phase 1). Phase 3 modifies `resolveClaudeAccess` which must exist from Phase 2. Phase 4 modifies `resolveClaudeAccess` further and depends on the LACE_* variables from Phase 3.

### Files NOT to Modify

- `packages/lace/src/lib/devcontainer.ts` -- No changes needed. The `extractClaudeAccess` function follows the `extractPlugins` pattern but lives in `claude-access.ts`.
- `packages/lace/src/lib/mounts.ts` -- No changes needed. Claude mounts are generated in `claude-access.ts`, not through the existing mount resolution pipeline.
- `packages/lace/src/lib/plugin-clones.ts` -- Read-only import of `deriveProjectId`. No modifications.
- `packages/lace/src/index.ts` -- No CLI changes. Claude access is activated by devcontainer.json configuration, not by a new CLI command.
- `packages/lace/src/commands/*.ts` -- No command changes. The `up` command already calls `runUp` which is modified in Phase 2.

## Related Documents

- **Mid-level proposal:** `cdocs/proposals/2026-02-05-lace-mount-enabled-claude-plugin.md`
- **Self-review:** `cdocs/reviews/2026-02-05-review-of-lace-mount-enabled-claude-plugin.md`
- **Executive summary:** `cdocs/reports/2026-02-05-mount-plugin-workstream-executive-summary.md`
- **Report 2 -- Claude Devcontainer Bundling:** `cdocs/reports/2026-02-05-claude-devcontainer-bundling.md`
- **Report 3 -- Claude-Tools Streamlining:** `cdocs/reports/2026-02-05-claude-tools-streamlining.md`
- **Report 4 -- Agent Situational Awareness:** `cdocs/reports/2026-02-05-agent-situational-awareness.md`
