---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T16:00:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: archived
status: superseded
superseded_by: cdocs/proposals/2026-02-04-lace-plugins-system.md
tags: [devcontainer, mounts, dependencies, lace-cli, plugins, dotfiles, architecture]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T17:30:00-08:00
  round: 1
revisions:
  - at: 2026-02-04T19:00:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Changed mount namespace from /lace.local/ to /mnt/lace/local/dependencies/"
      - "Defined lace up as umbrella command (prebuild → resolve-deps → devcontainer up)"
      - "Clarified mirrorPath behavior: creates directories with info notice"
      - "Resolved blocking review issues"
  - at: 2026-02-04T21:45:00-08:00
    by: "@claude-opus-4-5-20251101"
    changes:
      - "Marked as superseded by lace-plugins-system proposal"
---

# Dev Dependency Cross-Project Mounts

> **SUPERSEDED**: This proposal has been superseded by [Lace Plugins System](2026-02-04-lace-plugins-system.md), which evolves the dev dependency concept into a full-fledged plugin system with subdirectory support, explicit aliasing, consolidated settings, and automatic shallow cloning.

> BLUF: Projects declare dev dependencies by git repo identifier in `customizations.lace.devDependencies`, users map repo identifiers to local checkout paths in `~/.config/lace/repos.json`, and lace mounts them at `/mnt/lace/local/dependencies/<repo-name>` inside containers. For Claude plugins requiring identical host/container paths, a `mirrorPath` option mounts at the literal host path (creating directories in-container with an info notice if needed). The lace CLI gains a `lace resolve-deps` command and a new `lace up` umbrella command that orchestrates the full container workflow: prebuild (if configured) → resolve-deps (if devDependencies declared) → devcontainer up.

## Objective

Enable mounting sibling git repositories into devcontainers as read-only "dev dependencies" with a clean separation of concerns:
1. **Project-level declaration**: Projects specify what repos they need (portable, version-controlled).
2. **User-level mapping**: Users specify where those repos are checked out on their machine (personal, not committed).
3. **Lace-controlled mount points**: Lace prescribes the in-container path (consistent, predictable).

This supports use cases like:
- Claude plugins developed in sibling repos, accessible for testing in-container.
- Dotfiles repos applied inside devcontainers.
- Shared libraries mounted for local iteration without publishing.

## Background

### Current Mount Patterns in Lace

The lace devcontainer (`/var/home/mjr/code/weft/lace/.devcontainer/devcontainer.json`) already demonstrates mount patterns:

```jsonc
"mounts": [
  // Command history persistence - user-specific host path
  "source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind",

  // Claude config - user-specific host path
  "source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind",

  // SSH public key for WezTerm - read-only
  "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
],
"workspaceMount": "source=${localWorkspaceFolder}/..,target=/workspace,type=bind,consistency=delegated",
"workspaceFolder": "/workspace/main",
```

Key observations:
- Uses `${localEnv:HOME}` for user-specific paths.
- All mounts hardcode paths that vary per machine.
- The `readonly` flag is used appropriately for credentials.
- The workspaceMount exposes the parent directory (for worktree access).

### Devcontainer Mount Limitations

The devcontainer specification supports variable substitution (`${localEnv:VAR}`, `${localWorkspaceFolder}`) but has no native mechanism for "look up this path from user config." Mount sources must be resolvable at container creation time.

This means dynamic mount resolution must happen **before** invoking `devcontainer up`, which is where the lace CLI comes in.

### The Lace CLI Pattern

The [packages/lace devcontainer wrapper proposal](2026-01-30-packages-lace-devcontainer-wrapper.md) established the pattern of lace preprocessing devcontainer.json before invoking the devcontainer CLI:

- `customizations.lace.*` namespace for lace-specific configuration.
- `.lace/` directory for generated/cached artifacts (gitignored).
- `lace prebuild` processes `prebuildFeatures` and rewrites Dockerfile FROM lines.

Dev dependency mounts follow this pattern: lace reads declarations, resolves user mappings, and generates mount configurations.

### Motivating Use Cases

1. **Claude Plugins**: A developer iterating on a Claude plugin in `~/code/plugins/my-plugin` needs it accessible inside the devcontainer. Some plugin mechanisms (MCP servers, hooks) may reference absolute paths.

2. **Dotfiles**: Personal shell, editor, and tool configurations developed in a separate dotfiles repo should be applicable inside devcontainers without manual copying.

3. **Shared Libraries**: Local development of a library that another project imports, mounted for hot-reload iteration without npm link or publishing.

## Proposed Solution

### Layer 1: Project-Level Declaration (`customizations.lace.devDependencies`)

Projects declare dependencies by git repo identifier. This configuration is version-controlled and portable.

```jsonc
// .devcontainer/devcontainer.json
{
  "customizations": {
    "lace": {
      "devDependencies": {
        // Standard form: mount at /mnt/lace/local/dependencies/<basename>
        "github.com/user/dotfiles": {},

        // With options
        "github.com/user/claude-plugins": {
          "readonly": true,          // Default: true
          "required": false,         // Default: false (warn if unmapped, don't fail)
          "subdirectory": "plugins"  // Mount only this subdirectory
        },

        // Mirror path: mount at identical host path (for path-sensitive tools)
        "github.com/user/my-plugin": {
          "mirrorPath": true
        }
      }
    }
  }
}
```

**Repo identifier format**: Normalized git remote URL without protocol (e.g., `github.com/user/repo`). This is unambiguous across hosts (GitHub, GitLab, self-hosted) and matches how developers think about repos.

### Layer 2: User-Level Mapping (`~/.config/lace/repos.json`)

Users map repo identifiers to their local checkout paths. This file is user-specific and not committed to any project.

```jsonc
// ~/.config/lace/repos.json
{
  "repos": {
    "github.com/user/dotfiles": "~/code/personal/dotfiles",
    "github.com/user/claude-plugins": "~/code/weft/claude-plugins",
    "github.com/user/my-plugin": {
      "path": "~/code/plugins/my-plugin",
      "branch": "dev"  // Optional: for future staleness warnings
    }
  }
}
```

**Discovery order** (for `lace` CLI to find the config):
1. `~/.config/lace/repos.json` (XDG-compliant primary location)
2. `~/.lace/repos.json` (legacy/simple location)
3. Environment variable `LACE_REPOS_CONFIG` (for CI/advanced use cases)

**Why user-level?**
- Different users have different directory structures.
- Users may have the same repo checked out in multiple locations.
- A team project should not dictate where individual developers keep their code.

### Layer 3: Container Mount Points (Lace-Controlled)

Lace prescribes the in-container mount point. This is opinionated and not user-configurable (except via `mirrorPath`).

**Standard mounts** use the `/mnt/lace/local/dependencies/` prefix:

```
/mnt/lace/local/dependencies/<repo-basename>/
```

Examples:
- `github.com/user/dotfiles` mounts at `/mnt/lace/local/dependencies/dotfiles/`
- `github.com/user/claude-plugins` mounts at `/mnt/lace/local/dependencies/claude-plugins/`

**Why `/mnt/lace/local/dependencies/`?**
- Consistent with the `lace.local/<image>` Docker tag convention from prebuild.
- Clearly namespaced, no collision with system paths.
- Scripts, CLAUDE.md, and tools can reference stable paths.

**Basename collision handling**: When two dependencies have the same basename (e.g., `github.com/alice/utils` and `github.com/bob/utils`), lace disambiguates by prefixing with the org/user:

```
/mnt/lace/local/dependencies/alice-utils/
/mnt/lace/local/dependencies/bob-utils/
```

The disambiguation is deterministic (alphabetical by full identifier) and logged during resolution.


**Mirror mounts** (when `mirrorPath: true`) use the literal host path:
- Host: `/home/user/code/plugins/my-plugin`
- Container: `/home/user/code/plugins/my-plugin`

This is an escape hatch for tools that require identical paths.

### Lace CLI Changes

#### New Command: `lace resolve-deps`

```bash
lace resolve-deps [--workspace-folder <path>]
```

1. Read `devcontainer.json`, extract `customizations.lace.devDependencies`.
2. Read user's `~/.config/lace/repos.json`.
3. For each declared dependency:
   - Look up local path from user mapping.
   - Validate path exists.
   - Determine in-container mount point.
   - Handle `subdirectory` option.
   - Warn or error based on `required` flag.
4. Write resolved mounts to `.lace/resolved-mounts.json`.
5. Output summary to stdout.

**Output format** (`.lace/resolved-mounts.json`):

```jsonc
{
  "version": 1,
  "generatedAt": "2026-02-04T16:00:00Z",
  "mounts": [
    {
      "repoId": "github.com/user/dotfiles",
      "source": "/home/user/code/personal/dotfiles",
      "target": "/mnt/lace/local/dependencies/dotfiles",
      "readonly": true
    },
    {
      "repoId": "github.com/user/my-plugin",
      "source": "/home/user/code/plugins/my-plugin",
      "target": "/home/user/code/plugins/my-plugin",
      "readonly": true,
      "mirrorPath": true
    }
  ],
  "warnings": [
    "Dependency 'github.com/user/shared-lib' not mapped in ~/.config/lace/repos.json"
  ]
}
```

#### New Umbrella Command: `lace up`

```bash
lace up [--workspace-folder <path>] [devcontainer-args...]
```

The `lace up` command is the primary entrypoint for starting a lace-managed devcontainer. It orchestrates the full workflow in sequence:

1. **Prebuild** (if `customizations.lace.prebuildFeatures` configured): Run `lace prebuild` to process feature prebuilds and rewrite Dockerfile FROM lines.
2. **Resolve Dependencies** (if `customizations.lace.devDependencies` declared): Run `lace resolve-deps` to validate mappings and generate mount specifications.
3. **Generate Extended Config**: Merge resolved mounts into `.lace/devcontainer.json`.
4. **Devcontainer Up**: Invoke `devcontainer up --config .lace/devcontainer.json` (or equivalent mechanism).

This keeps the original `devcontainer.json` as the committed source of truth while allowing lace to inject prebuilt images and resolved mounts.

**Why an umbrella command:**
- Users shouldn't need to remember which preprocessing steps apply to a given project
- The workflow steps have dependencies (prebuild must complete before devcontainer up)
- Single command (`lace up`) replaces the previous pattern of running multiple commands manually

#### User Workflow

```bash
# One-time setup: map repos
echo '{"repos":{"github.com/user/dotfiles":"~/dotfiles"}}' > ~/.config/lace/repos.json

# Daily use
cd ~/code/my-project
lace up  # Resolves deps, generates config, starts container
```

### Schema Definitions

#### `devDependencies` Schema (in devcontainer.json)

```typescript
interface DevDependencies {
  [repoId: string]: DevDependencyOptions | string;
}

interface DevDependencyOptions {
  /** Mount as read-only. Default: true */
  readonly?: boolean;

  /** Error if not mapped. Default: false (warn only) */
  required?: boolean;

  /** Mount only this subdirectory of the repo */
  subdirectory?: string;

  /** Mount at the literal host path instead of /mnt/lace/local/dependencies/<name> */
  mirrorPath?: boolean;
}

// String shorthand: "readonly" is equivalent to { readonly: true }
// String shorthand: "required" is equivalent to { required: true }
```

#### `repos.json` Schema (user config)

```typescript
interface ReposConfig {
  repos: {
    [repoId: string]: string | RepoMapping;
  };
}

interface RepoMapping {
  /** Local path to the repo checkout */
  path: string;

  /** Optional: expected branch for staleness warnings (future feature) */
  branch?: string;
}
```

## Design Decisions

### D1: Repo identifier format

**Decision**: Use `github.com/user/repo` (clone URL without protocol).

**Rationale**: Unambiguous across hosts (GitHub, GitLab, Bitbucket, self-hosted). Self-documenting. No need for a naming registry.

**Alternatives considered**:
- Short name (e.g., `dotfiles`): Ambiguous, requires per-user naming.
- Full git URL (`https://github.com/...`): Verbose, protocol is noise.
- SSH URL (`git@github.com:...`): Different format between SSH and HTTPS clones.

### D2: User config location

**Decision**: `~/.config/lace/repos.json` (XDG-compliant).

**Rationale**: Follows XDG Base Directory Specification. Clear separation from project files. Per-user naturally (tilde expansion).

**Alternatives considered**:
- `~/.lacerc`: Less discoverable, single file for all lace config.
- Environment variables: Doesn't scale for many repos.

### D3: In-container mount point

**Decision**: `/mnt/lace/local/dependencies/<basename>/` with disambiguation for collisions.

**Rationale**:
- Clear, descriptive path that indicates purpose (dependencies managed by lace)
- Under `/mnt/` which is conventional for mount points
- Avoids namespace confusion with other lace artifacts (Docker tags, generated configs)
- Predictable for scripts, CLAUDE.md references, and documentation

**Alternatives considered**:
- `/lace.local/<name>`: Could conflict with future uses of `lace.local` namespace (e.g., if we expose other artifacts). Also confusing since `lace.local/` is used for Docker tags.
- `/deps/<name>`: Too generic, could collide with other tools.
- `/home/node/deps/`: User-specific, complicates scripts.
- User-configurable: Adds complexity, breaks predictability.

### D4: Default to read-only

**Decision**: `readonly: true` by default.

**Rationale**: Dev dependencies are typically consumed, not modified. Read-only prevents accidental writes to sibling repos. Explicit opt-out (`readonly: false`) for editable deps.

### D5: Non-required by default

**Decision**: `required: false` by default (warn, don't fail).

**Rationale**: A missing dev dependency shouldn't prevent container startup. The developer may not have all optional deps cloned. Required dependencies are the exception.

### D6: mirrorPath for path-sensitive tools

**Decision**: Explicit `mirrorPath: true` option, not automatic.

**Rationale**: Mirroring host paths is a leaky abstraction (container paths depend on host user's directory structure). It should be a conscious opt-in for specific tools that demand it (like poorly-authored Claude plugins with hardcoded paths).

### D7: Generate extended config, don't modify original

**Decision**: Write to `.lace/devcontainer.json`, invoke `devcontainer` with that config.

**Rationale**: Matches the prebuild pattern. Original `devcontainer.json` remains the committed source of truth. Generated files are gitignored.

## Edge Cases / Challenging Scenarios

### E1: Dependency not mapped in repos.json

**Trigger**: Project declares `github.com/user/foo`, user's `repos.json` has no entry.

**Behavior**:
- If `required: false` (default): Log warning with instructions for adding the mapping. Proceed without the mount.
- If `required: true`: Error and abort with clear message.

**Warning message**:
```
Warning: Dev dependency 'github.com/user/foo' not mapped.
Add to ~/.config/lace/repos.json:
  "github.com/user/foo": "/path/to/your/checkout"
```

### E2: Mapped path does not exist

**Trigger**: `repos.json` maps `github.com/user/foo` to `~/code/foo`, but that path doesn't exist.

**Behavior**: Same as E1 (unmapped). The mapping exists but is invalid.

### E3: Basename collision

**Trigger**: Two dependencies have the same basename (e.g., `github.com/alice/utils` and `gitlab.com/bob/utils`).

**Behavior**: Disambiguate with org/user prefix:
- `/mnt/lace/local/dependencies/alice-utils/` for `github.com/alice/utils`
- `/mnt/lace/local/dependencies/bob-utils/` for `gitlab.com/bob/utils`

Log the disambiguation to stdout so developers know the final paths.

### E4: mirrorPath on Windows host

**Trigger**: `mirrorPath: true` on a Windows host with Linux container.

**Behavior**: Error with clear message:
```
Error: mirrorPath is not supported on Windows hosts.
Windows paths (C:\...) cannot be mirrored in Linux containers.
Remove mirrorPath or use standard mount.
```

### E5: Circular dependencies

**Trigger**: Project A declares dep on Project B, which declares dep on Project A.

**Non-issue**: Each project's devcontainer runs independently. When developing A, B is mounted read-only. When developing B, A is mounted read-only. No recursive devcontainer inception.

### E6: Very large dependencies

**Trigger**: A dependency is a multi-GB monorepo; mounting it slows container I/O.

**Mitigations** (future work):
- `subdirectory` option to mount only what's needed.
- Future: sparse checkout option that clones minimally in-container.

### E7: repos.json doesn't exist

**Trigger**: User runs `lace up` on a project with `devDependencies` but hasn't created `repos.json`.

**Behavior**: Treat all dependencies as unmapped. Warn (or error for required deps). Provide setup instructions:
```
Warning: ~/.config/lace/repos.json not found.
Create it to map dev dependencies:
  echo '{"repos":{}}' > ~/.config/lace/repos.json
```

### E8: Subdirectory doesn't exist in repo

**Trigger**: `"subdirectory": "plugins"` but the repo has no `plugins/` directory.

**Behavior**: Error (even if `required: false`). A misconfigured subdirectory is likely a typo, not an optional feature.

### E9: Mount conflicts with workspace

**Trigger**: A dev dependency tries to mount at a path that overlaps with the workspace mount (e.g., `/workspace/...`).

**Behavior**: Error with clear message. The `/mnt/lace/local/dependencies/` prefix should prevent this for standard mounts. For `mirrorPath`, this could happen if the host path is under the workspace folder.

## Test Plan

### Unit Tests: repos.json parsing (`src/lib/__tests__/repos.test.ts`)

| Scenario | Expected |
|----------|----------|
| Valid JSON with string paths | Parsed correctly, paths expanded |
| Valid JSON with object paths | `path` and `branch` extracted |
| Tilde expansion (`~/code/...`) | Expanded to absolute path |
| Missing file | Returns null or empty config |
| Invalid JSON | Error with parse position |
| Empty repos object | Valid, no mappings |

### Unit Tests: devDependencies extraction (`src/lib/__tests__/devcontainer.test.ts`)

| Scenario | Expected |
|----------|----------|
| Standard `devDependencies` | Returns feature map |
| `devDependencies` absent | Returns "absent" sentinel |
| `devDependencies: null` | Returns "null" sentinel (explicit opt-out) |
| `devDependencies: {}` | Returns empty map |
| String shorthand (`"readonly"`) | Converted to options object |
| Options with all fields | All fields preserved |

### Unit Tests: mount resolution (`src/lib/__tests__/mounts.test.ts`)

| Scenario | Expected |
|----------|----------|
| Single dep, mapped | Generates correct mount spec |
| Multiple deps, all mapped | All mounts generated |
| Basename collision | Disambiguated paths |
| `subdirectory` option | Source path includes subdirectory |
| `mirrorPath: true` | Target matches source |
| `readonly: false` | Mount spec omits readonly flag |
| Unmapped, not required | Warning, no mount |
| Unmapped, required | Error |

### Integration Tests: resolve-deps command (`src/commands/__tests__/resolve-deps.integration.test.ts`)

| Scenario | Expected |
|----------|----------|
| Happy path | `.lace/resolved-mounts.json` written correctly |
| No devDependencies | Info message, no file written |
| Partial mappings | Warnings for unmapped, mounts for mapped |
| All unmapped, none required | Warnings only, exit 0 |
| Required dep unmapped | Exit non-zero with error |

### Integration Tests: lace up with deps (`src/commands/__tests__/up.integration.test.ts`)

| Scenario | Expected |
|----------|----------|
| devDependencies with mappings | Extended config generated, devcontainer invoked |
| No devDependencies | Standard devcontainer up (no mount injection) |
| Resolution failures (required) | Aborts before devcontainer up |

### Manual Verification

1. Create a test repos.json with real local paths.
2. Run `lace resolve-deps` and verify output.
3. Run `lace up` and verify mounts are present in container (`ls /mnt/lace/local/dependencies/`).
4. Test `mirrorPath` with a Claude plugin that references absolute paths.

## Implementation Phases

### Phase 1: repos.json Parsing

Add `src/lib/repos.ts` module:
- `findReposConfig()`: Locate repos.json following discovery order.
- `readReposConfig(path)`: Parse and validate the file.
- `expandPath(path)`: Handle tilde expansion and resolve to absolute.

Tests: `src/lib/__tests__/repos.test.ts`

**Success criteria**: Can parse repos.json from standard locations, expand paths correctly.

### Phase 2: devDependencies Extraction

Extend `src/lib/devcontainer.ts`:
- `extractDevDependencies(raw)`: Similar pattern to `extractPrebuildFeatures()`.
- Type definitions for `DevDependencyOptions`.

Tests: Add cases to `src/lib/__tests__/devcontainer.test.ts`

**Success criteria**: Can extract devDependencies with all option variations.

### Phase 3: Mount Resolution Logic

Add `src/lib/mounts.ts` module:
- `resolveMounts(devDeps, reposConfig)`: Core resolution logic.
- `disambiguateBasenames(mounts)`: Handle collisions.
- `generateMountSpec(mount)`: Produce devcontainer mount string.

Tests: `src/lib/__tests__/mounts.test.ts`

**Success criteria**: Given devDependencies and repos.json, produces correct mount specifications.

### Phase 4: resolve-deps Command

Add `src/commands/resolve-deps.ts`:
- Wire up parsing, resolution, and output.
- Write `.lace/resolved-mounts.json`.
- Handle warnings and errors.

Tests: `src/commands/__tests__/resolve-deps.integration.test.ts`

**Success criteria**: `lace resolve-deps` works end-to-end with proper error handling.

### Phase 5: lace up Integration

Extend `src/commands/up.ts` (or create if doesn't exist):
- Run resolution as part of `lace up`.
- Generate extended devcontainer.json with mounts.
- Invoke `devcontainer up` with extended config.

Tests: `src/commands/__tests__/up.integration.test.ts`

**Success criteria**: `lace up` transparently resolves and mounts dev dependencies.

### Phase 6: Documentation and Polish

- Update lace CLI help text.
- Add setup instructions to README or docs.
- Handle edge cases discovered during testing.

## Underspecifications and Open Questions

1. **~~mirrorPath and container user~~** *(Resolved)*: When `mirrorPath: true` and the host path is `/home/alice/code/...`, but the container runs as user `node`, lace will create the necessary directory structure (`/home/alice/code/...`) inside the container and display an info notice to the user:
   ```
   Info: Creating container directory /home/alice/code/plugins for mirrorPath mount
   ```
   This is a best-effort approach for tools that require identical paths. The created directories are owned by root; the mounted content has its own permissions from the bind mount.

2. **Multiple dotfiles repos**: The research report notes dotfiles may have special semantics (apply on postCreate). Should `devDependencies` support a `type: "dotfiles"` option with automatic application, or should dotfiles be a separate feature (`customizations.lace.dotfiles`)?

3. **Branch/version validation**: The repos.json supports an optional `branch` field. Should lace validate that the local checkout is on the expected branch? Or is this purely informational for future tooling?

4. **Config schema versioning**: How should we version the `devDependencies` schema if it evolves? Add a `version` field to `customizations.lace`, or rely on lace CLI version compatibility?

5. **Interaction with prebuild**: If a dev dependency contains files used during image build (unlikely but possible), how does resolution interact with `lace prebuild`? Currently, resolution happens at `lace up` time, after prebuild.

6. **~~Expanding mount namespace~~** *(Resolved)*: The `/mnt/lace/local/dependencies/` path is specific to dev dependency mounts and won't conflict with other lace artifacts (Docker tags use `lace.local/`, generated configs use `.lace/`).

## Related Documents

- [Dev Dependency Mounts Research](../reports/2026-02-04-dev-dependency-mounts-research.md) - Background research for this proposal
- [packages/lace: Devcontainer Wrapper](2026-01-30-packages-lace-devcontainer-wrapper.md) - Lace CLI architecture
- [Dev Container JSON Reference](https://containers.dev/implementors/json_reference/) - Mount specification
