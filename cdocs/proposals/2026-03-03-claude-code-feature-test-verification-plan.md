---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T12:00:00-08:00
task_list: lace/claude-code-feature
type: proposal
state: live
status: review_ready
tags: [testing, claude-code, devcontainer-features, mounts, scenario-tests, documentation, verification]
references:
  - devcontainers/features/src/claude-code/devcontainer-feature.json
  - devcontainers/features/src/claude-code/install.sh
  - packages/lace/src/__tests__/wezterm-server-scenarios.test.ts
  - packages/lace/src/__tests__/portless-scenarios.test.ts
  - packages/lace/src/__tests__/helpers/scenario-utils.ts
  - packages/lace/src/lib/feature-metadata.ts
  - packages/lace/src/lib/mount-resolver.ts
  - cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md
  - cdocs/proposals/2026-02-06-rfp-claude-tools-lace-feature.md
---

# Claude Code Feature: Test, Verification, and Doc Update Plan

> **BLUF:** Define a comprehensive test, verification, and documentation update plan for the claude-code devcontainer feature (`devcontainers/features/src/claude-code/`). The feature declares a lace mount for `~/.claude` with `sourceMustBe: "directory"` -- a mount-only feature with no port declarations, making it architecturally distinct from wezterm-server (ports + mounts) and portless (ports only). The test plan follows the established scenario test pattern from `wezterm-server-scenarios.test.ts` and `portless-scenarios.test.ts`, adding eight scenarios covering mount auto-injection, settings overrides, validated mount resolution, Docker smoke testing, multi-feature coexistence, `_REMOTE_USER` variations, version pinning, and npm prerequisite detection. Documentation updates add claude-code to the root `README.md` features table and verify accuracy of existing references in `packages/lace/README.md`.

## Objective

Establish test coverage, manual verification procedures, and documentation updates for the claude-code devcontainer feature. The feature is implemented and functional but lacks the scenario test suite that the wezterm-server and portless features have. This gap leaves the mount auto-injection and `sourceMustBe` validation paths untested at the integration level for a real feature -- all existing mount integration tests in `up-mount.integration.test.ts` use synthetic feature metadata, not real `devcontainer-feature.json` files from the repo.

## Background

### The claude-code feature

The claude-code feature (`devcontainers/features/src/claude-code/`) installs the Claude Code CLI globally via npm and declares a lace mount for persistent Claude configuration:

```json
{
    "id": "claude-code",
    "version": "1.0.0",
    "options": {
        "version": {
            "type": "string",
            "default": "latest",
            "description": "Claude Code version to install (npm version specifier)."
        }
    },
    "customizations": {
        "lace": {
            "mounts": {
                "config": {
                    "target": "/home/${_REMOTE_USER}/.claude",
                    "recommendedSource": "~/.claude",
                    "description": "Claude Code configuration, credentials, and session state",
                    "sourceMustBe": "directory"
                }
            }
        }
    }
}
```

Key characteristics:
- **Mount-only feature**: declares `customizations.lace.mounts` but no `customizations.lace.ports`. This makes it the first feature to exercise the mount-only path through lace's auto-injection pipeline.
- **Validated mount**: uses `sourceMustBe: "directory"`, meaning lace validates the source exists as a directory before template resolution. The `recommendedSource` (`~/.claude`) serves as the default source when no settings override is configured.
- **`_REMOTE_USER` in target**: the mount target path (`/home/${_REMOTE_USER}/.claude`) uses the devcontainer `_REMOTE_USER` variable, which is resolved by the devcontainer CLI at build time -- not by lace. Lace passes this string through verbatim.
- **npm prerequisite**: `install.sh` checks for `npm` availability and exits 1 with an actionable error message if missing.

### Existing test patterns

Two feature-specific scenario test suites establish the testing pattern:

**`wezterm-server-scenarios.test.ts`** (6 scenarios): Tests port auto-injection, explicit templates, Docker integration (SSH connectivity), port stability, suppression, and non-port option passthrough. Uses `symlinkLocalFeature()` for config-generation scenarios and `copyLocalFeature()` for Docker scenarios. The wezterm-server feature declares both ports and mounts.

**`portless-scenarios.test.ts`** (3 scenarios): Tests prebuild feature port injection with asymmetric mapping, port persistence, and multi-feature coexistence with wezterm-server. Uses `createMockSubprocess()` to avoid actual Docker builds.

Both test suites share helpers from `scenario-utils.ts`: `createScenarioWorkspace()`, `writeDevcontainerJson()`, `symlinkLocalFeature()`, `readGeneratedConfig()`, `setupScenarioSettings()`, and Docker lifecycle utilities.

### Mount integration test coverage

`up-mount.integration.test.ts` covers mount template resolution, auto-injection, source validation, and `sourceMustBe` checking using synthetic `FeatureMetadata` objects constructed inline. These tests validate the mount pipeline mechanics but do not exercise the metadata extraction path from a real `devcontainer-feature.json`. The claude-code scenario tests fill this gap.

### Prior proposals

- `2026-02-06-rfp-claude-tools-lace-feature.md` (status: `request_for_proposal`): Originally scoped a more ambitious Claude Code feature with session bridges, env var forwarding, and agent awareness. The implemented feature is simpler -- CLI installation plus a mount declaration. The RFP's mount-related requirements (read-write `~/.claude/` bind mount, credential persistence) are directly addressed by the current implementation.
- `2026-02-07-wezterm-server-feature-scenario-tests.md` (status: `result_accepted`): The template for this proposal. Established the scenario test file convention, helper module structure, and Docker integration test gating pattern.

## Proposed Solution

### Part 1: Scenario test file

**File:** `packages/lace/src/__tests__/claude-code-scenarios.test.ts`

Eight scenarios covering the feature's integration with lace:

#### Scenario C1: Mount auto-injection from feature metadata

```typescript
describe("Scenario C1: mount auto-injection from feature metadata", () => {
  it("auto-injects mount template for claude-code/config into mounts array", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    // Create ~/.claude directory for sourceMustBe validation
    const claudeDir = join(ctx.workspaceRoot, ".claude-home");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];

    // Assert: mounts array contains the auto-injected claude-code/config mount
    expect(mounts).toBeDefined();
    const claudeMount = mounts.find((m) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();
    expect(claudeMount).toContain(`source=${claudeDir}`);
    expect(claudeMount).toContain("target=/home/${_REMOTE_USER}/.claude");
    expect(claudeMount).toContain("type=bind");

    // Assert: no port allocation (claude-code declares no ports)
    expect(extended.appPort).toBeUndefined();
    expect(extended.forwardPorts).toBeUndefined();
    expect(extended.portsAttributes).toBeUndefined();
  });
});
```

**What it validates:** Lace extracts `customizations.lace.mounts.config` from the real `devcontainer-feature.json`, auto-injects a `${lace.mount(claude-code/config)}` entry into the mounts array, and resolves it to a complete mount spec string. Confirms the mount-only path works without port declarations.

#### Scenario C2: Mount resolution with settings override

```typescript
describe("Scenario C2: mount resolution with settings override", () => {
  it("uses settings override source instead of recommendedSource", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const customSource = join(ctx.workspaceRoot, "custom-claude-dir");
    mkdirSync(customSource, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: customSource },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];
    const claudeMount = mounts.find((m) => m.includes("claude"));
    expect(claudeMount).toContain(`source=${customSource}`);
  });
});
```

**What it validates:** When a user provides a settings override for `claude-code/config`, lace uses that path instead of the `recommendedSource` (`~/.claude`). The override path must exist as a directory (enforced by `sourceMustBe: "directory"`).

#### Scenario C3: Validated mount -- source must be directory

```typescript
describe("Scenario C3: sourceMustBe validation rejects missing source", () => {
  it("fails when source directory does not exist and no settings override", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    // Do NOT create any source directory or settings override.
    // recommendedSource is ~/.claude which likely exists on the host,
    // but for isolation we override HOME to a temp path.
    const fakeHome = join(ctx.workspaceRoot, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    // No .claude directory inside fakeHome

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    // This should fail because sourceMustBe: "directory" validation
    // cannot find the source
    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    // Expect validation failure
    expect(result.exitCode).not.toBe(0);
  });
});
```

**What it validates:** The `sourceMustBe: "directory"` declaration causes lace to abort when neither a settings override nor the `recommendedSource` directory exists. This confirms the validated mount path works for real feature metadata.

> NOTE: This scenario requires careful isolation from the host's actual `~/.claude` directory. If the test host has `~/.claude`, the `recommendedSource` resolution will succeed and the test will pass incorrectly. The implementation should either mock `homedir()` or use an environment variable to redirect resolution. See Edge Case E3 for details.

#### Scenario C4: Docker smoke test

```typescript
describe.skipIf(!isDockerAvailable())(
  "Scenario C4: Docker smoke test -- claude installed and config dir exists",
  { timeout: 180_000 },
  () => {
    let containerId: string | null = null;

    afterEach(() => {
      if (containerId) stopContainer(containerId);
      cleanupWorkspaceContainers(ctx.workspaceRoot);
    });

    it("builds container with claude CLI and correct permissions on .claude dir", async () => {
      const featurePath = copyLocalFeature(ctx, "claude-code");

      // Provide a source directory for the mount
      const claudeDir = join(ctx.workspaceRoot, ".claude-source");
      mkdirSync(claudeDir, { recursive: true });
      setupScenarioSettings(ctx, {
        mounts: {
          "claude-code/config": { source: claudeDir },
        },
      });

      const config = {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          "ghcr.io/devcontainers/features/node:1": {},
          [featurePath]: {},
        },
      };

      writeDevcontainerJson(ctx, config);

      const result = await runUp({
        workspaceFolder: ctx.workspaceRoot,
        skipDevcontainerUp: true,
        cacheDir: ctx.metadataCacheDir,
      });

      expect(result.exitCode).toBe(0);

      prepareGeneratedConfigForDocker(
        ctx,
        new Map([[featurePath, "claude-code"]]),
      );

      // Start the container
      const upOutput = execSync(
        `devcontainer up --workspace-folder "${ctx.workspaceRoot}"`,
        { stdio: "pipe", timeout: 120_000 },
      ).toString();

      const parsed = JSON.parse(upOutput);
      containerId = parsed.containerId;

      // Verify claude is installed
      const claudeVersion = execSync(
        `docker exec ${containerId} claude --version`,
        { stdio: "pipe", timeout: 10_000 },
      ).toString().trim();
      expect(claudeVersion).toBeTruthy();

      // Verify .claude directory exists with correct permissions
      const perms = execSync(
        `docker exec ${containerId} stat -c '%a' /home/vscode/.claude`,
        { stdio: "pipe", timeout: 10_000 },
      ).toString().trim();
      expect(perms).toBe("700");
    });
  },
);
```

**What it validates:** The feature actually installs the Claude CLI and creates the `.claude` directory with mode 700 inside a real container. Requires the Node.js feature as a prerequisite (claude-code needs npm). This is the Docker-level proof that `install.sh` works correctly.

#### Scenario C5: Multi-feature coexistence with wezterm-server

```typescript
describe("Scenario C5: claude-code + wezterm-server coexistence", () => {
  it("generates config with both mount and port entries", async () => {
    const claudePath = symlinkLocalFeature(ctx, "claude-code");
    const weztermPath = symlinkLocalFeature(ctx, "wezterm-server");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    const keyPath = createTempSshKey(ctx);

    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
        "wezterm-server/authorized-keys": { source: keyPath },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [claudePath]: {},
        [weztermPath]: {},
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);

    // Assert: claude-code mount is present
    const mounts = extended.mounts as string[];
    const claudeMount = mounts.find((m) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();

    // Assert: wezterm-server port is allocated
    const port = result.phases.portAssignment!.port!;
    expect(port).toBeGreaterThanOrEqual(22425);

    // Assert: both features present in generated config
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features[claudePath]).toBeDefined();
    expect(features[weztermPath]).toBeDefined();
  });
});
```

**What it validates:** A mount-only feature (claude-code) and a port+mount feature (wezterm-server) coexist in the same config without interference. Mounts and ports are independently resolved. Both features appear in the generated config.

#### Scenario C6: Version pinning

```typescript
describe("Scenario C6: version pinning passes through to feature options", () => {
  it("version option is preserved in generated config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          version: "1.0.20",
        },
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const features = extended.features as Record<string, Record<string, unknown>>;
    expect(features[featurePath].version).toBe("1.0.20");
  });
});
```

**What it validates:** User-specified version options pass through lace's pipeline unchanged. Lace does not modify non-mount, non-port options.

#### Scenario C7: Feature used in prebuildFeatures

```typescript
describe("Scenario C7: claude-code in prebuildFeatures", () => {
  it("mount still auto-injected when feature is in prebuildFeatures", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

    const config = {
      image: "node:24-bookworm",
      customizations: {
        lace: {
          prebuildFeatures: {
            [featurePath]: {},
          },
        },
      },
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      subprocess: createMockSubprocess(),
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];

    // Mount should be auto-injected even for prebuild features
    // (mounts are runtime config, not build-time)
    const claudeMount = mounts?.find((m) => m.includes(".claude"));
    expect(claudeMount).toBeDefined();
  });
});
```

**What it validates:** Mounts declared by prebuild features are still auto-injected into the runtime config. Unlike ports (which are build-time and cannot be resolved in prebuild features), mounts are Docker `run` flags and should work regardless of whether the feature is in `features` or `prebuildFeatures`.

#### Scenario C8: Explicit mount entry suppresses auto-injection

```typescript
describe("Scenario C8: explicit mount entry suppresses auto-injection", () => {
  it("user-written mount for claude-code/config prevents auto-injection", async () => {
    const featurePath = symlinkLocalFeature(ctx, "claude-code");

    const claudeDir = join(ctx.workspaceRoot, ".claude-dir");
    mkdirSync(claudeDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "claude-code/config": { source: claudeDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {},
      },
      mounts: [
        "${lace.mount(claude-code/config)}",
      ],
    };

    writeDevcontainerJson(ctx, config);

    const result = await runUp({
      workspaceFolder: ctx.workspaceRoot,
      skipDevcontainerUp: true,
      cacheDir: ctx.metadataCacheDir,
    });

    expect(result.exitCode).toBe(0);

    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];

    // Assert: exactly one claude mount (user's explicit entry, not duplicated)
    const claudeMounts = mounts.filter((m) => m.includes(".claude"));
    expect(claudeMounts).toHaveLength(1);
  });
});
```

**What it validates:** When the user explicitly writes `${lace.mount(claude-code/config)}` in the mounts array, lace does not auto-inject a duplicate. This mirrors the port auto-injection suppression behavior tested in wezterm-server scenario S5.

### Part 2: Unit test additions for metadata extraction

**File:** `packages/lace/src/lib/__tests__/feature-metadata.test.ts` (additions to existing file)

Add test cases that parse the real claude-code `devcontainer-feature.json` and verify `extractLaceCustomizations()` produces the expected output:

```typescript
describe("claude-code feature metadata", () => {
  it("extracts mount declaration with sourceMustBe", () => {
    const metadata = readRealFeatureMetadata("claude-code");
    const customs = extractLaceCustomizations(metadata);

    expect(customs.ports).toBeUndefined();
    expect(customs.mounts).toBeDefined();
    expect(customs.mounts!["config"]).toEqual({
      target: "/home/${_REMOTE_USER}/.claude",
      recommendedSource: "~/.claude",
      description: "Claude Code configuration, credentials, and session state",
      sourceMustBe: "directory",
    });
  });

  it("has no port declarations", () => {
    const metadata = readRealFeatureMetadata("claude-code");
    const customs = extractLaceCustomizations(metadata);
    expect(customs.ports).toBeUndefined();
  });
});
```

Where `readRealFeatureMetadata()` is a helper that reads and parses the actual `devcontainer-feature.json` from the repo's `devcontainers/features/src/` directory.

### Part 3: Documentation updates

#### Root README.md

Add claude-code to the features table:

```markdown
| Feature | Description |
|---------|-------------|
| [`wezterm-server`](devcontainers/features/src/wezterm-server/) | Installs `wezterm-mux-server` and `wezterm` CLI for headless terminal multiplexing via SSH domains. |
| [`claude-code`](devcontainers/features/src/claude-code/) | Installs Claude Code CLI via npm. Declares a lace mount for persistent `~/.claude` configuration. |
```

#### packages/lace/README.md

The README already references `claude-code/config` in examples:
- Mount template accessor example: `${lace.mount(claude-code/config)}`
- Mount declaration example with `claude-code` as a feature-level mount
- `sourceMustBe` discussion referencing the pattern

Verify these references match the actual feature metadata. Current references appear accurate. No changes needed unless the feature's `devcontainer-feature.json` is modified.

#### Cross-references in proposals

The following proposals reference `claude-code` and should be checked for accuracy:
- `2026-02-06-rfp-claude-tools-lace-feature.md` -- references a more ambitious scope (session bridge, env vars, agent awareness). The implemented feature is simpler. No changes needed; the RFP documents the original vision and the current feature is a valid subset.
- `2026-02-14-mount-template-variables.md`, `2026-02-15-mount-accessor-api.md` -- use `claude-code/config` as examples of mount template usage. These references are accurate.

No proposal changes are needed. The proposals document design-time thinking and the current feature aligns with the mount-related aspects they describe.

### Part 4: Manual verification workflow

Document a manual end-to-end verification procedure:

```sh
# 1. Ensure ~/.claude exists on the host
mkdir -p ~/.claude

# 2. Create a test workspace
mkdir -p /tmp/claude-test/.devcontainer
cat > /tmp/claude-test/.devcontainer/devcontainer.json <<'EOF'
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {},
    "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {}
  }
}
EOF

# 3. Configure mount source in lace settings
cat > ~/.config/lace/settings.json <<'EOF'
{
  "mounts": {
    "claude-code/config": { "source": "~/.claude" }
  }
}
EOF

# 4. Run lace up
cd /tmp/claude-test
lace up

# 5. Verify inside container
# - claude --version should output a version string
# - ls -la ~/.claude should show the mounted directory
# - stat -c '%a' ~/.claude should show 700
# - Touch a file in ~/.claude and verify it appears on the host

# 6. Cleanup
docker rm -f $(docker ps -aq --filter "label=devcontainer.local_folder=/tmp/claude-test")
rm -rf /tmp/claude-test
```

## Important Design Decisions

### Decision 1: Mount-only scenario test file separate from wezterm-server

**Decision:** Create a new `claude-code-scenarios.test.ts` file rather than adding claude-code tests to the existing wezterm-server or portless scenario files.

**Why:** Each feature-specific scenario file tests that feature's integration with lace using its real `devcontainer-feature.json`. The claude-code feature exercises a different code path (mount-only, `sourceMustBe` validation, no ports) than wezterm-server (ports + mounts) or portless (ports only). A dedicated file maintains the convention established by the existing scenario test files: one file per feature, named after the feature.

### Decision 2: Eight scenarios vs. the wezterm-server's six

**Decision:** Eight scenarios: C1 (auto-injection), C2 (settings override), C3 (sourceMustBe validation), C4 (Docker smoke), C5 (multi-feature), C6 (version pinning), C7 (prebuild), C8 (suppression).

**Why:** The claude-code feature exercises mount-specific paths that wezterm-server's test suite does not cover in isolation: validated mounts with `sourceMustBe`, prebuild feature mount auto-injection, and mount suppression. C7 (prebuild) is particularly important because the `packages/lace/README.md` prebuild example references `claude-code` as a prebuild feature, but no existing test validates that mount declarations from prebuild features are auto-injected into the runtime config.

### Decision 3: No `install.sh` unit tests in the scenario suite

**Decision:** `install.sh` validation is covered by Docker scenario C4 only. No shell-level unit tests for `install.sh`.

**Why:** The devcontainer features project has its own test framework (`dev-container-features-test-lib`) for testing `install.sh` scripts inside containers. The lace scenario tests focus on lace's behavior (metadata extraction, mount injection, config generation). C4 provides end-to-end confidence that `install.sh` works. Edge cases like missing npm or `_REMOTE_USER` variations are better tested through the feature's own test framework or by inspection, since they involve container-level behavior outside lace's scope.

### Decision 4: `_REMOTE_USER` is opaque to lace

**Decision:** The `${_REMOTE_USER}` variable in the mount target path is passed through verbatim by lace. No lace-side test validates its resolution.

**Why:** `_REMOTE_USER` is a devcontainer CLI variable resolved at container build time. Lace treats mount targets as opaque strings -- it does not resolve devcontainer variables. The `install.sh` script handles `_REMOTE_USER` correctly (defaulting to `root`, adjusting the path). Testing `_REMOTE_USER` resolution belongs in Docker-level feature tests (the C4 scenario indirectly validates this for the default user).

### Decision 5: Real feature metadata via symlink, not inline objects

**Decision:** Scenario tests use `symlinkLocalFeature(ctx, "claude-code")` to reference the real `devcontainer-feature.json`, not inline `FeatureMetadata` objects.

**Why:** This is the established pattern from `wezterm-server-scenarios.test.ts`. Using real metadata ensures the tests validate the actual feature manifest, catching errors like missing fields, typos in mount keys, or incorrect `sourceMustBe` values. The existing `up-mount.integration.test.ts` already covers the synthetic-metadata path.

## Edge Cases / Challenging Scenarios

### E1: Host `~/.claude` does not exist

When `recommendedSource` (`~/.claude`) does not exist and no settings override is configured, `sourceMustBe: "directory"` validation should fail with an actionable error message including the `description` field ("Claude Code configuration, credentials, and session state") and guidance on how to create the directory or configure a settings override. Scenario C3 tests this path.

### E2: `~/.claude` exists but is a file

If `~/.claude` is a file (not a directory), `sourceMustBe: "directory"` validation should fail. This is tested at the unit level in `up-mount.integration.test.ts` and does not need a dedicated scenario test. The validation logic in `mount-resolver.ts` uses `statSync().isDirectory()`.

### E3: Test isolation from host `~/.claude`

Scenario C3 needs the `recommendedSource` resolution to fail, but the test host might have `~/.claude`. The test must ensure isolation by providing a settings override that points to a nonexistent path, or by not providing any override and relying on lace's resolution order (settings override > recommendedSource). If neither is found, validation fails.

The cleanest approach: do not provide a settings override and temporarily override the `HOME` environment variable to a temp directory without `.claude/`. If `HOME` override is not practical, configure a settings override pointing to a guaranteed-nonexistent directory and expect the "source does not exist" error.

### E4: `install.sh` with `_REMOTE_USER=root`

When `_REMOTE_USER` is `root`, `install.sh` adjusts the config directory from `/home/root/.claude` to `/root/.claude`. This logic is container-level and outside lace's scope. The mount target in the `devcontainer-feature.json` uses `/home/${_REMOTE_USER}/.claude`, which the devcontainer CLI resolves. For root users, the `install.sh` script creates the directory at `/root/.claude` regardless of the mount target. This mismatch is a potential issue -- the mount target and the `install.sh` directory may differ for root users.

> NOTE: The root-user path mismatch (`/home/root/.claude` in mount target vs. `/root/.claude` in `install.sh`) may warrant updating either the `devcontainer-feature.json` target or the `install.sh` logic. This is outside the scope of the test plan but should be tracked.

### E5: npm not available

`install.sh` exits 1 with `"Error: npm is required. Install Node.js or add ghcr.io/devcontainers/features/node."` This is a container build-time failure, not a lace failure. Docker scenario C4 includes the Node.js feature as a prerequisite to avoid this. A dedicated test for the npm-missing case would require building a container without Node.js and verifying the build fails with the expected error message -- this is better suited to the feature's own test framework.

### E6: Feature used from GHCR registry vs. local path

When consumed from `ghcr.io/weftwiseink/devcontainer-features/claude-code:1`, lace fetches metadata via OCI manifest. When used as a local path, lace reads the local `devcontainer-feature.json`. Both paths extract `customizations.lace.mounts` the same way. Scenario tests use local paths; the existing `up-mount.integration.test.ts` covers the OCI path via mock subprocess.

### E7: Multiple features declaring mounts with same target

If another feature declared a mount with target `/home/${_REMOTE_USER}/.claude`, lace's target conflict detection would fail the config. This is tested at the unit level in existing mount validation tests. No feature-specific scenario is needed.

## Test Plan

### Scenario index

| ID | Description | Docker required | Level |
|----|-------------|:-:|-------|
| C1 | Mount auto-injection from feature metadata | No | Config generation |
| C2 | Mount resolution with settings override | No | Config generation |
| C3 | sourceMustBe validation rejects missing source | No | Config generation |
| C4 | Docker smoke test -- claude installed, permissions correct | Yes | Docker integration |
| C5 | Multi-feature coexistence with wezterm-server | No | Config generation |
| C6 | Version pinning passes through | No | Config generation |
| C7 | Prebuild feature mount auto-injection | No | Config generation |
| C8 | Explicit mount entry suppresses auto-injection | No | Config generation |

### Unit test additions

| File | Test | Level |
|------|------|-------|
| `feature-metadata.test.ts` | `extractLaceCustomizations` returns mount with `sourceMustBe` | Unit |
| `feature-metadata.test.ts` | No port declarations extracted | Unit |

### Running tests

- **Fast suite (C1-C3, C5-C8):** `pnpm test` -- runs with the standard vitest suite, no Docker needed.
- **Docker suite (C4):** Gated by `describe.skipIf(!isDockerAvailable())`. Can be run explicitly: `pnpm test -- --grep "Docker smoke"`.
- **Unit tests:** Included in standard `pnpm test` run.

### Verification criteria

- **Mount injection:** Generated `.lace/devcontainer.json` contains a bind mount with the correct source and target paths.
- **Settings override:** When settings specify a custom source, the generated mount uses it.
- **Validated mount failure:** When source directory does not exist, `runUp` returns a non-zero exit code.
- **Docker:** Container has `claude` on PATH and `.claude` directory with mode 700.
- **Coexistence:** Both claude-code mounts and wezterm-server ports appear in generated config.
- **Passthrough:** User options (version) are not modified by lace.
- **Suppression:** Explicit mount entries prevent auto-injection duplicates.

## Implementation Phases

### Phase 1: Unit test additions for metadata extraction

**Files to modify:**
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

**Changes:**
- Add a `readRealFeatureMetadata()` helper that reads `devcontainers/features/src/<name>/devcontainer-feature.json` from the repo
- Add test cases for `extractLaceCustomizations()` with the real claude-code metadata
- Verify mount declaration fields: `target`, `recommendedSource`, `description`, `sourceMustBe`
- Verify no port declarations are extracted

**Do NOT modify:**
- `feature-metadata.ts` (testing existing behavior, not changing it)
- Any other test files

**Success criteria:**
- `extractLaceCustomizations()` returns `{ mounts: { config: { target: "/home/${_REMOTE_USER}/.claude", recommendedSource: "~/.claude", description: "...", sourceMustBe: "directory" } } }` for the claude-code feature
- `ports` is undefined in the result
- All existing tests continue to pass

### Phase 2: Scenario test file

**Files to create:**
- `packages/lace/src/__tests__/claude-code-scenarios.test.ts`

**Dependencies:**
- Phase 1 (unit tests validate the metadata extraction that scenarios depend on)

**Contents:**
- Import helpers from `scenario-utils.ts`
- Import `runUp`, `clearMetadataCache`
- `beforeEach` / `afterEach` for workspace and cache setup/teardown
- Scenarios C1 through C8 as described in the Proposed Solution
- C4 (Docker smoke) wrapped in `describe.skipIf(!isDockerAvailable())`
- C7 (prebuild) uses `createMockSubprocess()` pattern from `portless-scenarios.test.ts`

**Do NOT modify:**
- `scenario-utils.ts` (reuse existing helpers as-is)
- `wezterm-server-scenarios.test.ts` or `portless-scenarios.test.ts`
- Any library code

**Success criteria:**
- `pnpm test` passes with C1-C3, C5-C8 (no Docker required)
- C4 passes when Docker is available and is skipped gracefully otherwise
- C3 correctly fails when source directory does not exist (requires isolation from host `~/.claude`)

### Phase 3: Documentation updates

**Files to modify:**
- `README.md` (root)

**Changes:**
- Add claude-code row to the features table in the root README

**Do NOT modify:**
- `packages/lace/README.md` (existing references are accurate)
- Any proposal documents (they document design-time context, not current state)
- `devcontainers/features/src/claude-code/README.md` (already comprehensive)

**Success criteria:**
- Root README lists both `wezterm-server` and `claude-code` in the features table
- Feature description matches the feature's `description` field in `devcontainer-feature.json`

### Phase 4: Verify existing test suite passes

**Files to verify:**
- All existing tests via `pnpm test`

**Changes:**
- None (this is a verification-only phase)

**Success criteria:**
- `pnpm --filter lace test` passes with zero failures
- New tests appear in the test output under `claude-code-scenarios` and `feature-metadata` describe blocks

## Open Questions

1. **Root user mount target mismatch:** The `devcontainer-feature.json` declares target `/home/${_REMOTE_USER}/.claude`, but `install.sh` uses `/root/.claude` when `_REMOTE_USER=root`. Should the `devcontainer-feature.json` be updated to handle this case, or is this an acceptable inconsistency since root containers are uncommon?

2. **Test isolation for C3:** What is the most reliable way to isolate C3 from the host's `~/.claude` directory? Options: (a) mock `homedir()` in the test, (b) override `HOME` env var, (c) configure a settings override pointing to a nonexistent path and verify the settings-path validation error. Option (c) is the simplest but tests a different failure mode than "no source exists at all."

3. **Docker test base image:** C4 uses `mcr.microsoft.com/devcontainers/base:ubuntu` with the Node.js feature. Should it use `node:24-bookworm` instead (already has npm, simpler image) or the devcontainer base image (closer to production usage)?
