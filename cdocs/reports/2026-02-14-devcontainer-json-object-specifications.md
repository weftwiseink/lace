---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T12:00:00-08:00
task_list: lace/devcontainer-spec-research
type: report
state: archived
status: archived
tags: [devcontainer, specification, schema, mounts, ports, research, reference]
---

# Devcontainer JSON Object Specifications vs String Micro-Formats

> BLUF: The devcontainer specification supports dual formats (structured JSON objects and string micro-formats) for mounts, lifecycle commands, and several other properties. The JSON schema for mounts is surprisingly minimal (only `type`, `source`, `target` with `additionalProperties: false`), yet the string format accepts arbitrary Docker `--mount` parameters like `consistency` and `readonly` that the object schema rejects. The devcontainer CLI itself uses `consistency` internally for workspace mounts but does not expose it in the Mount object schema. This gap between the schema, the CLI implementation, and Docker's full `--mount` capabilities creates a practical preference for string-format mounts when advanced options are needed. Lifecycle commands have a clean three-way format (string, array, object) with clear behavioral differences. Port forwarding uses a number-or-string pattern for items but an object format for attributes.

## Context / Background

The lace project generates devcontainer.json configurations programmatically, including mount specifications (`generateMountSpec` in `packages/lace/src/lib/mounts.ts`). Understanding the full schema for JSON object definitions versus string micro-formats is essential for:

1. Deciding whether lace should generate string or object mounts.
2. Knowing which advanced mount options (readonly, consistency, bind-propagation) are available in each format.
3. Understanding validation behavior differences that affect CI and tooling.
4. Ensuring generated configurations are forward-compatible with the devcontainer specification.

This report documents every devcontainer.json property that supports multiple formats, with exact schemas, parsing behavior, and gotchas drawn from the specification, the JSON schema, and the devcontainers/cli source code.

## Key Findings

- The Mount JSON schema has only 3 fields (`type`, `source`, `target`) and sets `additionalProperties: false`, meaning properties like `readonly` and `consistency` are schema-invalid in object form.
- String-format mounts pass through to Docker's `--mount` flag verbatim, supporting all Docker mount options without schema validation.
- The devcontainer CLI internally generates workspace mounts with `consistency=cached` or `consistency=consistent` on macOS/Windows, but this parameter is not in the Mount schema.
- Feature mounts (`devcontainer-feature.json`) only support object format -- no string format allowed.
- Lifecycle commands have three formats with distinct execution semantics: string (shell), array (no shell), object (parallel).
- `forwardPorts` items use a `oneOf` pattern: integer (0-65535) or string matching `^([a-z0-9-]+):(\d{1,5})$`.
- `hostRequirements.gpu` is the only property using a true `oneOf` with boolean, string enum, and object variants.
- `appPort` accepts the widest format variety: integer, string, or array of either.
- `remoteEnv` values can be `string | null` (null unsets a variable), while `containerEnv` values are strictly `string`.

## 1. Mount Configurations

### JSON Object Schema (from `devContainer.base.schema.json`)

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": ["bind", "volume"],
      "description": "Mount type."
    },
    "source": {
      "type": "string",
      "description": "Mount source."
    },
    "target": {
      "type": "string",
      "description": "Mount target."
    }
  },
  "required": ["type", "target"],
  "additionalProperties": false
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"bind"` or `"volume"` | Yes | Mount type |
| `source` | string | No | Host path (bind) or volume name (volume) |
| `target` | string | Yes | Container destination path |

**Critically absent from the object schema:** `readonly`, `consistency`, `bind-propagation`, `volume-opt`, `tmpfs-size`, `volume-driver`, `volume-nocopy`, `bind-recursive`. The `additionalProperties: false` constraint means any of these would fail JSON schema validation if added to the object form.

### String Micro-Format

The `mounts` property description reads: *"See Docker's documentation for the --mount option for the supported syntax."*

The string format is a comma-separated list of `key=value` pairs matching Docker's `--mount` flag syntax:

```
type=bind,source=/host/path,target=/container/path,readonly,consistency=cached
```

**Supported Docker `--mount` parameters (bind mounts):**

| Parameter | Aliases | Values |
|-----------|---------|--------|
| `type` | -- | `bind`, `volume`, `tmpfs` |
| `source` | `src` | Host path or volume name |
| `target` | `destination`, `dst` | Container path |
| `readonly` | `ro` | Flag (no value needed) |
| `consistency` | -- | `consistent`, `cached`, `delegated` |
| `bind-propagation` | -- | `shared`, `slave`, `private`, `rshared`, `rslave`, `rprivate` |
| `bind-recursive` | -- | `enabled`, `disabled`, `writable`, `readonly` |

**Supported Docker `--mount` parameters (volume mounts):**

| Parameter | Aliases | Values |
|-----------|---------|--------|
| `type` | -- | `volume` |
| `source` | `src` | Volume name |
| `target` | `destination`, `dst` | Container path |
| `readonly` | `ro` | Flag (no value needed) |
| `volume-driver` | -- | Driver name (e.g., `local`, `nfs`) |
| `volume-opt` | -- | Key-value driver options |
| `volume-nocopy` | -- | Flag (prevents auto-copy to empty volume) |
| `volume-subpath` | -- | Mount a subdirectory within the volume |

### How the CLI Parses Mounts

From `src/spec-configuration/containerFeaturesConfiguration.ts`:

```typescript
const normalizedMountKeys: Record<string, string> = {
  src: 'source',
  destination: 'target',
  dst: 'target',
};

export function parseMount(str: string): Mount {
  return str.split(',')
    .map(s => s.split('='))
    .reduce((acc, [key, value]) => ({
      ...acc,
      [(normalizedMountKeys[key] || key)]: value
    }), {}) as Mount;
}
```

Key observations:
- The parser normalizes `src` to `source` and `dst`/`destination` to `target`.
- **All other key=value pairs are preserved as-is** in the parsed object via the spread operator, even though they are not in the Mount interface. The `as Mount` cast discards TypeScript awareness of extra properties.
- Flag-only parameters like `readonly` parse as `{ readonly: undefined }` since there is no `=` separator.

From `src/spec-node/dockerfileUtils.ts`, the reverse direction:

```typescript
export function generateMountCommand(mount: Mount | string): string[] {
  if (typeof mount === 'string') {
    return ['--mount', mount];
  }
  const type = `type=${mount.type},`;
  const source = mount.source ? `src=${mount.source},` : '';
  const destination = `dst=${mount.target}`;
  return ['--mount', `${type}${source}${destination}`];
}
```

**String mounts pass through verbatim.** Object mounts are serialized with only `type`, `source`, and `target` -- any extra properties (even if the parser preserved them) are dropped during serialization.

### The `consistency` Gap

The CLI defines a `BindMountConsistency` type in `src/spec-node/utils.ts`:

```typescript
export type BindMountConsistency = 'consistent' | 'cached' | 'delegated' | undefined;
```

And uses it when generating workspace mounts:

```typescript
const cons = cliHost.platform !== 'linux'
  ? `,consistency=${consistency || 'consistent'}`
  : '';
workspaceMount = `type=bind,...${cons}`;
```

This means the CLI itself generates mounts with `consistency` on macOS/Windows, but the Mount JSON schema does not support this field. This is an internal-only feature of the workspace mount, not exposed to user-defined object mounts.

### Feature Mounts: Object Only

In `devcontainer-feature.json`, the `mounts` array only accepts objects:

```json
{
  "mounts": {
    "type": "array",
    "items": { "$ref": "#/definitions/Mount" }
  }
}
```

No `anyOf` with string -- features cannot use string-format mounts. This is a deliberate constraint to keep feature metadata machine-parseable.

### `workspaceMount`: String Only

The `workspaceMount` property is a standalone string (not an array, not an object):

```json
{
  "workspaceMount": {
    "type": "string",
    "description": "The --mount parameter for docker run."
  }
}
```

Example: `"source=${localWorkspaceFolder}/sub-folder,target=/workspace,type=bind,consistency=cached"`

### Practical Recommendation for Mounts

| Situation | Recommended Format |
|-----------|--------------------|
| Simple bind or volume mount | Object (validated, type-safe) |
| Need `readonly`, `consistency`, or `bind-propagation` | String (schema does not support these in object form) |
| Feature `devcontainer-feature.json` | Object (only option) |
| Programmatic generation in lace | String (matches current `generateMountSpec` output, supports `readonly`) |

## 2. Lifecycle Commands

All six lifecycle commands share the same schema: `string | string[] | object`.

### JSON Schema

```json
{
  "type": ["string", "array", "object"],
  "items": { "type": "string" },
  "additionalProperties": {
    "type": ["string", "array"],
    "items": { "type": "string" }
  }
}
```

### Three Formats and Their Semantics

**String format** -- executed via `/bin/sh`:

```json
"postCreateCommand": "npm install && npm run build"
```

Shell features like `&&`, `||`, pipes, and variable expansion are available.

**Array format** -- direct execution without shell:

```json
"postCreateCommand": ["npm", "install"]
```

Arguments are passed literally. No shell expansion, no `&&` chaining. This is a single command only.

**Object format** -- parallel execution of named tasks:

```json
"postCreateCommand": {
  "install": "npm install",
  "build": ["npm", "run", "build"],
  "setup": "chmod +x scripts/setup.sh && ./scripts/setup.sh"
}
```

Each key is a task name (for logging/display). Values can be string (shell) or array (no shell). All tasks run in parallel.

### Execution Order

1. `initializeCommand` -- runs on the **host machine**, not in the container
2. `onCreateCommand` -- first container-side step
3. `updateContentCommand` -- re-runs when workspace content changes
4. `postCreateCommand` -- main user setup step
5. `postStartCommand` -- runs on every container start
6. `postAttachCommand` -- runs on every tool/editor attach

The `waitFor` property (enum: `initializeCommand`, `onCreateCommand`, `updateContentCommand`, `postCreateCommand`, `postStartCommand`, `postAttachCommand`) controls which step must complete before the tool connects. Default: `updateContentCommand`.

### Gotchas

- `initializeCommand` runs on the host. A command that assumes container paths will fail silently or with confusing errors.
- Array format is a **single command**, not multiple commands. `["npm", "install", "&&", "npm", "run", "build"]` passes `&&` as a literal argument to npm.
- Object format runs tasks in parallel with no ordering guarantees. Tasks that depend on each other must be combined into a single task string.
- Features can define lifecycle commands (`onCreateCommand` through `postAttachCommand` but not `initializeCommand`). These merge with the devcontainer.json commands via the object/parallel execution model.

## 3. Port Forwarding

### `forwardPorts` Array Items

```json
{
  "type": "array",
  "items": {
    "oneOf": [
      { "type": "integer", "minimum": 0, "maximum": 65535 },
      { "type": "string", "pattern": "^([a-z0-9-]+):(\\d{1,5})$" }
    ]
  }
}
```

**Integer format:** Simple port number, forwarded from container to host on the same port.

```json
"forwardPorts": [3000, 5432]
```

**String format:** `"host:port"` for service-specific forwarding (e.g., from a linked container or Docker Compose service).

```json
"forwardPorts": ["db:5432", "redis:6379"]
```

The string pattern requires lowercase alphanumeric host names with hyphens. The port portion is 1-5 digits (no explicit 0-65535 range validation in the regex).

### `portsAttributes` Object

Keys are port numbers, ranges, or regex patterns. Values are attribute objects.

```json
{
  "patternProperties": {
    "(^\\d+(-\\d+)?$)|(.+)": {
      "type": "object",
      "properties": {
        "onAutoForward": {
          "enum": ["notify", "openBrowser", "openBrowserOnce",
                   "openPreview", "silent", "ignore"],
          "default": "notify"
        },
        "elevateIfNeeded": { "type": "boolean", "default": false },
        "label": { "type": "string", "default": "Application" },
        "requireLocalPort": { "type": "boolean", "default": false },
        "protocol": { "enum": ["http", "https"] }
      }
    }
  },
  "additionalProperties": false
}
```

**Key pattern types:**

| Pattern | Example | Matches |
|---------|---------|---------|
| Single port | `"3000"` | Port 3000 |
| Port range | `"40000-55000"` | Ports 40000 through 55000 |
| Regex | `".+\\/server.js"` | Ports whose process command matches |

### `otherPortsAttributes` Object

Same fields as `portsAttributes` values, but `openBrowserOnce` is absent from the `onAutoForward` enum (since "first time" semantics do not apply to a catch-all default).

### `appPort` (Legacy)

```json
{
  "type": ["integer", "string", "array"],
  "items": { "type": ["integer", "string"] }
}
```

Accepts the widest format variety of any devcontainer property: a single integer, a single string, or an array of integers and/or strings. String values pass through to Docker's `-p` flag and support Docker port mapping syntax like `"8000:8010"`. The spec recommends `forwardPorts` over `appPort` for most use cases.

## 4. Environment Variables

### `containerEnv`

```json
{
  "type": "object",
  "additionalProperties": { "type": "string" }
}
```

Set on the Docker container itself. All processes see these variables. Static for the container's lifetime -- changes require a rebuild. Supports variable substitution (`${localEnv:VAR}`, `${localWorkspaceFolder}`, etc.).

### `remoteEnv`

```json
{
  "type": "object",
  "additionalProperties": { "type": ["string", "null"] }
}
```

Set on tool-spawned processes (terminals, tasks, debug sessions), not on the container globally. Can be updated without a rebuild. The key difference: **values can be `null`** to explicitly unset an inherited variable.

```json
"remoteEnv": {
  "API_KEY": "${localEnv:API_KEY}",
  "DEBUG": null
}
```

### Variable Substitution (All String Properties)

| Variable | Available In | Description |
|----------|-------------|-------------|
| `${localEnv:NAME}` | Any property | Host environment variable |
| `${containerEnv:NAME}` | `remoteEnv` only | Container environment variable |
| `${localWorkspaceFolder}` | Any property | Host workspace path |
| `${containerWorkspaceFolder}` | Any property | Container workspace path |
| `${localWorkspaceFolderBasename}` | Any property | Host workspace folder name |
| `${containerWorkspaceFolderBasename}` | Any property | Container workspace folder name |
| `${devcontainerId}` | Any property | Unique stable container ID |

Default values: `${localEnv:NAME:default}` -- the default is used when the variable is unset or empty.

## 5. Build Configuration

### `build` Object

```json
{
  "properties": {
    "dockerfile": { "type": "string" },
    "context": { "type": "string" },
    "target": { "type": "string" },
    "args": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "cacheFrom": {
      "type": ["string", "array"],
      "items": { "type": "string" }
    },
    "options": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

`cacheFrom` is a dual-format property: accepts a single string or array of strings. All other build fields are single-format.

### `dockerComposeFile`

```json
{
  "type": ["string", "array"],
  "items": { "type": "string" }
}
```

String or array of strings. When multiple files are specified, later files override earlier ones (standard Docker Compose merge behavior).

## 6. `hostRequirements.gpu` (Boolean/String/Object)

The most complex multi-format property in the specification.

```json
{
  "oneOf": [
    {
      "type": ["boolean", "string"],
      "enum": [true, false, "optional"]
    },
    {
      "type": "object",
      "properties": {
        "cores": { "type": "integer", "minimum": 1 },
        "memory": {
          "type": "string",
          "pattern": "^\\d+([tgmk]b)?$"
        }
      },
      "additionalProperties": false
    }
  ]
}
```

**Three levels of specificity:**

| Format | Example | Meaning |
|--------|---------|---------|
| `true` / `false` | `"gpu": true` | GPU required / not required |
| `"optional"` | `"gpu": "optional"` | GPU used if available, not required |
| Object | `"gpu": {"cores": 2, "memory": "8gb"}` | Specific GPU requirements |

## 7. Feature Options

Feature options are not dual-format in the devcontainer.json sense, but they use `anyOf` for the option definition schema:

```json
{
  "anyOf": [
    { "type": "object", "properties": { "type": { "const": "boolean" }, "default": { "type": "boolean" } }, "required": ["type", "default"] },
    { "type": "object", "properties": { "type": { "const": "string" }, "enum": [...], "default": { "type": "string" } }, "required": ["type", "enum", "default"] },
    { "type": "object", "properties": { "type": { "const": "string" }, "proposals": [...], "default": { "type": "string" } }, "required": ["type", "default"] }
  ]
}
```

Three option shapes: boolean, string with strict enum, or string with soft proposals (user can provide values outside the list).

## Complete Dual-Format Property Summary

| Property | String | Array | Object | Integer | Boolean | Notes |
|----------|--------|-------|--------|---------|---------|-------|
| `mounts[]` | Yes | -- | Yes | -- | -- | String supports more options than object |
| `workspaceMount` | Yes | -- | -- | -- | -- | String only |
| `initializeCommand` | Yes | Yes | Yes | -- | -- | 3 execution modes |
| `onCreateCommand` | Yes | Yes | Yes | -- | -- | 3 execution modes |
| `updateContentCommand` | Yes | Yes | Yes | -- | -- | 3 execution modes |
| `postCreateCommand` | Yes | Yes | Yes | -- | -- | 3 execution modes |
| `postStartCommand` | Yes | Yes | Yes | -- | -- | 3 execution modes |
| `postAttachCommand` | Yes | Yes | Yes | -- | -- | 3 execution modes |
| `forwardPorts[]` | Yes | -- | -- | Yes | -- | String for host:port pairs |
| `appPort` | Yes | Yes | -- | Yes | -- | Legacy; prefer forwardPorts |
| `dockerComposeFile` | Yes | Yes | -- | -- | -- | Array for compose file merging |
| `build.cacheFrom` | Yes | Yes | -- | -- | -- | String or array of strings |
| `hostRequirements.gpu` | Yes | -- | Yes | -- | Yes | Most complex multi-format |
| `remoteEnv` values | Yes | -- | -- | -- | -- | Plus `null` to unset |

## Validation Differences Between Formats

### Mounts: Schema vs. Reality

The JSON schema (`devContainer.base.schema.json`) strictly validates object mounts:
- Only `type`, `source`, `target` are allowed.
- `additionalProperties: false` rejects anything else.
- A mount like `{"type": "bind", "source": "/foo", "target": "/bar", "readonly": true}` **fails schema validation**.

String mounts have no schema-level validation beyond being a string. The string is passed through to Docker, which performs its own validation at container creation time. This means:
- `"type=bind,source=/foo,target=/bar,readonly,consistency=cached"` passes schema validation.
- Docker validates the string at runtime.
- Invalid Docker mount strings (e.g., `"type=invalid,target=/bar"`) pass schema validation but fail at `docker run` time.

### Lifecycle Commands: Deterministic Behavior Selection

The type of value directly selects execution behavior:
- String: shell execution (predictable but subject to shell parsing)
- Array: direct execution (no shell surprises, but no shell features)
- Object: parallel execution (non-deterministic ordering)

There is no schema-level validation that object task values are valid commands. Validation happens at execution time.

### Port Forwarding: Regex Pattern Validation

The `forwardPorts` string pattern `^([a-z0-9-]+):(\d{1,5})$` enforces:
- Lowercase hostname with alphanumeric characters and hyphens only.
- Colon separator.
- 1-5 digit port number.

The integer format enforces 0-65535 range. The string pattern does not enforce this range (port `99999` would pass the regex).

## Recommendations

1. **Continue generating string-format mounts in lace.** The current `generateMountSpec` function in `packages/lace/src/lib/mounts.ts` produces string-format mounts (`type=bind,source=...,target=...,readonly`). This is correct -- the `readonly` flag is not supported in object format. Switching to object format would lose this capability.

2. **Consider adding `consistency` support to `generateMountSpec`.** The devcontainer CLI adds `consistency=consistent` on non-Linux platforms. Lace could optionally include this for macOS/Windows users, though it is unnecessary on Linux.

3. **Use object format for mounts in feature definitions.** Feature `devcontainer-feature.json` only supports object mounts. If lace ever generates feature metadata, it must use the object format and accept the limitation of no `readonly` or `consistency` fields.

4. **Prefer object format for lifecycle commands when parallelism is needed.** The object format is the cleanest way to express named parallel tasks. For sequential commands, the string format with `&&` chaining is most readable.

5. **Be aware of the schema vs. runtime validation gap for mounts.** Tools that validate devcontainer.json against the JSON schema (VS Code, IDE extensions, CI linters) will flag object mounts with extra properties. String mounts bypass this validation entirely. This asymmetry is by design but can be surprising.
