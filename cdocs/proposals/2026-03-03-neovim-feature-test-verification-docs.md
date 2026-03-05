---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T18:00:00-08:00
task_list: lace/devcontainer-features
type: proposal
state: live
status: result_accepted
tags: [testing, neovim, devcontainer-features, mounts, scenario-tests, docker, documentation]
references:
  - devcontainers/features/src/neovim/devcontainer-feature.json
  - devcontainers/features/src/neovim/install.sh
  - devcontainers/features/src/neovim/README.md
  - devcontainers/features/src/wezterm-server/devcontainer-feature.json
  - packages/lace/src/__tests__/wezterm-server-scenarios.test.ts
  - packages/lace/src/__tests__/portless-scenarios.test.ts
  - packages/lace/src/__tests__/helpers/scenario-utils.ts
  - packages/lace/src/lib/feature-metadata.ts
  - packages/lace/src/lib/mount-resolver.ts
  - cdocs/proposals/2026-02-07-wezterm-server-feature-scenario-tests.md
  - cdocs/devlogs/2026-03-03-claude-code-neovim-features-and-proposals.md
---

# Neovim Devcontainer Feature: Test, Verification, and Documentation Plan

> **BLUF:** The neovim devcontainer feature (`devcontainers/features/src/neovim/`) was scaffolded alongside the claude-code feature but has no test coverage. This proposal defines three layers of testing: (1) unit tests verifying lace correctly extracts the mount declaration from `devcontainer-feature.json` metadata, (2) scenario tests following the `wezterm-server-scenarios.test.ts` pattern that scaffold a workspace with the neovim feature and verify generated config includes the auto-injected mount, and (3) Docker smoke tests that build a container with the feature and verify `nvim` is installed at the correct version with the plugin state directory created and correctly owned. The proposal also covers manual end-to-end verification (plugin persistence across rebuilds), edge cases (version tags, architecture detection, missing curl), and documentation updates to the root README and packages/lace README to reference the neovim feature.

## Objective

Establish comprehensive test coverage for the neovim devcontainer feature across three levels:

1. **Metadata correctness**: lace can parse the feature's `devcontainer-feature.json` and extract the `customizations.lace.mounts.plugins` declaration.
2. **Config generation**: `lace up` auto-injects the mount template and generates the correct `mounts` array entry in `.lace/devcontainer.json`.
3. **Runtime correctness**: the feature's `install.sh` produces a working neovim binary, creates the plugin state directory with correct ownership, and the mount persists plugin state across container rebuilds.

Secondary objective: update project documentation to reference the neovim feature as a first-class lace-managed devcontainer feature.

## Background

### Current state of the neovim feature

The neovim feature was scaffolded in commit `7dadccc` alongside the claude-code feature. It consists of three files:

- **`devcontainer-feature.json`**: Declares a single `version` option (default `v0.11.6`) and a lace mount declaration for `plugins` targeting `/home/${_REMOTE_USER}/.local/share/nvim` with `sourceMustBe: "directory"`.
- **`install.sh`**: Downloads a statically-linked neovim tarball from GitHub releases, extracts to `/usr/local/`, creates the plugin state directory, and sets ownership.
- **`README.md`**: Usage docs, options table, and mount persistence explanation.

The devlog (`cdocs/devlogs/2026-03-03-claude-code-neovim-features-and-proposals.md`) explicitly notes: "Features are scaffolds only -- no runtime testing in this session. Testing plan will be proposed in a follow-up session."

### How the neovim feature differs from wezterm-server

The neovim feature is simpler than wezterm-server in two ways:

1. **No port declarations**: neovim has no `customizations.lace.ports` -- it only declares mounts. This means the entire port allocation pipeline (templates, auto-injection, symmetric mapping) is irrelevant. The test focus is entirely on mount resolution.
2. **No entrypoint**: neovim is a tool binary, not a daemon. There is no entrypoint script, no mux-server, no SSH connectivity to verify. The Docker smoke test checks binary presence and version output rather than service connectivity.

The mount declaration is the distinguishing lace integration point. The `sourceMustBe: "directory"` constraint means lace validates the host source exists as a directory before proceeding -- a different code path from wezterm-server's `sourceMustBe: "file"` (authorized-keys) and from plain mounts with no validation.

### Existing test patterns

The codebase has two established scenario test files:

- **`wezterm-server-scenarios.test.ts`** (S1-S6): Tests port allocation, auto-injection, config generation, and Docker integration for a feature with ports and a validated file mount.
- **`portless-scenarios.test.ts`** (P1-P3): Tests asymmetric port injection for prebuild features, port persistence, and multi-feature coexistence.

Both use the helpers in `scenario-utils.ts` (`createScenarioWorkspace`, `symlinkLocalFeature`, `writeDevcontainerJson`, `readGeneratedConfig`). The neovim scenario tests will follow the same pattern but focus on mount auto-injection rather than port allocation.

### Mount resolution code path

When lace encounters the neovim feature in a devcontainer config:

1. `fetchFeatureMetadata()` reads `devcontainer-feature.json` (local path or OCI).
2. `extractLaceCustomizations()` extracts `customizations.lace.mounts.plugins` as a `LaceMountDeclaration`.
3. The mount is namespaced as `neovim/plugins` and auto-injected into the `mounts` array as `${lace.mount(neovim/plugins)}`.
4. `MountPathResolver.resolveSource("neovim/plugins")` hits the `sourceMustBe: "directory"` branch, which checks settings overrides then falls through to error (no `recommendedSource` is declared, so a settings override is required unless a default directory is auto-created).

> NOTE: The neovim feature's mount declares `sourceMustBe: "directory"` but does NOT declare `recommendedSource`. This means the validated-mount code path in `MountPathResolver.resolveValidatedSource()` will reach the "No source available" error unless the user configures a settings override. This differs from wezterm-server's authorized-keys mount which has both `sourceMustBe: "file"` and `recommendedSource`. The test plan must account for this -- either the feature should add a `recommendedSource` or tests must provide settings overrides.

## Proposed Solution

### Layer 1: Unit tests for metadata extraction

Add test cases to the existing `feature-metadata.test.ts` that verify `extractLaceCustomizations()` correctly parses the neovim feature's mount declaration.

**File:** `packages/lace/src/lib/__tests__/feature-metadata.test.ts` (extend existing)

```typescript
describe("extractLaceCustomizations - neovim feature", () => {
  it("extracts mount declaration with sourceMustBe: directory", () => {
    const metadata: FeatureMetadata = {
      id: "neovim",
      version: "1.0.0",
      options: {
        version: { type: "string", default: "v0.11.6" },
      },
      customizations: {
        lace: {
          mounts: {
            plugins: {
              target: "/home/node/.local/share/nvim",
              description: "Neovim plugin cache, undo history, and shada (persists across rebuilds)",
              sourceMustBe: "directory",
            },
          },
        },
      },
    };

    const lace = extractLaceCustomizations(metadata);
    expect(lace).not.toBeNull();
    expect(lace!.ports).toBeUndefined();
    expect(lace!.mounts).toBeDefined();
    expect(lace!.mounts!.plugins).toEqual({
      target: "/home/node/.local/share/nvim",
      description: "Neovim plugin cache, undo history, and shada (persists across rebuilds)",
      sourceMustBe: "directory",
    });
  });

  it("returns null ports when feature has only mounts", () => {
    const metadata: FeatureMetadata = {
      id: "neovim",
      version: "1.0.0",
      customizations: {
        lace: {
          mounts: {
            plugins: {
              target: "/home/node/.local/share/nvim",
              sourceMustBe: "directory",
            },
          },
        },
      },
    };

    const lace = extractLaceCustomizations(metadata);
    expect(lace!.ports).toBeUndefined();
    expect(lace!.mounts).toBeDefined();
  });
});
```

### Layer 2: Scenario tests for config generation

Create a new scenario test file following the wezterm-server pattern. Since the neovim feature has no ports, the scenarios focus on mount auto-injection and resolution.

**File:** `packages/lace/src/__tests__/neovim-scenarios.test.ts`

#### Scenario N1: Mount auto-injection from feature metadata

Verify that when the neovim feature is included in a devcontainer config with no explicit mount entries, lace auto-injects the `${lace.mount(neovim/plugins)}` template and resolves it to a complete mount spec in the generated config.

```typescript
describe("Scenario N1: mount auto-injection from neovim feature", () => {
  it("auto-injects neovim/plugins mount into generated config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    // Provide a settings override for the validated mount (sourceMustBe: directory)
    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
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

    // Assert: generated config includes a mount entry for neovim/plugins
    const extended = readGeneratedConfig(ctx);
    const mounts = extended.mounts as string[];
    expect(mounts).toBeDefined();

    const nvimMount = mounts.find((m) => m.includes(".local/share/nvim"));
    expect(nvimMount).toBeDefined();
    expect(nvimMount).toContain(`source=${pluginDir}`);
    expect(nvimMount).toContain("target=/home/node/.local/share/nvim");
    expect(nvimMount).toContain("type=bind");
  });
});
```

#### Scenario N2: No port allocation for mount-only feature

Verify that the neovim feature does not trigger port allocation since it has no port declarations.

```typescript
describe("Scenario N2: no port allocation for mount-only feature", () => {
  it("completes without port assignment phase", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
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

    // Assert: no port allocation occurred
    expect(result.phases.portAssignment?.message).toContain("No port templates found");

    // Assert: no port-related config generated
    const extended = readGeneratedConfig(ctx);
    expect(extended.appPort).toBeUndefined();
    expect(extended.forwardPorts).toBeUndefined();
    expect(extended.portsAttributes).toBeUndefined();
  });
});
```

#### Scenario N3: Coexistence with wezterm-server feature

Verify that neovim and wezterm-server can coexist in the same devcontainer config, each contributing their own mounts and (for wezterm-server) ports.

```typescript
describe("Scenario N3: neovim + wezterm-server coexistence", () => {
  it("both features contribute their mounts to generated config", async () => {
    const neovimPath = symlinkLocalFeature(ctx, "neovim");
    const weztermPath = symlinkLocalFeature(ctx, "wezterm-server");

    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    const keyPath = createTempSshKey(ctx);

    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
        "wezterm-server/authorized-keys": { source: keyPath },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [neovimPath]: {},
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
    const mounts = extended.mounts as string[];

    // Assert: neovim mount present
    const nvimMount = mounts.find((m) => m.includes(".local/share/nvim"));
    expect(nvimMount).toBeDefined();

    // Assert: wezterm-server authorized-keys mount present
    const sshMount = mounts.find((m) => m.includes("authorized_keys"));
    expect(sshMount).toBeDefined();

    // Assert: wezterm-server also got a port allocated
    expect(result.phases.portAssignment?.exitCode).toBe(0);
  });
});
```

#### Scenario N4: Version option passes through untouched

```typescript
describe("Scenario N4: version option unaffected by mount system", () => {
  it("version option passes through to generated config", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
    mkdirSync(pluginDir, { recursive: true });
    setupScenarioSettings(ctx, {
      mounts: {
        "neovim/plugins": { source: pluginDir },
      },
    });

    const config = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      features: {
        [featurePath]: {
          version: "v0.11.6",
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
    expect(features[featurePath].version).toBe("v0.11.6");
  });
});
```

#### Scenario N5: Missing mount source fails with actionable error

Verify that when no settings override is provided and no `recommendedSource` exists, lace produces a clear error about the missing validated mount source.

```typescript
describe("Scenario N5: missing mount source produces actionable error", () => {
  it("fails with guidance when neovim/plugins has no settings override", async () => {
    const featurePath = symlinkLocalFeature(ctx, "neovim");

    // No settings override for neovim/plugins
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

    // Assert: fails due to validated mount with no source
    expect(result.exitCode).not.toBe(0);
  });
});
```

> NOTE: Scenario N5 behavior depends on whether the feature's `sourceMustBe: "directory"` without `recommendedSource` triggers a hard error or whether lace auto-creates a default directory. The mount-resolver code path for `sourceMustBe` does NOT auto-create -- it requires either a settings override or a `recommendedSource`. Since the neovim feature has no `recommendedSource`, this should error. If the desired behavior is auto-creation for directory mounts (unlike file mounts), the feature should either add `recommendedSource` or the code path should be updated. See Design Decision 1.

### Layer 3: Docker smoke tests

Docker-based tests that actually build a container with the neovim feature and verify runtime behavior.

**File:** `packages/lace/src/__tests__/neovim-scenarios.test.ts` (same file, gated by Docker availability)

```typescript
describe.skipIf(!isDockerAvailable())(
  "Scenario N6: Docker smoke test -- neovim installed correctly",
  { timeout: 180_000 },
  () => {
    let containerId: string | null = null;

    afterEach(() => {
      if (containerId) {
        stopContainer(containerId);
        containerId = null;
      }
      cleanupWorkspaceContainers(ctx.workspaceRoot);
    });

    it("neovim binary exists at correct version, plugin dir has correct ownership", async () => {
      const featurePath = copyLocalFeature(ctx, "neovim");

      const pluginDir = join(ctx.workspaceRoot, "nvim-plugins");
      mkdirSync(pluginDir, { recursive: true });
      setupScenarioSettings(ctx, {
        mounts: {
          "neovim/plugins": { source: pluginDir },
        },
      });

      const config = {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        features: {
          [featurePath]: {
            version: "v0.11.6",
          },
        },
      };

      writeDevcontainerJson(ctx, config);

      // Phase A: Generate config
      const result = await runUp({
        workspaceFolder: ctx.workspaceRoot,
        skipDevcontainerUp: true,
        cacheDir: ctx.metadataCacheDir,
      });
      expect(result.exitCode).toBe(0);

      // Phase B: Build and start container
      prepareGeneratedConfigForDocker(
        ctx,
        new Map([[featurePath, "neovim"]]),
      );

      const upOutput = execSync(
        `devcontainer up --workspace-folder "${ctx.workspaceRoot}"`,
        { stdio: "pipe", timeout: 120_000 },
      ).toString();

      const parsed = JSON.parse(upOutput) as { containerId?: string };
      if (parsed.containerId) containerId = parsed.containerId;

      // Verify nvim binary exists and reports correct version
      const versionOutput = execSync(
        `docker exec ${containerId} nvim --version`,
        { stdio: "pipe" },
      ).toString();
      expect(versionOutput).toContain("NVIM v0.11.6");

      // Verify nvim is at /usr/local/bin/nvim
      const whichOutput = execSync(
        `docker exec ${containerId} which nvim`,
        { stdio: "pipe" },
      ).toString().trim();
      expect(whichOutput).toBe("/usr/local/bin/nvim");

      // Verify plugin state directory exists
      const lsOutput = execSync(
        `docker exec ${containerId} ls -la /home/vscode/.local/share/nvim`,
        { stdio: "pipe" },
      ).toString();
      expect(lsOutput).toBeTruthy();
    });
  },
);
```

#### Scenario N7: Architecture detection (aarch64)

This scenario cannot be tested directly on x86_64 CI but should be documented as a manual verification step. The `install.sh` architecture detection maps `aarch64` to `arm64` for the tarball URL.

#### Scenario N8: Missing curl produces actionable error

```typescript
describe.skipIf(!isDockerAvailable())(
  "Scenario N8: Docker -- missing curl fails gracefully",
  { timeout: 120_000 },
  () => {
    it("install.sh exits with error when curl is missing", () => {
      // Build a minimal container without curl and run install.sh directly
      const result = execSync(
        `docker run --rm alpine:latest sh -c "VERSION=v0.11.6 _REMOTE_USER=root sh" < ${FEATURES_SRC_DIR}/neovim/install.sh 2>&1 || true`,
        { stdio: "pipe", timeout: 30_000 },
      ).toString();
      expect(result).toContain("curl is required");
    });
  },
);
```

### Manual verification plan

For end-to-end verification that cannot be fully automated:

#### Plugin persistence verification

1. Start a container with the neovim feature and a configured mount source.
2. Open neovim and install plugins (e.g., via lazy.nvim bootstrap).
3. Verify plugins are written to `/home/<user>/.local/share/nvim/lazy/`.
4. Rebuild the container (`devcontainer rebuild`).
5. Open neovim again -- plugins should be present without re-downloading.
6. Measure: first open should NOT show "Installing X plugins" messages.

#### Prebuild compatibility verification

1. Add the neovim feature to `customizations.lace.prebuildFeatures`.
2. Run `lace prebuild` -- verify the prebuild image includes neovim.
3. Run `lace up` -- verify the container starts from the prebuilt image.
4. Verify `nvim --version` inside the container matches the requested version.

#### Cross-architecture verification (manual, aarch64 host)

1. On an aarch64 host (e.g., Apple Silicon Mac with Docker Desktop or Raspberry Pi), build a container with the neovim feature.
2. Verify `install.sh` downloads the `arm64` tarball variant.
3. Verify `nvim --version` works correctly.

## Important Design Decisions

### Decision 1: Address the missing `recommendedSource` on the mount declaration

**Decision:** The neovim feature's `devcontainer-feature.json` should add `"recommendedSource": "~/.local/share/nvim"` to the plugins mount declaration. This enables lace to use the host's own neovim plugin directory as the default source, which is the most natural behavior for developers who use neovim on their host machine.

**Why:** Without `recommendedSource`, the validated-mount code path in `MountPathResolver.resolveValidatedSource()` requires a settings override in `~/.config/lace/settings.json`. This makes the feature harder to adopt -- users must configure settings before `lace up` succeeds. Adding `recommendedSource` provides a sensible default (the host's own nvim data directory) while still allowing overrides. Developers who do not use neovim on the host will get a clear error with guidance on how to create the directory or configure an alternative.

Alternatively, the `sourceMustBe` could be removed entirely, letting lace auto-create a default directory under `~/.config/lace/<projectId>/mounts/neovim/plugins/`. This is simpler but less discoverable -- users might not realize their host neovim plugins could be shared.

> NOTE: This is a feature metadata change, not a lace code change. It should be implemented before or alongside the scenario tests, since several scenarios depend on the resolution behavior.

### Decision 2: Separate test file rather than extending wezterm-server-scenarios

**Decision:** Create a new file `neovim-scenarios.test.ts` rather than adding neovim tests to `wezterm-server-scenarios.test.ts`.

**Why:** The wezterm-server scenarios focus on port allocation and SSH connectivity. The neovim scenarios focus on mount auto-injection and validated directory mounts. These are different lace subsystems exercised through different features. Separate files make it clear which feature is being tested and allow independent execution. This follows the precedent of `portless-scenarios.test.ts` being separate from wezterm-server despite both being devcontainer features.

### Decision 3: Docker smoke tests in the same file with skip guard

**Decision:** Docker-dependent tests live in the same `neovim-scenarios.test.ts` file, gated by `describe.skipIf(!isDockerAvailable())`.

**Why:** This matches the wezterm-server-scenarios pattern exactly. The Docker tests share setup/teardown with the config-generation tests and benefit from being co-located. The skip guard ensures the fast test suite remains fast when Docker is unavailable. Developers can run Docker tests explicitly via `pnpm test -- --grep "Docker"`.

### Decision 4: Version tag edge cases tested at the config level only

**Decision:** Version tag variations (`stable`, `nightly`, specific tags) are tested at the config-generation level (verifying the option passes through to the generated config) rather than at the Docker level (actually downloading each variant).

**Why:** Downloading neovim tarballs for multiple versions would make the test suite slow and network-dependent. The install script's version handling is a simple string interpolation into a URL -- the risk is in the URL format, not in lace's config generation. One Docker test with a pinned version (`v0.11.6`) provides sufficient confidence. The `stable` and `nightly` tag formats can be verified by checking the GitHub releases API URL pattern without downloading.

## Edge Cases / Challenging Scenarios

### E1: `_REMOTE_USER` variable in target path

The neovim feature's mount target is `/home/${_REMOTE_USER}/.local/share/nvim`. The `${_REMOTE_USER}` variable is a devcontainer spec variable resolved at feature install time, not a lace template variable. Lace must NOT attempt to resolve it -- it should pass through as a literal string in the mount declaration. The `_REMOTE_USER` in the mount target should be treated as a static path segment by lace (it resolves to the actual user at install time via `install.sh`).

> NOTE: This is actually a subtle issue. The `devcontainer-feature.json` contains `${_REMOTE_USER}` in the target path, but lace reads this as a literal string since it does not process devcontainer spec variables. For local-path features, this means the mount target in lace's generated config will contain the literal string `${_REMOTE_USER}`, which Docker will NOT resolve. The target path in the mount declaration should use a concrete user name (e.g., `vscode` for the base devcontainer image) or lace needs to resolve `_REMOTE_USER` from the devcontainer context. This needs investigation -- the wezterm-server feature's mount hardcodes `/home/node/.ssh/authorized_keys` rather than using `${_REMOTE_USER}`.

### E2: Version tags `stable` and `nightly`

Neovim's GitHub releases use `stable` and `nightly` as tag names in addition to semver tags like `v0.11.6`. The install script URL construction works with all three:
- `https://github.com/neovim/neovim/releases/download/v0.11.6/nvim-linux-x86_64.tar.gz`
- `https://github.com/neovim/neovim/releases/download/stable/nvim-linux-x86_64.tar.gz`
- `https://github.com/neovim/neovim/releases/download/nightly/nvim-linux-x86_64.tar.gz`

All three are valid GitHub release download URLs. No special handling is needed in `install.sh`.

### E3: Unsupported architecture

The `install.sh` architecture detection only supports `x86_64` and `aarch64`. On any other architecture (e.g., `armv7l`, `s390x`), the script exits with a descriptive error. This is correct behavior -- neovim only publishes tarballs for these two architectures.

### E4: Missing curl

The `install.sh` checks for `curl` availability before attempting the download. If `curl` is missing, it exits with an error suggesting the `common-utils` devcontainer feature. This is tested in Scenario N8.

### E5: Tarball extraction failure

If the tarball download succeeds but extraction fails (corrupt download, disk full), `tar` exits non-zero and `set -eu` causes the script to abort. The error message from `tar` is sufficient for diagnosis. No additional handling is needed.

### E6: Plugin state directory ownership with non-root user

The `install.sh` creates the plugin directory and `chown`s it to `${_REMOTE_USER}`. If `_REMOTE_USER` is not set, it defaults to `root`. If the user specified in `_REMOTE_USER` does not exist in the container image at install time, `chown` fails. This is a general devcontainer feature concern (features run before the user is fully provisioned) and is handled by the devcontainers spec -- `_REMOTE_USER` is set to a user that exists.

### E7: Mount source is an empty directory

When a user configures a settings override pointing to an empty directory, the mount succeeds but neovim will re-download all plugins on first launch. This is expected -- the mount persistence benefit requires at least one prior plugin installation to populate the directory. Subsequent rebuilds preserve the populated state.

### E8: Prebuild interaction

When the neovim feature is in `prebuildFeatures`, its mount declaration is still processed by lace during `lace up`. Mount declarations are runtime config (Docker `--mount` flags) not build-time config, so there is no prebuild/runtime lifecycle asymmetry. The prebuild bakes the neovim binary into the image; the mount overlays the plugin state directory at container start time.

## Test Plan

### Test matrix

| ID | Description | Docker required | Level | Lace subsystem |
|----|-------------|:-:|-------|----------------|
| N1 | Mount auto-injection from feature metadata | No | Config generation | mount-resolver, template-resolver |
| N2 | No port allocation for mount-only feature | No | Config generation | port-allocator (negative) |
| N3 | Coexistence with wezterm-server | No | Config generation | mount-resolver, port-allocator |
| N4 | Version option passes through | No | Config generation | feature-metadata |
| N5 | Missing mount source error | No | Config generation | mount-resolver (validated) |
| N6 | Docker: nvim installed, correct version, dir ownership | Yes | Docker integration | install.sh |
| N7 | Architecture detection (manual, aarch64) | Yes (aarch64) | Manual verification | install.sh |
| N8 | Docker: missing curl error | Yes | Docker integration | install.sh |

### Unit tests (Layer 1)

Added to existing `feature-metadata.test.ts`:
- `extractLaceCustomizations` correctly parses mount-only features
- `parseMountDeclarationEntry` handles `sourceMustBe: "directory"` correctly
- No port declarations extracted from mount-only features

### Running tests

- **Fast suite (N1-N5):** `pnpm test` -- runs with the standard vitest suite, no Docker needed.
- **Docker suite (N6, N8):** Gated by `isDockerAvailable()`, skipped when Docker is unavailable. Run explicitly via `pnpm test -- --grep "Docker"`.
- **Manual (N7):** Requires aarch64 host, documented in verification plan above.

## Implementation Phases

### Phase 1: Fix the `recommendedSource` gap in feature metadata

**Files to modify:**
- `devcontainers/features/src/neovim/devcontainer-feature.json`

**Changes:**
- Add `"recommendedSource": "~/.local/share/nvim"` to the `plugins` mount declaration.
- Verify `_REMOTE_USER` usage in target path (see Edge Case E1 -- may need to hardcode a user or document the limitation).

**Do NOT modify:**
- `install.sh` (no behavioral change needed)
- `README.md` (will be updated in Phase 5)

**Success criteria:**
- `extractLaceCustomizations()` returns the updated mount declaration with `recommendedSource`.
- `MountPathResolver.resolveValidatedSource()` can resolve the mount without a settings override when `~/.local/share/nvim` exists on the host.

### Phase 2: Unit tests for metadata extraction

**Files to modify:**
- `packages/lace/src/lib/__tests__/feature-metadata.test.ts`

**Changes:**
- Add test cases for neovim feature metadata extraction as specified in Layer 1 above.

**Do NOT modify:**
- Any source files (this phase is test-only).

**Success criteria:**
- All new test cases pass.
- Existing test cases continue to pass.

### Phase 3: Scenario tests for config generation

**Files to create:**
- `packages/lace/src/__tests__/neovim-scenarios.test.ts`

**Changes:**
- Implement scenarios N1-N5 as specified in Layer 2 above.
- Follow the `wezterm-server-scenarios.test.ts` pattern for imports, setup/teardown, and assertion style.

**Dependencies:**
- Phase 1 (feature metadata must have `recommendedSource` for N1 to use the default resolution path, or all scenarios must use settings overrides).

**Do NOT modify:**
- `wezterm-server-scenarios.test.ts` (existing tests remain as-is).
- `portless-scenarios.test.ts` (existing tests remain as-is).
- `scenario-utils.ts` (existing helpers should be sufficient).

**Success criteria:**
- `pnpm test` passes with N1-N5 (no Docker required).
- Tests correctly exercise the mount auto-injection code path.
- Tests correctly verify that no port allocation occurs for mount-only features.

### Phase 4: Docker smoke tests

**Files to modify:**
- `packages/lace/src/__tests__/neovim-scenarios.test.ts` (add Docker-gated tests)

**Changes:**
- Add scenarios N6 and N8 as specified in Layer 3 above.
- Use `describe.skipIf(!isDockerAvailable())` pattern.
- Use `copyLocalFeature` (not `symlinkLocalFeature`) for Docker builds.
- Use `prepareGeneratedConfigForDocker` to rewrite absolute paths.

**Dependencies:**
- Phase 3 (shared setup/teardown with config-generation tests).

**Do NOT modify:**
- Any lace source code (this phase is test-only).

**Success criteria:**
- Tests skip gracefully when Docker is unavailable.
- When Docker is available, N6 verifies nvim binary, version output, and plugin directory existence.
- N8 verifies the curl-missing error message.

### Phase 5: Documentation updates

**Files to modify:**
- `README.md` (root): Add neovim to the features table alongside wezterm-server.
- `devcontainers/features/src/neovim/README.md`: Update if `recommendedSource` was added in Phase 1 (add guidance about host neovim plugin sharing).

**Changes to root README:**

The features table currently lists only wezterm-server:

```markdown
| Feature | Description |
|---------|-------------|
| [`wezterm-server`](devcontainers/features/src/wezterm-server/) | Installs `wezterm-mux-server` and `wezterm` CLI for headless terminal multiplexing via SSH domains. |
```

Should become:

```markdown
| Feature | Description |
|---------|-------------|
| [`neovim`](devcontainers/features/src/neovim/) | Installs Neovim from GitHub releases with lace mount for persistent plugin state. |
| [`wezterm-server`](devcontainers/features/src/wezterm-server/) | Installs `wezterm-mux-server` and `wezterm` CLI for headless terminal multiplexing via SSH domains. |
```

**Do NOT modify:**
- `packages/lace/README.md` -- no changes needed. The README documents lace's generic mount system; individual features are referenced through the root README's features table. The existing mount documentation already covers feature-level mount declarations with generic examples.

**Success criteria:**
- Root README lists the neovim feature.
- Feature README accurately reflects the current mount declaration (including `recommendedSource` if added).

## Open Questions

1. **Should the `${_REMOTE_USER}` in the mount target be resolved by lace or hardcoded?** The current `devcontainer-feature.json` uses `${_REMOTE_USER}` in the target path, but lace treats this as a literal string. Wezterm-server's mount hardcodes `/home/node/...`. Should the neovim feature also hardcode a user, or should lace learn to resolve `_REMOTE_USER`? Hardcoding is simpler but breaks for non-default users.

2. **Should `sourceMustBe: "directory"` without `recommendedSource` auto-create a default directory instead of erroring?** The current validated-mount code path requires either a settings override or a `recommendedSource`. For directory mounts (unlike file mounts), auto-creation is safe and matches the behavior of non-validated mounts. Should the `MountPathResolver` be updated to auto-create directories when `sourceMustBe: "directory"` and no other source is available?

3. **Should the claude-code feature get the same test treatment?** The claude-code feature was scaffolded in the same session and has a similar structure (mount declaration with `sourceMustBe: "directory"` and `recommendedSource: "~/.claude"`). A parallel `claude-code-scenarios.test.ts` file could be created with minimal additional effort. Should this be scoped into this proposal or handled separately?
