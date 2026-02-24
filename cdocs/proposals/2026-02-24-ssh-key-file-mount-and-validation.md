---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-24T14:30:00-06:00
task_list: lace/wezterm-server
type: proposal
state: live
status: review_ready
tags: [ssh, mount-templates, wezterm-server, validation, ux, error-handling, devcontainer, file-mount]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-24T18:30:00-06:00
  round: 2
revision_history:
  - round: 1
    at: 2026-02-24T17:00:00-06:00
    by: "@claude-opus-4-6"
    summary: >
      Addressed all review findings: replaced fileMount boolean with
      sourceMustBe enum ("file"|"directory"), updated recommendedSource JSDoc
      to reflect its dual role, adopted hybrid pipeline ordering (keep
      fileExists at Phase 0b + feature-level validation post-metadata-fetch),
      kept static mount in devcontainer.json for non-lace contributors,
      acknowledged feature ownership as pragmatic compromise matching
      hostSshPort, added statSync().isFile() validation, documented Docker
      auto-create-directory behavior under --skip-validation, updated hint to
      suggest ~/.config/lace/ssh/ key path.
related_to:
  - cdocs/reports/2026-02-24-ssh-key-mount-template-feasibility.md
  - cdocs/reports/2026-02-24-mount-validation-design-rationale.md
  - cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
  - cdocs/reports/2026-02-15-mount-api-design-rationale.md
  - cdocs/reviews/2026-02-24-review-of-ssh-key-file-mount-and-validation.md
---

# Validated Mount Declarations with SSH Key Support for wezterm-server

> **BLUF:** Extend lace's mount declaration system with a `sourceMustBe: "file" | "directory"`
> field that changes resolution behavior from "auto-create directory" to "validate source
> exists as the expected type or fail with actionable guidance." The wezterm-server feature
> declares its SSH public key requirement as a validated mount
> (`wezterm-server/authorized-keys`), which lace auto-injects into the `mounts` array and
> validates after feature metadata is fetched. When the key is missing, `lace up`
> error-interrupts with the feature name, expected path, the exact `ssh-keygen` command
> (generating to `~/.config/lace/ssh/`), and how to override the path via
> `~/.config/lace/settings.json`. The static mount string in devcontainer.json is kept for
> non-lace contributors (belt-and-suspenders), and the existing `fileExists` check at
> Phase 0b is preserved as a network-independent safety net. See
> `cdocs/reports/2026-02-24-ssh-key-mount-template-feasibility.md` for the feasibility
> analysis that motivated this design.

## Objective

Make the wezterm-server SSH key mount configurable, self-documenting, and
fail-safe by bringing it into lace's template variable system. Specifically:

1. **Error-interrupt `lace up`** with a clear, actionable message when the SSH
   key is missing -- including what feature needs it, the default path, the
   exact command to create it, and how to configure an alternative path.
2. **Make the mount declaration the primary source of truth** while keeping
   the static mount in devcontainer.json for non-lace contributors.
3. **Enable per-user SSH key configuration** via `settings.json` overrides, so
   teams with different key management practices can each point lace at their
   own key without editing devcontainer.json.

## Background

The wezterm-server SSH key mount is currently configured in three separate
places in `.devcontainer/devcontainer.json` that must stay in sync manually:
a `fileExists` check (line 28), a static mount string (line 70), and a
comment (line 69). The path `~/.ssh/lace_devcontainer.pub` appears in all
three, and there is no way for users to override it without forking
devcontainer.json.

Lace's existing mount declaration system (`${lace.mount()}` templates) was
designed for **directory** mounts: `resolveSource()` auto-creates the default
directory via `mkdirSync`. SSH keys are files that must already exist, so the
system needs a `sourceMustBe` extension.

## Proposed Solution

### 1. Add `sourceMustBe` field to mount declarations

Extend `LaceMountDeclaration` in `feature-metadata.ts`:

```typescript
export interface LaceMountDeclaration {
  target: string;
  /**
   * Suggested host source path, surfaced in config guidance.
   * When `sourceMustBe` is set, also serves as the default source path
   * (expanded via tilde expansion) if no settings override is configured.
   */
  recommendedSource?: string;
  description?: string;
  readonly?: boolean;
  type?: string;
  consistency?: string;
  /**
   * When set, the resolved source must already exist as the specified type.
   * - "file": source must be an existing file (validated via statSync().isFile())
   * - "directory": source must be an existing directory (validated via statSync().isDirectory())
   * When omitted, the default behavior applies: auto-create directory via mkdirSync.
   */
  sourceMustBe?: "file" | "directory";
  /** Remediation hint shown when a validated source is missing. */
  hint?: string;
}
```

> See `cdocs/reports/2026-02-24-mount-validation-design-rationale.md` for
> why `sourceMustBe` was chosen over `fileMount: boolean`.

### 2. Declare the SSH key mount in wezterm-server feature metadata

Add to `devcontainers/features/src/wezterm-server/devcontainer-feature.json`:

```json
"customizations": {
  "lace": {
    "ports": { ... },
    "mounts": {
      "authorized-keys": {
        "target": "/home/node/.ssh/authorized_keys",
        "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
        "description": "SSH public key for WezTerm SSH domain access",
        "readonly": true,
        "sourceMustBe": "file",
        "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh"
      }
    }
  }
}
```

This gets auto-injected into the `mounts` array as
`${lace.mount(wezterm-server/authorized-keys)}` during lace's template
auto-injection phase, just like directory mounts.

> NOTE: Path migrated from `~/.ssh/lace_devcontainer.pub` to
> `~/.config/lace/ssh/id_ed25519.pub`. No backwards compat needed --
> just change the path everywhere.

### 3. Change `MountPathResolver.resolveSource()` for validated mounts

When `sourceMustBe` is set, `resolveSource()` changes behavior:

```
No sourceMustBe (default):     derive path -> mkdirSync -> return path
sourceMustBe: "file":          resolve path -> statSync().isFile() -> return path or throw
sourceMustBe: "directory":     resolve path -> statSync().isDirectory() -> return path or throw
```

For validated mounts, the "default path" is the `recommendedSource` (expanded
via tilde expansion), not the auto-derived
`~/.config/lace/<projectId>/mounts/...` path. Auto-deriving a path under
lace's data directory doesn't make sense for files/directories that the user
must create or manage externally.

Resolution order for validated mounts:

1. **Settings override**: `settings.mounts["wezterm-server/authorized-keys"].source`
   -- must exist as the expected type (hard error if not)
2. **Recommended source**: `recommendedSource` expanded to absolute path --
   must exist as the expected type (error with hint if not)
3. **No recommendedSource and no override**: error telling the user to
   configure the mount in settings.json

Validation uses `statSync()` to distinguish files from directories.
See the design rationale report for why `existsSync()` is insufficient.

### 4. Error-interrupt with actionable guidance

When a validated mount source is missing, `lace up` fails with a message like:

```
ERROR: wezterm-server requires file: ~/.config/lace/ssh/id_ed25519.pub
       (SSH public key for WezTerm SSH domain access)

  To create it:
    mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh

  To use a different key, add to ~/.config/lace/settings.json:
    {
      "mounts": {
        "wezterm-server/authorized-keys": {
          "source": "~/.ssh/your_key.pub"
        }
      }
    }
```

This message includes:
- **What feature** needs the file (wezterm-server)
- **What the file is** (from `description`)
- **The default path** (from `recommendedSource`)
- **How to create it** (from `hint`)
- **How to override it** (settings.json path and example)

### 5. Keep static mount in devcontainer.json (belt-and-suspenders)

The project-level devcontainer.json keeps the static mount string and the
`fileExists` check for non-lace contributors. For lace users,
`validateMountTargetConflicts()` deduplicates: when an auto-injected mount
and a static mount share the same container target, the auto-injected mount
wins and the static mount is dropped with a debug log.

### 6. User-level configuration via settings.json

Users configure their SSH key path in `~/.config/lace/settings.json`:

```json
{
  "mounts": {
    "wezterm-server/authorized-keys": {
      "source": "~/.ssh/id_ed25519.pub"
    }
  }
}
```

This uses the existing mount override mechanism. No new configuration
surface is needed.

## Design Decisions (Summary)

Full rationale for each decision is documented in
`cdocs/reports/2026-02-24-mount-validation-design-rationale.md`.

| Decision | Choice | Key Reason |
|---|---|---|
| Field shape | `sourceMustBe: "file" \| "directory"` enum | Directly expresses the constraint without conflating type and pre-existence |
| `recommendedSource` role | Serves as default path for validated mounts | Auto-derived paths don't make sense for externally-managed files |
| Feature ownership | wezterm-server owns the SSH key declaration | Requirement disappears when feature is removed; pragmatic match for `hostSshPort` |
| Auto-generation | Not in this proposal | Trust boundary: feature metadata should not trigger host-side commands |
| Pipeline ordering | Hybrid: Phase 0b `fileExists` + Phase 1.5 feature-level | Network-independent safety net preserved |
| Error messages | Include settings.json override example | Copy-paste UX for "I already have a key" scenario |
| Validation method | `statSync()` over `existsSync()` | Distinguishes files from directories; catches accidental `mkdir` at key path |

## Edge Cases / Challenging Scenarios

### User has no `~/.config/lace/settings.json` yet

The settings.json file is optional. If it doesn't exist, lace falls back to
the `recommendedSource` path. The error message includes the full settings.json
example, so the user can create the file from scratch if needed.

### `recommendedSource` is missing from the declaration

If a validated mount has no `recommendedSource` and no settings override, lace
cannot determine where to look. This is an error at template resolution time:

```
ERROR: Validated mount "wezterm-server/authorized-keys" has no source.
       Add to ~/.config/lace/settings.json:
         { "mounts": { "wezterm-server/authorized-keys": { "source": "/path/to/key.pub" } } }
```

### Settings override points to a non-existent file

The existing `MountPathResolver` behavior for overrides already handles this:
it throws a hard error if the override path doesn't exist. The error message
would be:

```
Mount override source does not exist for "wezterm-server/authorized-keys": ~/.ssh/nonexistent.pub
Create the file or remove the override from settings.json.
```

### Source exists but is wrong type (directory at file path)

When `sourceMustBe: "file"` and the path exists but is a directory (e.g.,
`mkdir -p ~/.config/lace/ssh/id_ed25519.pub`), validation fails with:

```
ERROR: wezterm-server/authorized-keys: expected file but found directory at
       ~/.config/lace/ssh/id_ed25519.pub
```

This is validated via `statSync().isFile()`, not `existsSync()`, which would
return true for both files and directories.

### Docker auto-creates missing bind-mount sources as directories

When `--skip-validation` is used, validation errors are downgraded to
warnings. If the source file is missing, Docker does NOT error on the missing
bind-mount source -- it silently creates a directory at that path. This means
`/home/node/.ssh/authorized_keys` becomes a directory inside the container,
and sshd silently fails to authenticate (it tries to read a directory as a
file). The `--skip-validation` warning message explicitly notes this Docker
behavior:

```
WARNING: wezterm-server/authorized-keys source missing. Docker will create a
         directory at this path, which will silently break SSH authentication.
```

### Multiple projects use wezterm-server with different keys

Settings.json is global (not per-project). A settings override applies to all
projects. For the SSH key use case this is typically correct -- the user has
one SSH key they use everywhere. If per-project key isolation is needed,
projects can override in their own devcontainer.json by explicitly writing
the mount string instead of relying on auto-injection.

### Container user is not `node`

The mount target `/home/node/.ssh/authorized_keys` is hardcoded to the `node`
user. For containers using a different user, the target would be wrong. This
is an existing limitation, not introduced by this proposal. The target path
has no settings override mechanism (settings only override the source).
A future enhancement (tracked in
`cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md`) would make
the container user configurable.

### Feature used without lace (plain devcontainer CLI)

If wezterm-server is used without lace, the `customizations.lace` section is
ignored by the standard devcontainer CLI. Users would need to add the SSH key
mount manually. The static mount string preserved in devcontainer.json
(belt-and-suspenders) handles this for the lace project itself.

### Forward compatibility: old lace versions with new feature metadata

Old lace versions that don't recognize `sourceMustBe` will silently drop the
field during `parseMountDeclarationEntry()` (unknown fields are ignored). The
mount will be treated as a directory mount and auto-created via `mkdirSync`.
This is safe but results in a directory being mounted where a file is expected,
which will fail at Docker mount time or at sshd authentication time. The
`fileExists` check at Phase 0b (preserved in devcontainer.json) catches this
for the lace project itself.

### `--skip-validation` + `--skip-metadata-validation` interaction

When both flags are set: `fileExists` at Phase 0b is downgraded to warning
(from `--skip-validation`). Feature-level validation is skipped entirely
(metadata fetch is skipped by `--skip-metadata-validation`). The mount is
injected from the static mount string in devcontainer.json, not from
auto-injection. This is the expected escape-hatch behavior.

## Implementation Phases

### Phase 1: `sourceMustBe` in declaration model and parser

**Files to modify:**

1. **`packages/lace/src/lib/feature-metadata.ts`**

   Add `sourceMustBe` and `hint` fields to `LaceMountDeclaration`:

   ```typescript
   export interface LaceMountDeclaration {
     target: string;
     /**
      * Suggested host source path, surfaced in config guidance.
      * When `sourceMustBe` is set, also serves as the default source path
      * (expanded via tilde expansion) if no settings override is configured.
      */
     recommendedSource?: string;
     description?: string;
     readonly?: boolean;
     type?: string;
     consistency?: string;
     /**
      * When set, the resolved source must already exist as the specified type.
      * - "file": source must be an existing file (validated via statSync().isFile())
      * - "directory": source must be an existing directory (validated via statSync().isDirectory())
      * When omitted, the default behavior applies: auto-create directory via mkdirSync.
      */
     sourceMustBe?: "file" | "directory";
     /** Remediation hint shown when a validated source is missing. */
     hint?: string;
   }
   ```

   Update `parseMountDeclarationEntry()` (currently at line 579) to parse
   the new fields. Add after the `consistency` extraction (line 598):

   ```typescript
   sourceMustBe:
     entry.sourceMustBe === "file" || entry.sourceMustBe === "directory"
       ? entry.sourceMustBe
       : undefined,
   hint:
     typeof entry.hint === "string" ? entry.hint : undefined,
   ```

   Update the `recommendedSource` JSDoc from "never used as actual source" to
   the dual-role description above. The current JSDoc is at line 62.

2. **`packages/lace/src/lib/mount-resolver.ts`**

   Add `import { statSync } from "node:fs"` to the existing fs imports (line 2).

   Add `import { expandPath } from "./settings"` (settings already has this
   utility at line 51, and host-validator.ts imports from it at line 12).

   Modify `resolveSource()` (currently at line 174). After the label validation
   and existing-assignment check (lines 175-182), before the settings override
   check (line 187), add a branch for validated mounts:

   ```typescript
   const decl = this.declarations[label];
   if (decl?.sourceMustBe) {
     return this.resolveValidatedSource(label, decl);
   }
   ```

   Add new private method `resolveValidatedSource()`:

   ```typescript
   /**
    * Resolve source for a validated mount (sourceMustBe is set).
    * Uses settings override or recommendedSource instead of auto-derived path.
    * Validates existence and type via statSync().
    */
   private resolveValidatedSource(
     label: string,
     decl: LaceMountDeclaration,
   ): string {
     const [namespace, labelPart] = label.split("/");

     // 1. Check settings override
     const overrideSettings = this.settings.mounts?.[label];
     if (overrideSettings?.source) {
       const overridePath = overrideSettings.source;
       this.validateSourceType(overridePath, decl.sourceMustBe!, label, /* isOverride */ true);
       const assignment: MountAssignment = {
         label,
         resolvedSource: overridePath,
         isOverride: true,
         assignedAt: new Date().toISOString(),
       };
       this.assignments.set(label, assignment);
       return overridePath;
     }

     // 2. Use recommendedSource (expanded)
     if (decl.recommendedSource) {
       const expandedPath = expandPath(decl.recommendedSource);
       this.validateSourceType(expandedPath, decl.sourceMustBe!, label, /* isOverride */ false, decl);
       const assignment: MountAssignment = {
         label,
         resolvedSource: expandedPath,
         isOverride: false,
         assignedAt: new Date().toISOString(),
       };
       this.assignments.set(label, assignment);
       return expandedPath;
     }

     // 3. No source available
     throw new Error(
       `Validated mount "${label}" has no source.\n` +
       `  Add to ~/.config/lace/settings.json:\n` +
       `    { "mounts": { "${label}": { "source": "/path/to/source" } } }`,
     );
   }

   /**
    * Validate that a path exists and matches the expected type.
    * @throws Error with actionable guidance on failure
    */
   private validateSourceType(
     path: string,
     expectedType: "file" | "directory",
     label: string,
     isOverride: boolean,
     decl?: LaceMountDeclaration,
   ): void {
     let stats: import("node:fs").Stats;
     try {
       stats = statSync(path);
     } catch (err: unknown) {
       if ((err as NodeJS.ErrnoException).code === "ENOENT") {
         if (isOverride) {
           throw new Error(
             `Mount override source does not exist for "${label}": ${path}\n` +
             `  Create the ${expectedType} or remove the override from settings.json.`,
           );
         }
         const featureName = label.split("/")[0];
         const lines = [
           `ERROR: ${featureName} requires ${expectedType}: ${path}`,
         ];
         if (decl?.description) {
           lines[0] += `\n       (${decl.description})`;
         }
         if (decl?.hint) {
           lines.push("", "  To create it:", `    ${decl.hint}`);
         }
         lines.push(
           "",
           "  To use a different path, add to ~/.config/lace/settings.json:",
           `    { "mounts": { "${label}": { "source": "/path/to/your/${expectedType}" } } }`,
         );
         throw new Error(lines.join("\n"));
       }
       throw err;
     }

     const actualType = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "unknown";
     if (
       (expectedType === "file" && !stats.isFile()) ||
       (expectedType === "directory" && !stats.isDirectory())
     ) {
       throw new Error(
         `${label}: expected ${expectedType} but found ${actualType} at ${path}`,
       );
     }
   }
   ```

**Test file:** `packages/lace/src/lib/__tests__/mount-resolver.test.ts`

Add a new describe block `"MountPathResolver -- validated mounts (sourceMustBe)"`:

| Test name | Setup | Expected |
|---|---|---|
| `resolveSource with sourceMustBe:"file" and existing file returns expanded path` | Create file at `tmpDir/key.pub`, declaration with `sourceMustBe: "file"`, `recommendedSource` pointing to it | Returns the absolute path, no `mkdirSync` called |
| `resolveSource with sourceMustBe:"file" and missing file throws with hint` | Declaration with `recommendedSource: "~/nonexistent.pub"`, `hint: "ssh-keygen ..."` | Throws error containing "requires file", the hint text, and settings.json example |
| `resolveSource with sourceMustBe:"file" and directory at path throws type mismatch` | Create directory at expected path | Throws "expected file but found directory" |
| `resolveSource with sourceMustBe:"directory" and existing directory returns path` | Create directory at path | Returns the path without calling `mkdirSync` |
| `resolveSource with sourceMustBe:"directory" and file at path throws type mismatch` | Create file at expected path | Throws "expected directory but found file" |
| `resolveSource with sourceMustBe:"file" and settings override (existing) returns override` | Create file at override path, settings with override | Returns override path |
| `resolveSource with sourceMustBe:"file" and settings override (missing) throws` | Settings override to nonexistent path | Throws "Mount override source does not exist" |
| `resolveSource with sourceMustBe:"file" no recommendedSource no override throws` | Declaration with no `recommendedSource`, no settings | Throws "has no source" with settings.json guidance |
| `resolveSource with sourceMustBe:"file" and symlink to file passes` | Symlink to existing file | Returns the symlink path |
| `resolveSource with sourceMustBe:"file" and broken symlink throws` | Broken symlink | Throws ENOENT-based error with hint |
| `resolveFullSpec with sourceMustBe:"file" returns correct mount spec` | Existing file, `readonly: true` | Returns `source=<path>,target=<target>,type=bind,readonly` |
| `resolveSource without sourceMustBe unchanged (auto-create directory)` | Standard declaration, no `sourceMustBe` | Creates directory, returns path (existing behavior) |

**Mock/fixture setup:** Use `writeFileSync` to create temp files, `mkdirSync`
for directories, `symlinkSync` for symlinks. Track created paths in
`createdMountDirs` for cleanup (existing pattern in test file).

**Success criteria:** All new tests pass. All existing mount-resolver tests
pass without modification.

---

### Phase 2: Feature-level validation in lace up pipeline

**Files to modify:**

1. **`packages/lace/src/lib/up.ts`**

   After mount declaration validation (Step 5, around line 332) and before
   the prebuild warnings step (Step 6, line 336), add a new step that
   validates `sourceMustBe` declarations using `MountPathResolver`.

   The validation must happen after `mountDeclarations` is built but before
   template resolution (Step 8), because `resolveSource()` is what performs
   the type check.

   Implementation approach: iterate `mountDeclarations`, find entries with
   `sourceMustBe` set, and attempt `resolveSource()` for each. Catch errors
   and format them as `CheckResult`-style output (matching `runHostValidation`
   format from Phase 0b). When `skipValidation` is true, downgrade to warnings
   with the Docker auto-create-directory caveat.

   ```typescript
   // Step 5.5: Validate sourceMustBe declarations
   if (Object.keys(mountDeclarations).length > 0) {
     const validatedMounts = Object.entries(mountDeclarations)
       .filter(([_, decl]) => decl.sourceMustBe);

     if (validatedMounts.length > 0) {
       const validationErrors: string[] = [];
       for (const [label, decl] of validatedMounts) {
         try {
           mountResolver.resolveSource(label);
         } catch (err) {
           const message = err instanceof Error ? err.message : String(err);
           if (skipValidation) {
             console.warn(
               `Warning: ${message}\n` +
               `  Docker will create a directory at this path, which will silently break the mount.`,
             );
           } else {
             validationErrors.push(message);
           }
         }
       }

       if (validationErrors.length > 0) {
         const msg = validationErrors.join("\n\n");
         result.exitCode = 1;
         result.message = msg;
         result.phases.templateResolution = {
           exitCode: 1,
           message: `Validated mount check failed`,
         };
         return result;
       }
     }
   }
   ```

   Note: The `MountPathResolver` must be constructed **before** this step,
   so move the settings load + resolver construction (currently Steps 7, lines
   346-356) to before Step 5.5. This is safe because the resolver doesn't
   depend on any state from Steps 6 or 7.

**Test file:** `packages/lace/src/lib/__tests__/up-mount.integration.test.ts`

Add new integration tests in a describe block
`"lace up -- validated mount (sourceMustBe) integration"`:

| Test name | Setup | Expected |
|---|---|---|
| `lace up fails with actionable error when sourceMustBe file is missing` | Feature metadata with `sourceMustBe: "file"`, `recommendedSource` pointing to nonexistent file | `exitCode: 1`, message contains "requires file", hint, settings.json example |
| `lace up succeeds when sourceMustBe file exists` | Create the expected file, feature metadata with `sourceMustBe: "file"` | `exitCode: 0`, resolved mount in output config |
| `lace up downgrades to warning with --skip-validation when sourceMustBe file missing` | Missing file, `skipValidation: true` | `exitCode: 0`, console.warn output contains Docker auto-create caveat |
| `lace up succeeds with settings override for sourceMustBe mount` | File at override path, settings.json with override | `exitCode: 0`, mount source in generated config uses override path |
| `Phase 0b fileExists catches missing key when metadata fetch fails` | Missing file, `skipMetadataValidation: true` with fileExists check in config | `exitCode: 1` from Phase 0b, error message from fileExists check |

**Mock setup:** Use the existing `createMetadataMock()` pattern from
`up-mount.integration.test.ts` to return feature metadata that includes
`sourceMustBe` declarations. Write real files to tmpdir for positive cases.

**Success criteria:** `lace up` fails with full actionable error when SSH key
missing. Phase 0b fallback works when metadata unavailable.

---

### Phase 3: wezterm-server feature metadata update

**Files to modify:**

1. **`devcontainers/features/src/wezterm-server/devcontainer-feature.json`**

   Add `mounts` section to the existing `customizations.lace` object
   (currently at line 24). The result:

   ```json
   "customizations": {
       "lace": {
           "ports": {
               "hostSshPort": {
                   "label": "wezterm ssh",
                   "onAutoForward": "silent",
                   "requireLocalPort": true
               }
           },
           "mounts": {
               "authorized-keys": {
                   "target": "/home/node/.ssh/authorized_keys",
                   "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
                   "description": "SSH public key for WezTerm SSH domain access",
                   "readonly": true,
                   "sourceMustBe": "file",
                   "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh"
               }
           }
       }
   }
   ```

   Bump `version` from `"1.1.0"` to `"1.2.0"` (new feature field).

**Test file:** `packages/lace/src/lib/__tests__/up-mount.integration.test.ts`

Add a new describe block `"lace up -- wezterm-server SSH key mount scenario"`:

| Test name | Setup | Expected |
|---|---|---|
| `SSH key mount auto-injected from wezterm-server metadata` | Use real wezterm-server metadata (with mounts section), create key file at recommended path | Resolved config mounts array contains `source=<key-path>,target=/home/node/.ssh/authorized_keys,type=bind,readonly` |
| `error message includes all five elements when key missing` | No key file present, wezterm-server metadata with mounts | Error message contains: (1) feature name "wezterm-server", (2) description text, (3) default path, (4) ssh-keygen hint, (5) settings.json override example |
| `guidance output mentions SSH key for successful run` | Key file present | Console output includes mount assignment for `wezterm-server/authorized-keys` |

**Mock setup:** Extend the existing `weztermMetadata` test fixture
(line 48 of `up-mount.integration.test.ts`) to include the `mounts` section.
Use `writeFileSync` to create a temporary file as the SSH key.

**Success criteria:** Auto-injected mount resolves correctly. Error messages
are complete and actionable.

---

### Phase 4: Mount target deduplication

**Files to modify:**

1. **`packages/lace/src/lib/template-resolver.ts`**

   Current `validateMountTargetConflicts()` (line 353) throws on any duplicate
   target. It operates only on structured `LaceMountDeclaration` objects from
   the declarations map.

   The deduplication must happen at a different layer: in `autoInjectMountTemplates()`
   (line 459) or as a new post-injection step. The approach:

   Add a new function `deduplicateStaticMounts()`:

   ```typescript
   /**
    * Remove static mount strings from the config's mounts array when they
    * conflict with auto-injected declaration targets.
    *
    * A "static mount" is a raw mount string (not a ${lace.mount()} template).
    * Target extraction: parse `target=<value>` from comma-separated strings,
    * or read `target` property from mount objects.
    *
    * Returns the labels of static mounts that were removed.
    */
   export function deduplicateStaticMounts(
     config: Record<string, unknown>,
     declarations: Record<string, LaceMountDeclaration>,
   ): string[] {
   ```

   Implementation:
   - Build a set of declaration target paths from `declarations`.
   - Iterate the config's `mounts` array.
   - For each entry that is NOT a `${lace.mount()}` template:
     - Extract target: for strings, parse `target=<value>` via regex
       `/target=([^,]+)/`; for objects, read `.target` property.
     - If the target is in the declarations set, remove the entry and
       log a debug message.
   - Return removed entries for logging.

   Call `deduplicateStaticMounts()` in `autoInjectMountTemplates()` after
   building declarations and before injection, or as a separate call in
   `up.ts` after `autoInjectMountTemplates()` returns.

**Test file:** `packages/lace/src/lib/__tests__/template-resolver.test.ts`

Add a new describe block `"deduplicateStaticMounts"`:

| Test name | Setup | Expected |
|---|---|---|
| `removes static mount string when declaration has same target` | Mounts array: `["source=/foo,target=/bar,type=bind"]`, declaration with `target: "/bar"` | Static mount removed, array has only auto-injected template |
| `preserves static mount when no declaration target matches` | Mounts array: `["source=/foo,target=/baz,type=bind"]`, declaration with `target: "/bar"` | Both mounts preserved |
| `handles ${localEnv:HOME} in static mount source (does not match target parse)` | Static mount with `${localEnv:HOME}` in source | Correctly parses target segment regardless of source content |
| `handles object-form mounts` | Mounts array with `{ source: "/foo", target: "/bar", type: "bind" }` | Object mount removed when target matches |
| `does not remove ${lace.mount()} templates` | Mounts array with `"${lace.mount(ns/label)}"` | Template preserved even if its declaration has matching target |
| `returns list of removed mount descriptions` | Static mount removed | Return value includes the removed mount's target |

**Success criteria:** `lace up` works with both auto-injected and static
mounts targeting the same path without a conflict error.

---

### Phase 5: Update devcontainer.json paths

Since no backwards compatibility or migration is needed, this is a
straightforward path swap.

**Files to modify:**

1. **`.devcontainer/devcontainer.json`**

   Update the `fileExists` check (line 28-31):
   ```json
   {
     "path": "~/.config/lace/ssh/id_ed25519.pub",
     "severity": "error",
     "hint": "Run: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh"
   }
   ```

   Update the static mount string (line 70):
   ```
   "source=${localEnv:HOME}/.config/lace/ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
   ```

   Update the comment (line 69):
   ```
   // SSH public key for WezTerm SSH domain access (host -> container)
   // One-time setup: mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N "" && chmod 700 ~/.config/lace/ssh
   ```

**Test file:** `packages/lace/src/lib/__tests__/host-validator.test.ts`

No new tests needed -- the existing `runHostValidation` tests already cover
tilde expansion and file existence checking. The path change is a data
change, not a logic change.

**Success criteria:** `lace up` validates against the new path.
Non-lace contributors get the correct `fileExists` hint. The static mount
points to the new key path.

---

### Phase 6: Mount guidance and error message polish

**Files to modify:**

1. **`packages/lace/src/lib/template-resolver.ts`**

   Update `emitMountGuidance()` (line 378). Currently it shows "using default
   path" for non-override mounts and suggests configuring via settings.json.
   For validated mounts (`decl.sourceMustBe` is set), change the output:

   ```typescript
   if (decl?.sourceMustBe) {
     // Validated mount: show as resolved file/directory, not "default path"
     lines.push(`  ${assignment.label}: ${assignment.resolvedSource} (${decl.sourceMustBe})`);
   } else if (assignment.isOverride) {
     lines.push(`  ${assignment.label}: ${assignment.resolvedSource} (override)`);
   } else {
     lines.push(`  ${assignment.label}: using default path ${assignment.resolvedSource}`);
     // ... existing recommendedSource guidance ...
   }
   ```

**Test file:** `packages/lace/src/lib/__tests__/template-resolver.test.ts`

Add tests in the existing `"emitMountGuidance"` describe block (if present)
or create one:

| Test name | Setup | Expected |
|---|---|---|
| `shows validated mount as file type` | Assignment for mount with `sourceMustBe: "file"` | Output contains `(file)`, not "using default path" |
| `shows validated mount as directory type` | Assignment for mount with `sourceMustBe: "directory"` | Output contains `(directory)` |
| `does not suggest settings.json for validated mount with resolved source` | Validated mount that resolved successfully | No "Optional: configure source" line |

**Success criteria:** Guidance output distinguishes validated mounts from
auto-created directory mounts. Error messages for missing files are
copy-paste-friendly.
