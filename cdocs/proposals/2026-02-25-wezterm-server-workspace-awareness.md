---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T14:30:00-06:00
task_list: lace/wezterm-server
type: proposal
state: live
status: implementation_wip
tags: [wezterm-server, devcontainer, workspace, mux-server, entrypoint, containerEnv, dx, cleanup]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-25T22:15:00-06:00
  round: 5
related_to:
  - cdocs/reports/2026-02-25-wezterm-workspace-awareness-research.md
  - cdocs/reports/2026-02-25-devcontainer-wezterm-lua-investigation.md
  - cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md
---

# Workspace-Aware wezterm-server: Eliminating the Per-Project wezterm.lua

> **BLUF:** The wezterm-server devcontainer feature gains workspace awareness
> through two changes: (1) `install.sh` writes a static wezterm config that
> reads `CONTAINER_WORKSPACE_FOLDER` via `os.getenv()`, plus an entrypoint
> script that auto-starts the mux server; (2) lace injects
> `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` into the intermediate
> `containerEnv` during `generateExtendedConfig`. The feature's
> `devcontainer-feature.json` declares the entrypoint (following the
> docker-in-docker pattern). This eliminates the per-project
> `.devcontainer/wezterm.lua`, its bind mount, the Dockerfile mkdir, and the
> user-level `postStartCommand`. Non-lace users add a single `containerEnv`
> entry (`"${containerWorkspaceFolder}"`) to opt in. Without the env var,
> the feature degrades gracefully to home-directory default. The research
> backing this approach is documented in
> `cdocs/reports/2026-02-25-wezterm-workspace-awareness-research.md`.

## Objective

Eliminate the per-project `.devcontainer/wezterm.lua` file and its
associated infrastructure by making the wezterm-server feature inherently
workspace-aware:

1. Remove `.devcontainer/wezterm.lua` (18-line file setting `default_cwd`).
2. Remove its bind mount from `devcontainer.json` mounts array.
3. Remove the Dockerfile `mkdir -p` preparing the mount target directory.
4. Remove the user-level `postStartCommand` for mux server startup.
5. Have the feature handle startup via the devcontainer entrypoint mechanism.
6. Have lace auto-inject workspace context as container environment variables.

## Background

### The Current Setup

Five coordinated pieces across four files:

| Piece | File | Purpose |
|---|---|---|
| `config.default_cwd = "/workspace/main"` | `.devcontainer/wezterm.lua:16` | Set workspace as default directory |
| Bind mount string | `.devcontainer/devcontainer.json` mounts[0] | Deliver lua file into container |
| `mkdir -p ~/.config/wezterm` | `.devcontainer/Dockerfile:100-104` | Create mount target directory |
| `wezterm-mux-server --daemonize` | `.devcontainer/devcontainer.json` postStartCommand | Start the mux server |
| Mount preservation assertion | `up-mount.integration.test.ts:1185-1189` | Prevent lace from removing the mount |

### What Lace Already Knows

`applyWorkspaceLayout()` in `workspace-layout.ts:171-175` computes the
container workspace folder from the worktree name and mount target. For the
lace project: `/workspace/lace/main`. This value is written to the
intermediate `.lace/devcontainer.json` and is immutable at runtime.

`generateExtendedConfig()` in `up.ts:644-749` already injects ports,
mounts, project labels, and run args into the intermediate config. Adding
env var injection follows the same pattern.

## Proposed Solution

### Architecture

| Component | Provider | Mechanism |
|---|---|---|
| Static wezterm.lua reading `os.getenv("CONTAINER_WORKSPACE_FOLDER")` | Feature `install.sh` | Written at build time to `/usr/local/share/wezterm-server/` |
| Entrypoint starting mux server as remote user | Feature metadata | `"entrypoint"` field in `devcontainer-feature.json` |
| `CONTAINER_WORKSPACE_FOLDER` env var | Lace (or manual `containerEnv`) | Injected into intermediate `containerEnv` with resolved path |
| `LACE_PROJECT_NAME` env var | Lace | Injected alongside workspace folder |

### Non-Lace Users

The feature works out of the box for mux server startup (via entrypoint).
For workspace awareness, add to `containerEnv`:

```jsonc
{ "CONTAINER_WORKSPACE_FOLDER": "${containerWorkspaceFolder}" }
```

Without this, panes open in the home directory (graceful degradation).

## Design Decisions

### D1: Static config reading env var vs. generated config per run

Feature installs a static `wezterm.lua` reading an environment variable.
Lace provides runtime context via env vars rather than generating
wezterm-specific config files. This keeps wezterm knowledge in the feature
and generic env var injection in lace.

### D2: Config at `/usr/local/share/wezterm-server/` (not `~/.config/wezterm/`)

Feature-owned directory avoids conflicting with user wezterm config.
Referenced via `--config-file` in the entrypoint. Users override by
replacing the file (bind mount or COPY) or replacing the entrypoint.

> NOTE: `WEZTERM_CONFIG_FILE` env var does NOT override `--config-file`
> CLI flag. Override the file or script itself.

### D3: Feature entrypoint (not user postStartCommand)

The mux server is infrastructure, not application logic. The
docker-in-docker feature establishes this pattern. Entrypoints run before
lifecycle hooks and have access to `containerEnv`.

### D4: Lace auto-injects env vars (no opt-in needed)

`CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` are universally
useful with no downside. Injected as resolved literals, avoiding
substitution timing issues. User-defined values take precedence (no
overwrite).

### D5: Entrypoint privilege drop via baked `$_REMOTE_USER`

Feature entrypoints run as root during container init. The entrypoint
uses `su -c "..." <user>` where the username is baked from `$_REMOTE_USER`
at install time — the same variable already used by `install.sh` for
runtime directory creation.

## Edge Cases

| Case | Behavior |
|---|---|
| User has custom `~/.config/wezterm/wezterm.lua` | Feature's `--config-file` takes precedence for mux server. User overrides by replacing the feature's config file or entrypoint. |
| Entrypoint ordering | wezterm-server declares `installsAfter: [sshd]`. No hard dependency on other entrypoints. |
| Workspace path changes between rebuilds | `CONTAINER_WORKSPACE_FOLDER` re-injected by lace on every `lace up`. |
| User explicitly sets `CONTAINER_WORKSPACE_FOLDER` | Lace does not overwrite. User value takes precedence. |
| Feature used without lace and without env var | Mux server starts via entrypoint. Panes open in home directory. |
| Entrypoint runs as root | `su -c` drops privileges to `$_REMOTE_USER` (baked at install time). |
| Feature not installed | `CONTAINER_WORKSPACE_FOLDER` (if injected by lace) is a harmless unused env var. |

## Implementation Phases

### Phase 1: Feature Changes (wezterm-server v1.3.0)

**Goal:** Make the wezterm-server feature self-starting and workspace-aware.

#### 1.1 Modify `devcontainers/features/src/wezterm-server/install.sh`

After the existing binary installation (line 75) and runtime directory
creation (line 83), append:

```sh
# ── Workspace-aware wezterm config ──

WEZTERM_SERVER_DIR="/usr/local/share/wezterm-server"
mkdir -p "$WEZTERM_SERVER_DIR"

# Static config: reads CONTAINER_WORKSPACE_FOLDER env var at runtime.
# Without the env var, default_cwd is not set (wezterm uses home dir).
cat > "$WEZTERM_SERVER_DIR/wezterm.lua" << 'WEZTERM_CONFIG'
local wezterm = require("wezterm")
local config = wezterm.config_builder()

local workspace = os.getenv("CONTAINER_WORKSPACE_FOLDER")
if workspace then
  config.default_cwd = workspace
end

return config
WEZTERM_CONFIG

# Entrypoint: starts mux server as the remote user (not root).
# $_REMOTE_USER is baked at install time — same variable used for
# runtime directory creation above.
_REMOTE_USER="${_REMOTE_USER:-root}"
cat > "$WEZTERM_SERVER_DIR/entrypoint.sh" << ENTRYPOINT
#!/bin/sh
# Auto-generated by wezterm-server feature install.
# Starts wezterm-mux-server as $_REMOTE_USER (baked at install time).
if [ "\$(id -u)" = "0" ] && [ "${_REMOTE_USER}" != "root" ]; then
  su -c 'wezterm-mux-server --daemonize --config-file $WEZTERM_SERVER_DIR/wezterm.lua 2>/dev/null || true' ${_REMOTE_USER}
else
  wezterm-mux-server --daemonize --config-file $WEZTERM_SERVER_DIR/wezterm.lua 2>/dev/null || true
fi
ENTRYPOINT
chmod +x "$WEZTERM_SERVER_DIR/entrypoint.sh"
```

#### 1.2 Modify `devcontainers/features/src/wezterm-server/devcontainer-feature.json`

Add the `entrypoint` field and bump version:

```diff
 {
   "name": "Wezterm Server",
   "id": "wezterm-server",
-  "version": "1.2.0",
+  "version": "1.3.0",
   "description": "Installs wezterm-mux-server and wezterm CLI for headless terminal multiplexing via SSH domains. Extracts binaries from platform-native packages to avoid X11/Wayland GUI dependencies.",
+  "entrypoint": "/usr/local/share/wezterm-server/entrypoint.sh",
   "options": {
```

#### 1.3 Update `devcontainers/features/src/wezterm-server/README.md`

Update the usage section. Replace the `postStartCommand` example:

```diff
-  "postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"
+  // No postStartCommand needed — the feature auto-starts the mux server.
```

Add a new "Workspace awareness" section documenting:
- The `CONTAINER_WORKSPACE_FOLDER` env var.
- How to set it for non-lace users (`"${containerWorkspaceFolder}"` in
  `containerEnv`).
- Graceful degradation without the env var.
- That lace injects it automatically.

Update the "What gets installed" section to include:
- `/usr/local/share/wezterm-server/wezterm.lua` -- workspace-aware config
- `/usr/local/share/wezterm-server/entrypoint.sh` -- mux server startup

#### 1.4 Tests

**File existence tests** (extend existing feature test harness or add new):

```
Verify /usr/local/share/wezterm-server/wezterm.lua exists after install
Verify /usr/local/share/wezterm-server/entrypoint.sh exists and is executable
Verify wezterm.lua contains os.getenv("CONTAINER_WORKSPACE_FOLDER")
Verify entrypoint.sh contains the baked $_REMOTE_USER value
Verify entrypoint.sh contains --config-file pointing to wezterm.lua
```

**Entrypoint behavior tests** (container-level, may require E2E):

```
Start container with feature installed, no postStartCommand:
  Assert wezterm-mux-server process is running
  Assert process owner is $_REMOTE_USER (not root)

Start container with CONTAINER_WORKSPACE_FOLDER=/workspace/test:
  Assert wezterm-mux-server is running
  Connect via wezterm CLI, spawn pane
  Assert pane cwd is /workspace/test

Start container WITHOUT CONTAINER_WORKSPACE_FOLDER:
  Assert wezterm-mux-server is running
  Connect via wezterm CLI, spawn pane
  Assert pane cwd is $HOME (graceful fallback)
```

**su -c env var inheritance test:**

```
Start container as root with CONTAINER_WORKSPACE_FOLDER=/workspace/test:
  Entrypoint su's to node
  Assert the wezterm-mux-server process can read CONTAINER_WORKSPACE_FOLDER
  (su without -l preserves parent env on Debian-based images)
```

#### 1.5 Constraints

- Do NOT modify any lace code (`packages/lace/`).
- Do NOT modify `.devcontainer/devcontainer.json` (keep existing setup as
  fallback during Phase 1).
- The feature must work standalone without lace.

---

### Phase 2: Lace Changes (env var injection)

**Goal:** Have lace auto-inject `CONTAINER_WORKSPACE_FOLDER` and
`LACE_PROJECT_NAME` into the intermediate `containerEnv`.

#### 2.1 Modify `packages/lace/src/lib/up.ts` -- `generateExtendedConfig()`

Insert after the project name injection block (after line 738, before the
"Write extended config" comment at line 740):

```typescript
// Auto-inject standard container env vars.
// These are universally useful and have no downside. User-defined values
// take precedence (no overwrite).
const containerEnv = (extended.containerEnv ?? {}) as Record<string, string>;
if (
  typeof extended.workspaceFolder === "string" &&
  !containerEnv.CONTAINER_WORKSPACE_FOLDER
) {
  containerEnv.CONTAINER_WORKSPACE_FOLDER = extended.workspaceFolder as string;
}
if (options.projectName && !containerEnv.LACE_PROJECT_NAME) {
  containerEnv.LACE_PROJECT_NAME = options.projectName;
}
extended.containerEnv = containerEnv;
```

#### 2.2 Tests -- new describe block in `up-mount.integration.test.ts`

Add after the existing "mount source in containerEnv" describe block
(after line 547):

```typescript
// ── Auto-injected container env vars ──

describe("lace up: auto-injected containerEnv vars", () => {
  it("injects CONTAINER_WORKSPACE_FOLDER from workspaceFolder", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        customizations: {
          lace: {
            workspace: { layout: "bare-worktree", mountTarget: "/workspace" },
          },
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.CONTAINER_WORKSPACE_FOLDER).toBe(
      extended.workspaceFolder,
    );
  });

  it("injects LACE_PROJECT_NAME from derived project name", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      { image: "mcr.microsoft.com/devcontainers/base:ubuntu" },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.LACE_PROJECT_NAME).toBeDefined();
    expect(typeof containerEnv.LACE_PROJECT_NAME).toBe("string");
    expect(containerEnv.LACE_PROJECT_NAME.length).toBeGreaterThan(0);
  });

  it("does not overwrite user-defined CONTAINER_WORKSPACE_FOLDER", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        containerEnv: {
          CONTAINER_WORKSPACE_FOLDER: "/custom/path",
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const containerEnv = extended.containerEnv as Record<string, string>;
    expect(containerEnv.CONTAINER_WORKSPACE_FOLDER).toBe("/custom/path");
  });

  it("does not inject CONTAINER_WORKSPACE_FOLDER when workspaceFolder absent", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    // Image-only config with no workspace layout — workspaceFolder not set
    const config = JSON.stringify(
      { image: "mcr.microsoft.com/devcontainers/base:ubuntu" },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    // Precondition: verify workspaceFolder is actually absent.
    // If lace's defaults change to always set workspaceFolder, this test
    // needs a different fixture to remain meaningful.
    expect(extended.workspaceFolder).toBeUndefined();

    const containerEnv = extended.containerEnv as Record<string, string> | undefined;
    expect(containerEnv?.CONTAINER_WORKSPACE_FOLDER).toBeUndefined();
  });

  it("preserves existing containerEnv entries alongside injected vars", async () => {
    trackProjectMountsDir(workspaceRoot);
    setupSettings({});

    const config = JSON.stringify(
      {
        image: "mcr.microsoft.com/devcontainers/base:ubuntu",
        containerEnv: {
          NODE_OPTIONS: "--max-old-space-size=4096",
          MY_CUSTOM_VAR: "hello",
        },
        customizations: {
          lace: {
            workspace: { layout: "bare-worktree", mountTarget: "/workspace" },
          },
        },
      },
      null,
      2,
    );
    setupWorkspace(config);

    const result = await runUp({
      workspaceFolder: workspaceRoot,
      subprocess: createMock(),
      skipDevcontainerUp: true,
    });

    expect(result.exitCode).toBe(0);

    const extended = JSON.parse(
      readFileSync(join(laceDir, "devcontainer.json"), "utf-8"),
    );
    const containerEnv = extended.containerEnv as Record<string, string>;

    // Original vars preserved
    expect(containerEnv.NODE_OPTIONS).toBe("--max-old-space-size=4096");
    expect(containerEnv.MY_CUSTOM_VAR).toBe("hello");

    // Injected vars present
    expect(containerEnv.CONTAINER_WORKSPACE_FOLDER).toBeDefined();
    expect(containerEnv.LACE_PROJECT_NAME).toBeDefined();
  });
});
```

#### 2.3 Integration test

Run `lace up --skip-devcontainer-up` on the lace project itself and verify
the generated `.lace/devcontainer.json` contains:

```json
"containerEnv": {
  "NODE_OPTIONS": "--max-old-space-size=4096",
  "CLAUDE_CONFIG_DIR": "/home/node/.claude",
  "CONTAINER_WORKSPACE_FOLDER": "/workspace/lace/main",
  "LACE_PROJECT_NAME": "lace"
}
```

#### 2.4 Constraints

- Do NOT modify feature code (`devcontainers/features/`).
- Do NOT modify `.devcontainer/` files yet (Phase 3).
- Env var injection must not break any existing tests (run full suite).

---

### Phase 3: Cleanup (remove per-project wezterm.lua)

**Goal:** Remove the old infrastructure. The feature now handles everything.

#### 3.1 Delete `.devcontainer/wezterm.lua`

```sh
git rm .devcontainer/wezterm.lua
```

#### 3.2 Modify `.devcontainer/devcontainer.json`

Remove the wezterm.lua bind mount from the mounts array (currently the only
static mount — the array becomes empty or can be removed):

```diff
  "mounts": [
-   "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
  ],
```

Remove `postStartCommand` (the feature's entrypoint handles mux server
startup):

```diff
- "postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"
```

> NOTE: If other lifecycle commands are later added to `postStartCommand`,
> the field can be re-added. For now, the feature entrypoint is the only
> consumer.

#### 3.3 Modify `.devcontainer/Dockerfile` (lines 100-104)

Remove the wezterm config directory creation. The SSH directory setup on
lines 93-98 stays (still needed for authorized_keys).

```diff
- # Set up wezterm config directory for bind-mounted wezterm.lua
- # NOTE: The wezterm.lua file itself is delivered via bind mount in devcontainer.json
- # (not COPY) so changes take effect without rebuilding the container.
- RUN mkdir -p /home/${USERNAME}/.config/wezterm && \
-     chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}/.config
```

#### 3.4 Update `up-mount.integration.test.ts` (lines 1138-1191)

The test "deduplicates static mount targeting same path as feature mount
declaration" currently includes a wezterm.lua mount in its fixture config
and asserts it is preserved (lines 1147, 1185-1189). Update:

Remove the wezterm.lua mount from the test fixture's `mounts` array:

```diff
  mounts: [
    "source=${localEnv:HOME}/.ssh/old_key.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
-   "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly",
  ],
```

Remove the wezterm.lua preservation assertion:

```diff
- // The unrelated wezterm.lua mount should be preserved
- const weztermMount = mounts.find((m: string) =>
-   m.includes("wezterm.lua"),
- );
- expect(weztermMount).toBeDefined();
```

#### 3.5 Verify no orphaned references

```sh
# Should return no results in .devcontainer/
grep -r "wezterm.lua" .devcontainer/

# Should return no results in Dockerfile
grep "wezterm" .devcontainer/Dockerfile
# (SSH-related lines should NOT match — they reference .ssh, not wezterm)

# Feature README should still reference wezterm (it owns the feature)
grep -l "wezterm" devcontainers/features/src/wezterm-server/
```

#### 3.6 E2E verification

Run `lace up --skip-devcontainer-up` and verify:

1. `.lace/devcontainer.json` has NO wezterm.lua mount in mounts array.
2. `.lace/devcontainer.json` has NO `postStartCommand` (or has it without
   wezterm-mux-server).
3. `.lace/devcontainer.json` has `CONTAINER_WORKSPACE_FOLDER` and
   `LACE_PROJECT_NAME` in `containerEnv`.
4. The mounts array contains only auto-injected mounts (SSH key,
   bash-history, claude-config).

#### 3.7 Update related documents

- Update `cdocs/reports/2026-02-25-devcontainer-wezterm-lua-investigation.md`
  frontmatter: set `state: archived` and add NOTE that the investigation
  findings led to the workspace-awareness implementation.
- Update feature `README.md` examples to show simplified devcontainer.json
  without `postStartCommand` or wezterm.lua mount.

#### 3.8 Constraints

- Do NOT modify lace source code (`packages/lace/src/`).
- Do NOT modify feature install scripts (Phase 1 is already done).
- Run full test suite after changes to catch regressions.

## Summary of File Changes

| File | Phase | Change |
|---|---|---|
| `devcontainers/features/src/wezterm-server/install.sh` | 1 | Append config + entrypoint generation |
| `devcontainers/features/src/wezterm-server/devcontainer-feature.json` | 1 | Add `entrypoint`, bump to v1.3.0 |
| `devcontainers/features/src/wezterm-server/README.md` | 1, 3 | Document workspace awareness; update examples |
| `packages/lace/src/lib/up.ts` | 2 | Add env var injection in `generateExtendedConfig()` (after line 738) |
| `packages/lace/src/lib/__tests__/up-mount.integration.test.ts` | 2, 3 | Add env var injection tests; remove wezterm.lua fixture/assertion |
| `.devcontainer/wezterm.lua` | 3 | Delete |
| `.devcontainer/devcontainer.json` | 3 | Remove wezterm.lua mount + postStartCommand |
| `.devcontainer/Dockerfile` | 3 | Remove wezterm config mkdir (lines 100-104) |
