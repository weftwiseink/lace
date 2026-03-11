---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-07T14:00:00-08:00
task_list: lace/mount-resolver
type: proposal
state: archived
status: result_accepted
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-07T15:30:00-06:00
  round: 1
tags: [mount-resolver, remote-user, devcontainer-variables, feature-metadata, target-resolution]
related_to:
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/reports/2026-03-07-weftwise-lace-migration-failure-analysis.md
  - cdocs/reports/2026-02-05-claude-devcontainer-bundling.md
  - cdocs/proposals/2026-03-03-claude-code-feature-test-verification-plan.md
  - cdocs/proposals/2026-03-03-neovim-feature-test-verification-docs.md
---

# Resolve `${_REMOTE_USER}` in Mount Targets

> BLUF: The mount resolver's `resolveTarget()` and `resolveFullSpec()` pass `decl.target` through verbatim, which means feature metadata mount targets containing `${_REMOTE_USER}` (used by `claude-code` and `neovim` features) produce literal `${_REMOTE_USER}` in Docker mount specs. Docker creates directories named `${_REMOTE_USER}` instead of resolving to the actual container user (e.g., `node`). The fix is to add a devcontainer variable resolution step in `MountPathResolver` that substitutes `${_REMOTE_USER}` with a value determined from the devcontainer config's `remoteUser` field, the Dockerfile's `USER` directive, or a configurable default. This also resolves `${containerWorkspaceFolder}` as a second commonly-used devcontainer variable. The resolution happens at the `MountPathResolver` level so that both `resolveTarget()` and `resolveFullSpec()` produce correct paths, and target conflict detection in `validateMountTargetConflicts()` compares resolved paths rather than template strings.
>
> - **Key source files:** `mount-resolver.ts` (`resolveTarget`, `resolveFullSpec`), `template-resolver.ts` (`validateMountTargetConflicts`), `devcontainer.ts` (config parsing, `extractRemoteUser`), `dockerfile.ts` (existing `DockerfileParser` usage, new `parseDockerfileUser`), `up.ts` (pipeline orchestration), `feature-metadata.ts` (`LaceMountDeclaration`), `bin/lace-discover` (parallel runtime implementation)
> - **Motivated by:** weftwise migration failure where `claude-code` and `neovim` feature mount targets with `${_REMOTE_USER}` created literal directories; workaround was hardcoding mount overrides in `devcontainer.json`

## Objective

Enable lace to resolve devcontainer spec variables (primarily `${_REMOTE_USER}`) in feature metadata mount target paths, so that features can portably declare user-relative mount targets without requiring per-project hardcoded overrides.

The system should:

1. **Resolve `${_REMOTE_USER}` in mount targets** to the actual container username before generating Docker mount specs.
2. **Determine the remote user** from the devcontainer config (`remoteUser` field), falling back to Dockerfile `USER` directive analysis, then to a configurable default.
3. **Resolve targets before conflict detection** so that `validateMountTargetConflicts()` compares concrete paths, not template strings (two features targeting `/home/${_REMOTE_USER}/.config` and `/home/node/.config` should conflict when `remoteUser` is `node`).
4. **Support `${containerWorkspaceFolder}`** as a secondary devcontainer variable that features may use in mount targets.

## Background

### The Bug

The `claude-code` and `neovim` devcontainer features declare mount targets using the devcontainer spec variable `${_REMOTE_USER}`:

```json
// claude-code/devcontainer-feature.json
"target": "/home/${_REMOTE_USER}/.claude"

// neovim/devcontainer-feature.json
"target": "/home/${_REMOTE_USER}/.local/share/nvim"
```

The `_REMOTE_USER` variable is a standard devcontainer spec variable that the devcontainer CLI resolves at feature install time in `install.sh` scripts. However, lace's mount resolver operates at config generation time (before the devcontainer CLI runs), and it passes `decl.target` through without any variable substitution.

The result: Docker receives mount specs like `target=/home/${_REMOTE_USER}/.claude`, interprets the literal string as a path, and creates a directory called `${_REMOTE_USER}` inside `/home/`. The feature's `install.sh` correctly creates `/home/node/.claude`, but the mount points to the wrong path.

### Current Workaround

The weftwise project works around this by hardcoding explicit mount overrides in `devcontainer.json` that bypass the feature's declared target:

```json
"mounts": [
  "source=/path/to/host/.claude,target=/home/node/.claude,type=bind"
]
```

This defeats the purpose of feature-declared mount metadata and requires every project to know the container username.

### How `_REMOTE_USER` is Determined

The devcontainer spec defines `_REMOTE_USER` resolution order:

1. **`remoteUser`** field in `devcontainer.json` (explicit)
2. **`USER`** directive in the Dockerfile (implicit, the last `USER` before the end of the build stage)
3. **`root`** (default when neither is specified)

The `lace-discover` script (`bin/lace-discover`, lines 89-105) already implements a similar resolution for SSH user detection at runtime: it reads `remoteUser` from the container's `devcontainer.metadata` label, falls back to `Config.User`, then defaults to `node`.

### DRY with `lace-discover`

The remote user resolution logic (remoteUser > fallback > default) exists in two places:

1. **`bin/lace-discover` (bash, lines 89-105):** Resolves the SSH-accessible user at **runtime** by inspecting a running container's `devcontainer.metadata` label for `remoteUser`, falling back to `Config.User` from `docker inspect`, then defaulting to `"node"`.
2. **`extractRemoteUser()` (TypeScript, this proposal):** Resolves the container user at **config-generation time** by reading `remoteUser` from `devcontainer.json`, falling back to the Dockerfile `USER` directive, then defaulting to `"root"`.

These are parallel implementations of the same conceptual operation ("determine the container's remote user") but they operate in different contexts with different inputs:

| | `lace-discover` (bash) | `extractRemoteUser` (TypeScript) |
|---|---|---|
| **When** | Runtime (container running) | Config generation (before build) |
| **Input** | Container metadata labels, `docker inspect` | `devcontainer.json`, Dockerfile source |
| **Fallback** | `Config.User` from Docker | `USER` directive from Dockerfile |
| **Default** | `"node"` | `"root"` |

**Default inconsistency:** `lace-discover` defaults to `"node"` because it operates in a lace project context where node-based images are the convention and `root` is treated as "unset" (line 104: `[[ -z "$user" || "$user" == "root" ]] && user="node"`). The TypeScript `extractRemoteUser()` defaults to `"root"` per the devcontainer spec, which is correct for the general case but may surprise lace users who expect the `node` convention. This is addressed in Design Decision D3 below.

**DRY strategy:** Because the two implementations operate on fundamentally different inputs (running container metadata vs source files), a shared function is not practical. Instead, we adopt a **shared contract with cross-validation**:

1. **Document the shared contract.** Both implementations follow the same three-tier resolution order: explicit `remoteUser` > inspected/parsed user > default. The contract is: "if a project sets `remoteUser` explicitly, both implementations agree; if the Dockerfile sets `USER`, both agree (lace-discover reads `Config.User` which reflects the Dockerfile USER); they only diverge on the default."
2. **Add a cross-reference comment** in both `bin/lace-discover` and `extractRemoteUser()` pointing to each other as the parallel implementation.
3. **Add an integration test** that validates both agree for a given devcontainer project: run `lace up` to get the resolved remote user, then `lace-discover` on the running container, and assert the users match. This test would be part of the existing scenario test suite.
4. **Future consideration:** If the default divergence causes real bugs, introduce a `lace resolve-user` subcommand that both `lace-discover` (via shell-out) and the TypeScript code path can call. This is deferred because the divergence only affects the fallback case (no `remoteUser`, no Dockerfile USER), which is rare in practice and best resolved by the user setting `remoteUser` explicitly.

### Previous Design Decisions

The earlier neovim and claude-code feature test proposals (March 2026) explicitly noted that `${_REMOTE_USER}` was "passed through verbatim" by lace, treating it as "a devcontainer spec variable resolved at install time, not a lace template variable." This was a conscious design choice at the time, but it turns out to be incorrect for mount targets -- `install.sh` resolves `_REMOTE_USER` for file operations inside the container, but Docker mount specs are evaluated by the Docker daemon before the container runs, so devcontainer variables in mount targets are never resolved by anyone.

### Existing Variable Resolution in Lace

Lace already resolves two families of template variables:

1. **`${lace.port(...)}`** -- resolved by `template-resolver.ts` via regex matching and `PortAllocator`
2. **`${lace.mount(...)}`** -- resolved by `template-resolver.ts` via regex matching and `MountPathResolver`

Both operate on the devcontainer config at the string level, walking the config tree and replacing template expressions. The `${_REMOTE_USER}` resolution is different: it operates on values within the `LaceMountDeclaration.target` field, not on devcontainer.json config strings directly. The resolution should therefore happen inside `MountPathResolver` rather than in `template-resolver.ts`.

## Proposed Solution

### Architecture

Introduce a `ContainerVariableResolver` that resolves devcontainer spec variables (`${_REMOTE_USER}`, `${containerWorkspaceFolder}`) in mount target strings. This resolver is created during the `lace up` pipeline and injected into `MountPathResolver`.

The resolution order for `_REMOTE_USER`:

1. Explicit `remoteUser` field in `devcontainer.json` (highest priority)
2. `USER` directive parsed from the Dockerfile (if Dockerfile-based build)
3. Default value `"root"` (per devcontainer spec)

The resolution happens eagerly when `MountPathResolver` is constructed: all declaration targets are resolved before any `resolveTarget()` or `resolveFullSpec()` calls.

### Code Changes

#### 1. New type: `ContainerVariables` in `mount-resolver.ts`

```typescript
/** Variables available for resolution in mount target paths. */
export interface ContainerVariables {
  /** The container's remote user (from remoteUser, Dockerfile USER, or default). */
  remoteUser: string;
  /** The container workspace folder path (from workspaceFolder in config). */
  containerWorkspaceFolder?: string;
}
```

#### 2. Target resolution method in `MountPathResolver`

Add a private method that substitutes devcontainer variables in target strings:

```typescript
private resolveTargetVariables(target: string): string {
  let resolved = target;
  if (this.containerVars) {
    resolved = resolved.replace(
      /\$\{_REMOTE_USER\}/g,
      this.containerVars.remoteUser,
    );
    if (this.containerVars.containerWorkspaceFolder) {
      resolved = resolved.replace(
        /\$\{containerWorkspaceFolder\}/g,
        this.containerVars.containerWorkspaceFolder,
      );
    }
  }
  return resolved;
}
```

#### 3. Apply resolution in constructor

In the `MountPathResolver` constructor, resolve all declaration targets eagerly:

```typescript
constructor(
  workspaceFolder: string,
  settings: LaceSettings,
  declarations: Record<string, LaceMountDeclaration> = {},
  containerVars?: ContainerVariables,
) {
  this.containerVars = containerVars;
  // Deep-copy declarations and resolve variables in targets
  this.declarations = {};
  for (const [label, decl] of Object.entries(declarations)) {
    this.declarations[label] = {
      ...decl,
      target: this.resolveTargetVariables(decl.target),
    };
  }
  // ... rest of constructor
}
```

#### 4. Extract `remoteUser` from config in `up.ts`

In `runUp()`, extract the remote user before creating `MountPathResolver`:

```typescript
// Determine container remote user for variable resolution
const remoteUser = extractRemoteUser(configMinimal.raw, configMinimal.configDir);
const containerVars: ContainerVariables = {
  remoteUser,
  containerWorkspaceFolder:
    typeof configMinimal.raw.workspaceFolder === "string"
      ? configMinimal.raw.workspaceFolder
      : undefined,
};

const mountResolver = new MountPathResolver(
  workspaceFolder,
  settings,
  mountDeclarations,
  containerVars,
);
```

#### 5. `extractRemoteUser()` function in `devcontainer.ts`

```typescript
import { readFileSync } from "node:fs";
import { parseDockerfileUser } from "./dockerfile.js";

/**
 * Extract the remote user from a devcontainer config.
 * Resolution order:
 * 1. remoteUser field (explicit)
 * 2. Dockerfile USER directive (if Dockerfile-based build)
 * 3. "root" (devcontainer spec default)
 *
 * NOTE: This implements the same resolution semantics as lace-discover
 * (bin/lace-discover, lines 89-105), which resolves the remote user at
 * runtime from container metadata. This operates at config-generation time
 * from source files. See "DRY with lace-discover" section below for the
 * shared contract between these two implementations.
 */
export function extractRemoteUser(
  raw: Record<string, unknown>,
  configDir: string,
): string {
  // 1. Explicit remoteUser
  if (typeof raw.remoteUser === "string") {
    return raw.remoteUser;
  }

  // 2. Dockerfile USER directive
  try {
    const buildSource = resolveBuildSource(raw, configDir);
    if (buildSource.kind === "dockerfile") {
      const content = readFileSync(buildSource.path, "utf-8");
      const user = parseDockerfileUser(content);
      if (user) return user;
    }
  } catch {
    // resolveBuildSource throws when no build source is found (e.g.,
    // malformed config). Fall through to default.
  }

  // 3. Default
  return "root";
}
```

#### 6. `parseDockerfileUser()` function added to EXISTING `dockerfile.ts`

Add a function to the existing `packages/lace/src/lib/dockerfile.ts` that uses the `DockerfileParser` already imported there. The function accepts a Dockerfile content string (consistent with the existing `parseDockerfile(content: string)` signature pattern) and uses bottom-up iteration over the AST instructions to find the USER directive in the final build stage:

```typescript
/**
 * Parse the USER directive from the final stage of a Dockerfile.
 * Uses dockerfile-ast for structural parsing (same parser used by parseDockerfile).
 * Scans instructions bottom-up: returns the first USER found before hitting
 * a FROM boundary, which corresponds to the last USER in the final stage.
 * Returns null if no USER directive exists in the final stage.
 */
export function parseDockerfileUser(content: string): string | null {
  const dockerfile = DockerfileParser.parse(content);
  const instructions = dockerfile.getInstructions();

  for (let i = instructions.length - 1; i >= 0; i--) {
    const keyword = instructions[i].getKeyword();
    if (keyword === "USER") {
      const args = instructions[i].getArguments();
      if (!args) return null;
      // Extract the username (first whitespace-delimited token).
      // If it contains a $ prefix, it's an ARG/ENV reference — treat as unresolvable.
      const username = args.getContent()?.trim().split(/\s+/)[0] ?? null;
      if (username && username.includes("$")) return null;
      return username;
    }
    if (keyword === "FROM") {
      // Reached the start of the final stage without finding USER
      return null;
    }
  }

  return null;
}
```

This approach has several advantages over the original hand-rolled line-by-line parser:

- **DRY with existing code.** `dockerfile.ts` already imports and uses `DockerfileParser` from `dockerfile-ast`. Reusing the same parser avoids duplicating Dockerfile parsing logic.
- **Bottom-up iteration eliminates state.** Instead of tracking `inFinalStage` and resetting `lastUser` on each FROM, the reverse scan returns immediately on the first USER found, stopping at the FROM boundary. The intent ("find the USER in the last stage") maps directly to the algorithm ("scan backward, stop at FROM").
- **Structural parsing.** The AST handles line continuations, comments, and whitespace correctly. A regex-based line scanner would need to handle these edge cases manually.
- **ARG references handled structurally.** The `$` prefix check on the parsed argument content is cleaner than regex-matching against raw line text.

## Important Design Decisions

### D1: Resolve in `MountPathResolver`, not in `template-resolver.ts`

**Decision:** Resolve `${_REMOTE_USER}` inside `MountPathResolver` at construction time, not during the template resolution walk in `template-resolver.ts`.

**Why:** The `${_REMOTE_USER}` variable appears inside `LaceMountDeclaration.target` values that come from feature metadata JSON, not from devcontainer.json config strings. The template resolver walks devcontainer.json values and resolves `${lace.port()}` and `${lace.mount()}` expressions. Devcontainer spec variables like `${_REMOTE_USER}` are a different category -- they belong to the data model layer (mount declarations), not the config template layer. Resolving them in `MountPathResolver` keeps the concern localized and ensures that `resolveTarget()`, `resolveFullSpec()`, and the eagerly-resolved declarations used by `validateMountTargetConflicts()` all see consistent resolved paths.

### D2: Eager resolution at construction time

**Decision:** Resolve all declaration targets when `MountPathResolver` is constructed, not lazily in `resolveTarget()`/`resolveFullSpec()`.

**Why:** Target conflict detection (`validateMountTargetConflicts()` in `template-resolver.ts`) operates on the declarations map before any `resolve*()` calls. If targets are resolved lazily, conflict detection would compare unresolved template strings, missing conflicts like `/home/${_REMOTE_USER}/.claude` vs `/home/node/.claude`. Eager resolution ensures the declarations map always contains concrete paths.

### D3: Devcontainer spec default is `root`, not `node`

**Decision:** Default to `"root"` when neither `remoteUser` nor Dockerfile `USER` is present, matching the devcontainer spec. Log a warning when falling back to the default so users are nudged to set `remoteUser` explicitly.

**Why:** The devcontainer spec defines that `_REMOTE_USER` defaults to `root` when no user is specified. While many base images use non-root users (e.g., `node` in the Node.js devcontainer image), the spec default is `root`. Defaulting to `"node"` would be incorrect for Alpine, Debian, or custom images that use `root`.

**Inconsistency with `lace-discover`:** The `lace-discover` script defaults to `"node"` because it operates in a runtime context where lace projects conventionally use node-based images, and it treats `root` as "unset" (line 104: `[[ -z "$user" || "$user" == "root" ]] && user="node"`). The TypeScript `extractRemoteUser()` defaults to `"root"` per the devcontainer spec. This divergence only affects the rare case where no `remoteUser` is set and no Dockerfile `USER` exists. In practice, all current lace projects use Dockerfiles that set `USER node`, so the Dockerfile fallback resolves the user before reaching the default. See the "DRY with lace-discover" section in Background for the full analysis and shared contract.

**Mitigation:** When `extractRemoteUser()` falls back to the default `"root"`, log a warning: `"No remoteUser or Dockerfile USER found; defaulting to 'root'. Set remoteUser in devcontainer.json for explicit control."` This nudges users toward the best practice of setting `remoteUser` explicitly, which eliminates the default divergence entirely.

> NOTE: Projects that use a non-root user should set `remoteUser` explicitly in their `devcontainer.json`. This is already best practice per the devcontainer spec.

### D4: Only resolve `_REMOTE_USER` and `containerWorkspaceFolder` initially

**Decision:** Only resolve `${_REMOTE_USER}` and `${containerWorkspaceFolder}` in mount targets. Do not resolve the full set of devcontainer spec variables (`${localEnv:*}`, `${containerEnv:*}`, `${devcontainerId}`, etc.).

**Why:** `_REMOTE_USER` and `containerWorkspaceFolder` are the only devcontainer variables that appear in mount target paths in practice. Other variables like `${localEnv:HOME}` are used in mount source paths, which are the host side and handled by Docker/devcontainer CLI directly. Resolving the full variable set would require implementing the complete devcontainer variable resolution spec, which is unnecessary complexity for the current bug. The `resolveTargetVariables()` method is extensible -- additional variables can be added as needed.

### D5: Modify declarations in-place via deep copy, not the original metadata

**Decision:** The constructor deep-copies declarations and resolves targets on the copies, leaving the original `LaceMountDeclaration` objects unchanged.

**Why:** Feature metadata objects may be shared across multiple resolution contexts (e.g., multiple workspaces, test scenarios). Mutating the original declaration targets would cause side effects. The deep copy ensures resolution is scoped to the `MountPathResolver` instance.

## Stories

### S1: Standard feature with `${_REMOTE_USER}` mount target

A project uses the `claude-code` feature, which declares `target: "/home/${_REMOTE_USER}/.claude"`. The project's `devcontainer.json` sets `remoteUser: "node"`. When `lace up` runs, the mount resolver resolves the target to `/home/node/.claude`, and the generated mount spec contains `target=/home/node/.claude`.

### S2: Dockerfile-based user detection

A project has no `remoteUser` in `devcontainer.json` but the Dockerfile contains `USER node`. The mount resolver extracts `node` from the Dockerfile and resolves `${_REMOTE_USER}` to `node`.

### S3: Root default fallback

A project has no `remoteUser` and an image-based config (no Dockerfile). The mount resolver defaults to `root`, producing targets like `/root/.claude` (since `root`'s home is `/root`, not `/home/root`, the feature metadata would need to account for this -- see Edge Cases).

### S4: No `${_REMOTE_USER}` in target

A project's mount declarations use hardcoded paths like `/home/node/.ssh/authorized_keys` (as in the `wezterm-server` feature). The resolver passes these through unchanged -- no variable substitution needed, no regression.

### S5: Conflict detection with mixed targets

Two features declare mounts: one uses `target: "/home/${_REMOTE_USER}/.config"` and another uses `target: "/home/node/.config"`. With `remoteUser: "node"`, both resolve to the same path. `validateMountTargetConflicts()` correctly detects the conflict because resolution happens before validation.

## Edge Cases / Challenging Scenarios

### E1: `root` user home directory is `/root`, not `/home/root`

Feature metadata declares `target: "/home/${_REMOTE_USER}/.claude"`. When `_REMOTE_USER` resolves to `root`, the target becomes `/home/root/.claude`, but `root`'s actual home directory is `/root/.claude`. This is a pre-existing design issue in the feature metadata -- `install.sh` handles it by using `$HOME` or `getent passwd`, not by string interpolation. For mount targets, this is the feature author's responsibility: if the feature needs to support root, the target should use a different pattern or the feature should document that `remoteUser` must be non-root.

> NOTE: The `claude-code` feature's `install.sh` uses `CLAUDE_DIR="/home/${_REMOTE_USER}/.claude"` which has the same root-home issue at install time. This is a feature-level concern, not a lace concern.

### E2: Dockerfile `USER` contains ARG reference

A Dockerfile has `USER ${USERNAME}` where `USERNAME` is a build arg. The `parseDockerfileUser()` function would return `${USERNAME}` as a literal string, which is not useful. In this case, fall back to the spec default (`root`).

**Mitigation:** Detect ARG references (`$` prefix) in the parsed USER value and treat them as unresolvable, falling through to the default.

### E3: Multi-stage Dockerfile

A Dockerfile has multiple `FROM` lines with different `USER` directives. Only the final stage's `USER` is relevant for the runtime container.

**Mitigation:** The `parseDockerfileUser()` function scans instructions bottom-up, returning the first USER found before hitting a FROM boundary. This naturally returns the final stage's user without needing to track state across stages. If an intermediate stage has a USER but the final stage does not, the scan hits the final stage's FROM before finding any USER and returns `null` -- the correct behavior since the final stage inherits the base image's default user, not the intermediate stage's USER.

### E4: `containerVars` not provided (backwards compatibility)

Tests that create `MountPathResolver` without `containerVars` should continue to work. If `containerVars` is undefined, `resolveTargetVariables()` returns the target unchanged. This preserves backwards compatibility for all existing tests.

### E5: Target path does not contain any variables

Most mount targets (e.g., `/commandhistory`, `/home/node/.ssh/authorized_keys`) contain no variables. The `resolveTargetVariables()` regex replace is a no-op for these strings, adding negligible overhead.

### E6: Feature metadata declares target with `${_REMOTE_USER}` but no devcontainer config exists

This cannot happen in the `lace up` pipeline because the config is always read before mount declarations are processed. If `extractRemoteUser()` is called with a raw config that has neither `remoteUser` nor a Dockerfile, it returns `"root"`.

## Test Plan

### Unit tests: `mount-resolver.test.ts`

1. **`resolveTarget` resolves `${_REMOTE_USER}` when containerVars provided** -- construct with `containerVars: { remoteUser: "node" }` and a declaration with `target: "/home/${_REMOTE_USER}/.claude"`, assert `resolveTarget()` returns `/home/node/.claude`.

2. **`resolveTarget` passes through literal targets unchanged** -- construct with `containerVars: { remoteUser: "node" }` and a declaration with `target: "/data"`, assert `resolveTarget()` returns `/data`.

3. **`resolveTarget` passes through `${_REMOTE_USER}` when containerVars not provided** -- construct without `containerVars`, assert `resolveTarget()` returns the original string (backwards compatibility).

4. **`resolveFullSpec` includes resolved target** -- construct with `containerVars` and assert the spec string contains the resolved target path.

5. **`resolveTarget` resolves `${containerWorkspaceFolder}`** -- construct with `containerVars: { containerWorkspaceFolder: "/workspace/main" }` and a declaration with that variable, assert resolution.

6. **Multiple `${_REMOTE_USER}` in one target** -- edge case where the variable appears twice (unlikely but possible). Assert both are resolved.

### Unit tests: `devcontainer.test.ts`

7. **`extractRemoteUser` returns `remoteUser` field when present** -- config with `remoteUser: "node"`, assert returns `"node"`.

8. **`extractRemoteUser` returns Dockerfile USER when no `remoteUser`** -- config with Dockerfile build and `USER vscode`, assert returns `"vscode"`.

9. **`extractRemoteUser` returns `"root"` when neither is available** -- image-based config with no `remoteUser`, assert returns `"root"`.

10. **`extractRemoteUser` ignores ARG references in Dockerfile USER** -- Dockerfile with `USER ${USERNAME}`, assert returns `"root"` (fallback).

### Unit tests: `dockerfile.test.ts`

11. **`parseDockerfileUser` extracts last USER from single-stage Dockerfile** -- Dockerfile with `USER node`, assert returns `"node"`.

12. **`parseDockerfileUser` extracts last USER from multi-stage Dockerfile** -- final stage has `USER vscode`, assert returns `"vscode"`.

13. **`parseDockerfileUser` returns null when no USER directive** -- Dockerfile without USER, assert returns `null`.

14. **`parseDockerfileUser` returns null when intermediate stage has USER but final stage does not** -- multi-stage Dockerfile where `FROM node AS builder` / `USER node` / `FROM debian` (no USER in final stage), assert returns `null`. Validates that bottom-up parsing stops at the final stage's FROM boundary and does not leak the intermediate stage's USER.

15. **`parseDockerfileUser` returns null for empty content** -- empty string input, assert returns `null`.

### Unit tests: `template-resolver.test.ts`

16. **`validateMountTargetConflicts` detects conflicts after resolution** -- two declarations where one uses `${_REMOTE_USER}` and the other hardcodes the same resolved path. Assert conflict is detected.

### Integration tests: scenario tests

17. **Claude-code feature with `remoteUser` config** -- full `lace up --skip-devcontainer-up` with `claude-code` feature and `remoteUser: "node"`, assert generated mount spec contains `target=/home/node/.claude` (not `${_REMOTE_USER}`).

18. **Neovim feature with Dockerfile USER detection** -- full pipeline with neovim feature and a Dockerfile containing `USER node` but no `remoteUser`, assert target is resolved correctly.

19. **Cross-validation with `lace-discover`** -- for a running devcontainer with explicit `remoteUser`, verify that `extractRemoteUser()` at config time and `lace-discover` at runtime resolve to the same user. This validates the shared contract described in the "DRY with lace-discover" section.

## Implementation Phases

### Phase 1: Core resolution in `MountPathResolver`

Add `ContainerVariables` interface and `resolveTargetVariables()` method to `mount-resolver.ts`. Modify the constructor to accept optional `containerVars` parameter and deep-copy declarations with resolved targets. Add unit tests (test plan items 1-6).

**Success criteria:** All existing `mount-resolver.test.ts` tests pass unchanged. New tests verify `${_REMOTE_USER}` resolution with and without `containerVars`.

**Constraints:** Do not modify `LaceMountDeclaration` interface. Do not modify `feature-metadata.ts`. The resolution is purely within `MountPathResolver`.

### Phase 2: Remote user extraction from config

Add `extractRemoteUser()` to `devcontainer.ts` and `parseDockerfileUser()` to the existing `dockerfile.ts`. Add unit tests (test plan items 7-15).

**Success criteria:** `extractRemoteUser()` correctly follows the resolution order (remoteUser > Dockerfile USER > root). `parseDockerfileUser()` handles single-stage, multi-stage, intermediate-USER-only, and no-USER Dockerfiles.

**Constraints:** `parseDockerfileUser()` uses `DockerfileParser` from `dockerfile-ast` (already imported in `dockerfile.ts`). It is added to the existing `dockerfile.ts` file, not a new file. ARG expansion is out of scope -- detect and skip ARG/ENV references in USER arguments.

**Dependencies:** None (independent of Phase 1).

### Phase 3: Pipeline integration in `up.ts`

Wire `extractRemoteUser()` output into the `MountPathResolver` constructor call in `runUp()`. Extract `containerWorkspaceFolder` from the resolved config. Update the conflict detection in `template-resolver.ts` to note that it now operates on resolved targets (it already does, since declarations are resolved eagerly, but the comment should reflect this). Add integration tests (test plan items 16-19).

**Success criteria:** `lace up --skip-devcontainer-up` with claude-code or neovim features produces mount specs with resolved `${_REMOTE_USER}` targets. Existing scenario tests continue to pass.

**Dependencies:** Phase 1 and Phase 2.

### Phase 4: Update feature metadata and documentation

Update the claude-code scenario test (C1) assertion from `target=/home/${_REMOTE_USER}/.claude` to the resolved `target=/home/node/.claude` (or whatever the test's `remoteUser` resolves to). Update any cdocs that state `${_REMOTE_USER}` is "passed through verbatim" to reflect the new behavior. Review wezterm-server's hardcoded `/home/node/` target to determine if it should be changed to use `${_REMOTE_USER}` now that resolution is supported (this is optional and separate from the bug fix).

**Success criteria:** No documentation claims `${_REMOTE_USER}` passthrough. Scenario tests assert resolved paths.

**Dependencies:** Phase 3.

## Open Questions

1. **Should `wezterm-server/authorized-keys` target be updated to use `${_REMOTE_USER}`?** The wezterm-server feature currently hardcodes `target: "/home/node/.ssh/authorized_keys"`. With resolution support, it could use `target: "/home/${_REMOTE_USER}/.ssh/authorized_keys"` for portability. This is a separate feature metadata change, not a mount resolver change, and could be done independently.

2. **Should lace warn when `_REMOTE_USER` resolves to `root` and the target contains `/home/${_REMOTE_USER}/`?** This pattern produces `/home/root/` which is typically not where root's home is (`/root/` instead). A warning could help feature authors catch this issue early.

3. **Should `containerVars` be persisted?** Currently, `MountPathResolver` persists `MountAssignment` objects with `resolvedSource`. If `containerVars` changes (e.g., `remoteUser` is modified), the persisted mount assignments reference the old resolved targets. This is low-risk because target paths are not persisted -- they come from declarations which are re-resolved on each `lace up`. But it is worth considering whether a `remoteUser` change should trigger a warning.
