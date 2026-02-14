---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T09:40:00-08:00
task_list: lace/structured-output
type: proposal
state: live
status: review_ready
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-14T21:00:00-08:00
  round: 2
tags: [mounts, validation, devcontainer, legibility, refactor, types]
---

# Structured Devcontainer.json Output

> BLUF: Refactor lace's config generation pipeline to use typed intermediate representations and object-format output wherever the devcontainer specification permits, improving legibility and enabling structural validation of the generated `.lace/devcontainer.json`. The Mount JSON schema's `additionalProperties: false` constraint means `readonly` mounts MUST stay as strings (see [research report](../reports/2026-02-14-devcontainer-json-object-specifications.md)), but we gain significant wins by: (1) introducing a typed `DevcontainerMount` interface with serialization-time format selection, (2) converting `postCreateCommand` merging to the object/parallel format, (3) adding a mount-string parser and validator that catches malformed mounts before `docker run`, and (4) converting user-authored mounts in `.devcontainer/devcontainer.json` to object format where `readonly` is not needed. The CLI regex for feature mounts (`/^type=(bind|volume),source=([^,]+),target=([^,]+)(?:,external=(true|false))?$/`) is stricter than the general mount parser, but neither path validates string mounts at config-read time — errors surface only at `docker run`. Lace can close this validation gap.

## Objective

Make lace's generated `.lace/devcontainer.json` more legible to humans and more inspectable by tools, by preferring structured JSON objects over opaque string micro-formats wherever the specification allows, and by adding validation for the cases where strings remain necessary.

## Background

### Current State

Lace generates several devcontainer.json values as Docker-style string micro-formats:

1. **Repo mount strings** — `generateMountSpec()` in `mounts.ts:285-297` produces `type=bind,source=...,target=...[,readonly]`
2. **appPort strings** — `template-resolver.ts` generates `HOST:CONTAINER` port mappings like `"22430:2222"`
3. **workspaceMount** — user-authored string in `.devcontainer/devcontainer.json`, passed through verbatim
4. **User-authored mounts** — 4 string-format mounts in the source config, 2 using `readonly`
5. **postCreateCommand merging** — `up.ts:471-490` concatenates symlink commands via `&&` string chaining

### Specification Constraints (from Research Report)

The [devcontainer JSON object specifications report](../reports/2026-02-14-devcontainer-json-object-specifications.md) established:

- **Mount objects** support only `{type, source, target}` with `additionalProperties: false`. The `readonly` flag is NOT supported in object form — this is a hard spec constraint.
- **String mounts** pass through to Docker's `--mount` flag verbatim. The CLI does not validate them at config-read time.
- **workspaceMount** is string-only per spec. No object alternative exists.
- **appPort** is `integer | string | array` — no object format exists.
- **Lifecycle commands** (postCreateCommand, etc.) support three formats: string (shell), array (exec), object (named parallel tasks).
- **Feature mounts** in `devcontainer-feature.json` are object-only — no string format.

### CLI Validation Behavior

The devcontainer CLI (v0.83.0) has two mount parsing paths:

1. **Feature mounts**: validated against the regex `^type=(bind|volume),source=([^,]+),target=([^,]+)(?:,external=(true|false))?$` — very strict, no `readonly`/`consistency`.
2. **General mounts**: `parseMount()` splits on commas and `=`, preserving all key-value pairs including unknown ones. No validation at parse time.
3. **Output**: `generateMountCommand()` for object mounts serializes only `type`, `source`, `target` — dropping any extra properties. String mounts pass through verbatim.

Neither path validates mount strings at config-read time. Malformed strings fail at `docker run`, which can be minutes into the `lace up` pipeline.

## Proposed Solution

### Architecture

Introduce a three-layer model for mount handling:

```
Layer 1: Typed Internal Representation (ResolvedRepoMount — already exists)
    ↓
Layer 2: Devcontainer Mount Interface (NEW — includes readonly, consistency)
    ↓
Layer 3: Output Serialization (string or object based on properties used)
```

Add a mount string parser for validation (reverse of `generateMountSpec`), and convert `postCreateCommand` to use the object/parallel format.

### New Types

```typescript
/** Devcontainer mount in structured form. Superset of the spec's Mount schema. */
interface DevcontainerMount {
  type: "bind" | "volume";
  /** Optional per spec — volume mounts can omit source (Docker auto-generates an anonymous volume name).
   *  Bind mounts semantically require source, enforced at validation time, not at the type level. */
  source?: string;
  target: string;
  /** Only expressible in string format output — forces string serialization. */
  readonly?: boolean;
  /** Only expressible in string format output — forces string serialization. */
  consistency?: "consistent" | "cached" | "delegated";
  /** Unrecognized key-value pairs from the original mount string.
   *  Preserved for forward compatibility with Docker mount params (bind-propagation, volume-driver, etc.).
   *  Mounts with extras are always serialized as strings since the object schema cannot represent them. */
  extras?: Record<string, string | undefined>;
}

/** Known aliases normalized during parsing. */
const MOUNT_KEY_ALIASES: Record<string, string> = {
  src: "source",
  dst: "target",
  destination: "target",
  ro: "readonly",
};

/** The spec-compliant subset that can be expressed as a JSON object. */
interface DevcontainerMountObject {
  type: "bind" | "volume";
  source: string;
  target: string;
}
```

### Serialization Logic

```typescript
function serializeMount(mount: DevcontainerMount): DevcontainerMountObject | string {
  // If mount uses properties not in the object schema, serialize as string.
  // This includes: readonly, consistency, extras (unknown Docker params), or missing source.
  if (mount.readonly || mount.consistency || mount.extras || !mount.source) {
    return mountToString(mount);
  }
  // Otherwise, emit as a clean JSON object
  return { type: mount.type, source: mount.source, target: mount.target };
}
```

This means the generated `.lace/devcontainer.json` will have a mix:
```json
{
  "mounts": [
    { "type": "bind", "source": "/home/user/code/history", "target": "/commandhistory" },
    { "type": "bind", "source": "/home/user/.claude", "target": "/home/node/.claude" },
    "type=bind,source=/home/user/.ssh/key.pub,target=/home/node/.ssh/authorized_keys,readonly",
    "type=bind,source=/home/user/dotfiles,target=/mnt/lace/repos/dotfiles,readonly"
  ]
}
```

The devcontainer spec explicitly allows mixed arrays (`anyOf: [string, Mount]` per item).

### Mount String Parser

```typescript
/** Parse a Docker-style mount string into a DevcontainerMount.
 *  Throws on structurally invalid input (missing type/target).
 *  Unknown parameters are preserved in `extras` and trigger a warning — NOT an error.
 *  This ensures forward compatibility with Docker mount params lace doesn't yet know about
 *  (bind-propagation, volume-driver, volume-nocopy, bind-recursive, etc.). */
function parseMountString(str: string): DevcontainerMount {
  if (!str.trim()) throw new MountsError("Empty mount string");
  const parts = str.split(",").filter(Boolean); // filter handles trailing comma
  const mount: Partial<DevcontainerMount> = {};
  const extras: Record<string, string | undefined> = {};
  for (const part of parts) {
    const [key, ...valueParts] = part.split("=");
    const value = valueParts.length > 0 ? valueParts.join("=") : undefined; // Handle values with = in them; undefined for bare flags
    const normalizedKey = MOUNT_KEY_ALIASES[key] ?? key;
    switch (normalizedKey) {
      case "type": mount.type = value as "bind" | "volume"; break;
      case "source": mount.source = value; break;
      case "target": mount.target = value; break;
      case "readonly": mount.readonly = true; break; // bare flag, value ignored
      case "consistency": mount.consistency = value as any; break;
      default:
        // Preserve unknown params for forward compatibility; warn at call site
        extras[key] = value;
        break;
    }
  }
  if (!mount.type) throw new MountsError("Mount missing required 'type' parameter");
  if (!mount.target) throw new MountsError("Mount missing required 'target' parameter");
  // Bind mounts semantically require source (volume mounts may omit it)
  if (mount.type === "bind" && !mount.source) {
    throw new MountsError("Bind mount missing required 'source' parameter");
  }
  if (Object.keys(extras).length > 0) {
    mount.extras = extras;
  }
  return mount as DevcontainerMount;
}
```

### postCreateCommand Object Format

Convert `generateExtendedConfig` to merge lifecycle commands using the object/parallel format:

**Before:**
```json
"postCreateCommand": "git config --global --add safe.directory '*' && mkdir -p ... && rm -f ... && ln -s ..."
```

**After:**
```json
"postCreateCommand": {
  "lace:user-setup": "git config --global --add safe.directory '*'",
  "lace:symlinks": "mkdir -p ... && rm -f ... && ln -s ..."
}
```

This is cleaner, names the tasks for logging, and avoids fragile string concatenation. When the existing `postCreateCommand` is already an object, the merge is a simple object spread.

> NOTE: The object format runs tasks in **parallel** with no ordering guarantees (per the devcontainer spec). This is a semantic change from the current `&&` chaining, which runs sequentially. This is safe for lace's use case because lace symlinks and user commands operate on independent filesystem paths — symlinks target `/mnt/lace/repos/*` while user commands typically operate on the workspace or global configuration. If a future use case requires ordering (e.g., a user command depends on a symlink target), the user's command and lace's symlinks can be combined into a single string task to enforce sequential execution.

## Important Design Decisions

### Decision: Keep strings for readonly mounts, objects for simple mounts

**Decision:** Use `serializeMount()` to auto-select format based on properties used.

**Why:** The Mount JSON schema sets `additionalProperties: false` with only `type`, `source`, `target`. A mount with `readonly: true` as a JSON object would fail schema validation in VS Code, IDE linting, and any CI that validates devcontainer.json. String mounts bypass schema validation entirely and pass through to Docker. The mixed approach gives us structured objects where possible and validated strings where necessary.

### Decision: Parse and validate ALL mount strings (user-authored + generated)

**Decision:** Parse every string mount in the config through `parseMountString()` before writing the output. Unknown parameters are preserved (not rejected) and trigger a warning.

**Why:** The devcontainer CLI does not validate mount strings at config-read time. Malformed strings only fail at `docker run`, which is deep into the pipeline. By parsing and validating mount strings during `lace up`'s config generation phase, we catch structural errors early (missing type/target, bind mount without source). Unknown parameters like `bind-propagation`, `volume-driver`, etc. are preserved in an `extras` field for forward compatibility — the mount is forced to string serialization since the object schema cannot represent arbitrary params. A warning is emitted for unrecognized parameters so the user is aware, without breaking their workflow.

### Decision: Convert postCreateCommand to object format (parallel execution)

**Decision:** When lace adds symlink commands, always emit `postCreateCommand` as an object with named tasks. This changes execution from sequential (`&&`) to parallel (the devcontainer spec's object-format semantics).

**Why:** The current string concatenation (`${existing} && ${symlinkCommand}`) is fragile — it doesn't handle edge cases like existing commands that end with `||` or `&`. The object format runs tasks in parallel with named labels, which is more robust and more readable. The devcontainer CLI logs task names during execution, improving debuggability. Parallel execution is safe for lace's use case: lace symlinks operate on `/mnt/lace/repos/*` targets, independent of user commands which typically configure the workspace or global settings. The user's original command is preserved as a single string or array under the `lace:user-setup` key, maintaining its internal ordering.

### Decision: Do NOT attempt to convert workspaceMount or appPort

**Decision:** Leave `workspaceMount` and `appPort` as strings.

**Why:** `workspaceMount` is string-only per spec — no object alternative exists. `appPort` supports `integer | string | array` but no object format. Both are constrained by the specification, not by lace's implementation. Attempting to parse these into structured types would add complexity with no output benefit.

### Decision: Validate existing user mounts from source config

**Decision:** When reading `.devcontainer/devcontainer.json`, parse any string mounts through the validator.

**Why:** User-authored mounts can contain typos (e.g., `taget` instead of `target`, `typed=bind` instead of `type=bind`). These currently pass through silently and fail at `docker run`. Early validation during `lace up` improves the developer experience. However, mounts containing `${localEnv:...}` or `${localWorkspaceFolder}` template variables cannot be fully validated until variable substitution occurs — the validator must handle this gracefully by skipping validation of values that contain `${...}` patterns.

### Decision: Convert source devcontainer.json mounts to objects where possible

**Decision:** In a separate phase, update `.devcontainer/devcontainer.json` to use object format for mounts that don't use `readonly`.

**Why:** This improves the readability of the source config (which humans edit) and serves as a demonstration that the spec supports it. The two mounts without `readonly` (bash history, claude config) can become objects. The two with `readonly` (SSH key, wezterm config) must stay as strings.

## Edge Cases / Challenging Scenarios

### User mounts with devcontainer template variables

Mount strings like `source=${localEnv:HOME}/path,target=/container,type=bind` contain template variables that the devcontainer CLI substitutes at runtime. The mount parser must:
- Detect `${...}` patterns in source/target values. This pattern is intentionally broad — it matches devcontainer template variables (`${localEnv:...}`, `${containerEnv:...}`, `${localWorkspaceFolder}`, etc.) as well as shell variables (`${HOME}`). A more precise regex could target only devcontainer-specific patterns, but the broad match is simpler and conservatively safe (false negatives in validation are preferable to false positives).
- Skip path validation of those specific values (the path won't exist until substitution)
- Still validate the mount structure (type, presence of target, source for bind mounts)

### Existing postCreateCommand in array format

The current code handles `Array.isArray(existing)` by joining with spaces: `existing.join(" ")`. This is lossy — it conflates array-format exec commands with string arguments. With the object format approach, an existing array command should be preserved as-is under a "user-command" key.

### Mixed mount array (strings + objects) in user config

Users may already have a mix of string and object mounts in their source config. The validation layer must handle both formats — parse strings through `parseMountString()`, validate objects against the schema directly.

### Mounts with commas in paths

Docker mount strings use commas as delimiters. Paths containing commas (rare but possible, especially on Windows) break the parser. The devcontainer CLI itself has this limitation — it quotes values containing commas with `"`. The mount parser should detect quoted values and handle them.

### Readonly for lace-generated mounts

Lace's `generateMountSpec` currently generates `readonly` for cloned repo mounts and overrides that default to `readonly: true`. These MUST remain as string-format mounts in the output. The serialization logic handles this automatically via the `readonly` property check.

## Test Plan

### Unit Tests

All unit tests in vitest, extending existing test files.

**`mounts.test.ts` additions:**
- `parseMountString`: valid bind, valid volume, readonly flag (bare flag form), `ro` alias for readonly, consistency parameter, alias normalization (src→source, dst→target, destination→target), missing type error, missing target error, bind mount missing source error, volume mount without source (valid), unknown parameters preserved in extras (with warning), empty string error, trailing comma handled, `=` in path values (e.g. `source=/path/with=equals`)
- `serializeMount`: object output for simple mount, string output for readonly mount, string output for consistency mount, string output for mount with extras, string output for mount without source, round-trip semantic equivalence (generate → parse → serialize produces same fields/values, not necessarily same string due to alias normalization and parameter reordering)
- `mountToString`: correct ordering (type first), readonly flag appended, consistency appended, extras appended, missing source omitted
- `validateMountString`: valid strings pass, template variables in source/target are accepted (structure still validated), malformed strings throw with descriptive error

**`up.integration.test.ts` additions:**
- postCreateCommand merging: string user command → object output with `lace:user-setup` + `lace:symlinks`
- postCreateCommand merging: array user command → object output preserving array under `lace:user-setup`
- postCreateCommand merging: object user command → merged object with `lace:symlinks` key added
- postCreateCommand merging: object user command with existing `lace:symlinks` key → lace's key takes precedence (documented limitation)
- postCreateCommand merging: no user command → string (no object wrapping needed)
- postCreateCommand merging: no symlinks needed → user command passes through unchanged
- Mixed mount output: generated config has objects for simple mounts, strings for readonly mounts
- Mount validation: malformed user mount string → `lace up` fails with descriptive error before devcontainer up
- Mount validation: user mount with `${localEnv:...}` → passes validation, template variables preserved

**`devcontainer.test.ts` additions:**
- `parseMountString` with quoted values (commas in paths)
- `parseMountString` with `ro` alias for `readonly`
- `parseMountString` with template variables in source

### Smoke Tests (against live devcontainer CLI)

These tests verify the actual devcontainer CLI behavior with our output formats.

**S1: Object mount accepted by devcontainer CLI**
```bash
# Create minimal devcontainer.json with object mount
cat > /tmp/lace-smoke-test/.devcontainer/devcontainer.json <<'EOF'
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "mounts": [
    { "type": "bind", "source": "/tmp/lace-smoke-source", "target": "/mnt/test" }
  ]
}
EOF
mkdir -p /tmp/lace-smoke-source
# Validate: devcontainer read-configuration should parse without error
devcontainer read-configuration --workspace-folder /tmp/lace-smoke-test
```

**S2: Mixed mount array (string + object) accepted**
```bash
cat > /tmp/lace-smoke-test/.devcontainer/devcontainer.json <<'EOF'
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "mounts": [
    { "type": "bind", "source": "/tmp/lace-smoke-source", "target": "/mnt/test-obj" },
    "type=bind,source=/tmp/lace-smoke-source,target=/mnt/test-str,readonly"
  ]
}
EOF
devcontainer read-configuration --workspace-folder /tmp/lace-smoke-test
```

**S3: Object postCreateCommand accepted**
```bash
cat > /tmp/lace-smoke-test/.devcontainer/devcontainer.json <<'EOF'
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "postCreateCommand": {
    "lace:user-setup": "echo hello",
    "lace:symlinks": "echo world"
  }
}
EOF
devcontainer read-configuration --workspace-folder /tmp/lace-smoke-test
```

**S3b: Object postCreateCommand merge accepted**
```bash
cat > /tmp/lace-smoke-test/.devcontainer/devcontainer.json <<'EOF'
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "postCreateCommand": {
    "existing-task": "echo existing",
    "lace:symlinks": "echo symlinks"
  }
}
EOF
devcontainer read-configuration --workspace-folder /tmp/lace-smoke-test
# Expected: CLI accepts object format with lace: prefixed keys
```

**S4: Full lace up with structured output**
```bash
# Run lace up on the lace project itself (self-hosting)
cd /var/home/mjr/code/weft/lace
npx tsx packages/lace/src/cli.ts up --skip-devcontainer-up
# Inspect the generated config
cat .lace/devcontainer.json | python3 -m json.tool
# Verify: mounts array contains both objects and strings
# Verify: postCreateCommand is an object (if symlinks present) or unchanged string
```

**S5: Malformed mount string detection**
```bash
# Create config with intentionally malformed mount
cat > /tmp/lace-smoke-test/.devcontainer/devcontainer.json <<'EOF'
{
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "mounts": [
    "typed=bind,source=/tmp/foo,target=/mnt/bar"
  ]
}
EOF
# Without lace: devcontainer CLI silently accepts this, fails at docker run
devcontainer read-configuration --workspace-folder /tmp/lace-smoke-test
# Expected: no error from CLI (it doesn't validate mount strings)
# With lace: lace up should catch this during config generation
```

**S6: Verify lace devcontainer still starts correctly**
```bash
# After the refactor, verify the actual lace devcontainer builds and starts
cd /var/home/mjr/code/weft/lace
npx tsx packages/lace/src/cli.ts up
# Verify container is running
docker ps | grep lace
# Verify mounts are active
docker inspect $(docker ps -q --filter label=devcontainer.local_folder) | python3 -c "
import json,sys
data=json.load(sys.stdin)
for m in data[0]['Mounts']:
    print(f\"{m['Type']}: {m['Source']} -> {m['Destination']} ({'ro' if not m.get('RW', True) else 'rw'})\"
"
```

## Implementation Phases

### Phase 1: Mount Types and Parser

**Scope:** Add `DevcontainerMount` type, `parseMountString()`, `mountToString()`, and `serializeMount()` to `packages/lace/src/lib/mounts.ts`.

**Files modified:**
- `packages/lace/src/lib/mounts.ts` — new types and functions
- `packages/lace/src/lib/__tests__/mounts.test.ts` — new test cases

**Success criteria:**
- `parseMountString("type=bind,source=/foo,target=/bar,readonly")` returns `{ type: "bind", source: "/foo", target: "/bar", readonly: true }`
- `parseMountString("type=volume,target=/data")` returns `{ type: "volume", target: "/data" }` (source optional for volumes)
- `parseMountString("type=bind,source=/foo,target=/bar,bind-propagation=shared")` returns `{ type: "bind", source: "/foo", target: "/bar", extras: { "bind-propagation": "shared" } }` (unknown params preserved)
- `parseMountString("type=bind,target=/bar")` throws (bind mounts require source)
- `serializeMount({ type: "bind", source: "/foo", target: "/bar" })` returns `{ type: "bind", source: "/foo", target: "/bar" }` (object)
- `serializeMount({ type: "bind", source: "/foo", target: "/bar", readonly: true })` returns `"type=bind,source=/foo,target=/bar,readonly"` (string)
- `serializeMount({ type: "volume", target: "/data" })` returns `"type=volume,target=/data"` (string — no source means object format cannot be used)
- Round-trip: `mountToString(parseMountString(str))` produces semantically equivalent output (same fields/values; parameter order and aliases may be normalized)
- Template variables (`${localEnv:HOME}/path`) in source/target values are preserved without validation error
- All existing mount tests continue to pass

**Constraints:**
- Do not modify `generateMountSpec` signature or behavior yet (consumers depend on it)
- Do not modify `up.ts` in this phase

### Phase 2: Structured Mount Output in Config Generation

**Scope:** Update `generateExtendedConfig()` in `up.ts` to use `serializeMount()` for repo mount output, and validate user-authored mount strings from the source config.

**Files modified:**
- `packages/lace/src/lib/up.ts` — mount serialization and validation
- `packages/lace/src/lib/mounts.ts` — change `generateMountSpec` return type to `DevcontainerMount` (rename to `generateMount`), add `generateMountSpecs` returning `DevcontainerMount[]`
- `packages/lace/src/lib/resolve-mounts.ts` — update `ResolveMountsResult.mountSpecs` type from `string[]` to `DevcontainerMount[]`, update `runResolveMounts()` return path
- `packages/lace/src/commands/resolve-mounts.ts` — update to use new types (passes through from lib)
- `packages/lace/src/lib/__tests__/mounts.test.ts` — update expectations
- `packages/lace/src/commands/__tests__/up.integration.test.ts` — verify mixed output
- `packages/lace/src/commands/__tests__/resolve-mounts.integration.test.ts` — update expectations

**Success criteria:**
- Generated `.lace/devcontainer.json` has object mounts where `readonly` is not used
- Generated config has string mounts where `readonly` is used
- Malformed user mount strings in `.devcontainer/devcontainer.json` cause `lace up` to fail with a descriptive error
- User mounts with template variables (`${localEnv:...}`) pass validation
- Run smoke test S4 to verify output format
- All existing tests pass (with updated expectations)

**Constraints:**
- Do not modify the source `.devcontainer/devcontainer.json` in this phase
- Do not change `postCreateCommand` handling in this phase
- The `GenerateExtendedConfigOptions.mountSpecs` type changes from `string[]` to `DevcontainerMount[]`

### Phase 3: Object-Format postCreateCommand

**Scope:** Refactor `generateExtendedConfig`'s symlink command merging to use the object/parallel format.

**Files modified:**
- `packages/lace/src/lib/up.ts` — postCreateCommand merging logic (lines 471-490)
- `packages/lace/src/commands/__tests__/up.integration.test.ts` — update + new tests

**Success criteria:**
- When user has string `postCreateCommand` and lace adds symlinks: output is `{ "lace:user-setup": "<original>", "lace:symlinks": "<symlink commands>" }` (parallel execution)
- When user has array `postCreateCommand` and lace adds symlinks: output is `{ "lace:user-setup": ["cmd", "args"], "lace:symlinks": "<symlink commands>" }` (array preserved as-is, never joined)
- When user has object `postCreateCommand` and lace adds symlinks: output merges `lace:symlinks` key into existing object (if user has a `lace:symlinks` key, it is overwritten — documented limitation)
- When user has no `postCreateCommand` and lace adds symlinks: output is string (no wrapping needed for single command)
- When no symlinks needed: `postCreateCommand` passes through unchanged
- Run smoke test S3 to verify CLI accepts object format
- All existing tests pass (with updated expectations)

**Constraints:**
- Do not change the symlink command generation itself (`generateSymlinkCommands`)
- Preserve backward compatibility: if no symlinks, don't change format

### Phase 4: Source Config Cleanup

**Scope:** Convert the user-authored `.devcontainer/devcontainer.json` mounts to object format where `readonly` is not used.

**Files modified:**
- `.devcontainer/devcontainer.json` — convert 2 of 4 mounts to objects

**Success criteria:**
- The two non-readonly mounts (bash history, claude config) are JSON objects
- The two readonly mounts (SSH key, wezterm config) remain as strings
- `workspaceMount` remains as a string (spec constraint)
- `lace up` produces the same functional output (verified via smoke test S6)
- `devcontainer read-configuration` accepts the config (verified via smoke test S2)

**Changes:**
```json
// Before:
"mounts": [
    "source=${localEnv:HOME}/code/dev_records/weft/bash/history,target=/commandhistory,type=bind",
    "source=${localEnv:HOME}/code/dev_records/weft/claude,target=/home/node/.claude,type=bind",
    "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
]
// After:
"mounts": [
    { "type": "bind", "source": "${localEnv:HOME}/code/dev_records/weft/bash/history", "target": "/commandhistory" },
    { "type": "bind", "source": "${localEnv:HOME}/code/dev_records/weft/claude", "target": "/home/node/.claude" },
    "source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly",
    "source=${localWorkspaceFolder}/.devcontainer/wezterm.lua,target=/home/node/.config/wezterm/wezterm.lua,type=bind,readonly"
]
```

**Constraints:**
- Must verify with `devcontainer read-configuration` before committing
- Must verify the devcontainer still starts and mounts work correctly
- The two remaining readonly string mounts are left in their current parameter order (`source,target,type,readonly`) — normalization is NOT in scope for this phase

### Phase 5: Smoke Test Suite

**Scope:** Implement S1-S6 as automated tests that can be run against the local environment.

**Files modified:**
- New file: `packages/lace/src/commands/__tests__/smoke-mounts.test.ts`

**Success criteria:**
- S1-S3 use `devcontainer read-configuration` to validate generated configs (fast, no container needed)
- S4 runs `lace up --skip-devcontainer-up` and inspects `.lace/devcontainer.json`
- S5 verifies that lace catches malformed mounts before CLI does
- S6 is a manual/CI-only test (requires container runtime) — documented but not automated in vitest

**Constraints:**
- Tests must not start or stop containers (except S6 which is manual)
- Tests must clean up temp directories
- `devcontainer` CLI must be available on PATH (skip with descriptive message if not)

## Open Questions

1. **~~Should the mount validator be strict or permissive about unknown parameters?~~** Resolved: permissive with warnings. Unknown parameters are preserved in an `extras` field and force string serialization. The parser validates structural requirements (type, target, source for bind mounts) strictly, but unknown key-value pairs are preserved for forward compatibility with Docker mount params. A warning is emitted so typos are surfaced without breaking the workflow.

2. **Should the mount string normalizer reorder parameters?** The devcontainer CLI expects `type` first in its feature mount regex. Normalizing all mounts to `type,source,target,...` order would be more predictable but technically unnecessary for general mounts. Recommendation: normalize to `type,source,target` order for consistency.

3. **Should lace validate the full config against the devcontainer JSON schema?** This proposal only validates mount strings. A more comprehensive approach would validate the entire output against `devContainer.base.schema.json`. This would catch issues like typos in top-level property names. Recommendation: out of scope for this proposal; consider as follow-up.
