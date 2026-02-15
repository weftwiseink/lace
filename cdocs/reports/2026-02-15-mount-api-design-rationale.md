---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T12:00:00-08:00
task_list: lace/template-variables
type: report
state: live
status: done
tags: [mount-resolver, api-design, architecture, template-variables]
related_to:
  - cdocs/proposals/2026-02-15-mount-accessor-api.md
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/devlogs/2026-02-15-mount-api-evolution.md
---

# Mount API Design Rationale

> BLUF: This report captures the design reasoning behind evolving the mount template API from `${lace.mount.source()}` / `${lace.mount.target()}` (v1) to `${lace.mount(ns/label)}` with `.source` and `.target` property accessors (v2). The central insight is that mounts are _objects_ (source + target + flags), not pairs of independent paths. A single entrypoint that resolves to a complete mount spec better models this, while accessor forms let callers reach individual fields when needed. The companion proposal (`cdocs/proposals/2026-02-15-mount-accessor-api.md`) contains the implementation specification.

## Context / Background

The v1 mount template system was implemented on the `mountvars` branch (6 phases, 555 tests, not yet merged to main). It introduced `${lace.mount.source(ns/label)}` and `${lace.mount.target(ns/label)}` as two independent template functions: one resolves host paths, the other resolves container paths. Review of the implementation surfaced several concerns:

1. **Three entrypoints**: `mount.source`, `mount.target`, and (conceptually) the full mount spec are three separate things to learn. The port system has one: `${lace.port(feat/opt)}`.
2. **Split mount construction**: The devcontainer config combines lace-resolved source paths with manually-authored target/type/readonly strings. The mount _definition_ is split across two concerns in one string.
3. **No namespace validation**: The v1 `project/` namespace is a convention, not enforced. Arbitrary namespaces pass validation.
4. **No guided configuration**: Unconfigured mounts silently use empty default directories with no guidance to the user.

## Key Findings

### The Port System Analogy

The port system provides the clearest structural model for mount templates. Both solve the same problem: a devcontainer config needs a value (port number / host path) that varies per user and should not be hardcoded.

| Aspect | Ports | Mounts (v1) | Mounts (v2) |
|--------|-------|-------------|-------------|
| Entrypoints | 1 (`lace.port()`) | 2 (`mount.source`, `mount.target`) | 1 (`lace.mount()`) + accessors |
| Resolves to | A number | A path | A complete mount spec |
| Container-side config | In feature metadata | In mount string (manual) | In declaration metadata |
| User-side config | Auto-allocated | Settings or default | Settings or default |
| Validation | Feature ID + option exists | Label format only | Namespace + declaration + target conflicts |
| Auto-injection | Yes (from metadata) | Yes (v1 adds `source=` strings) | Yes (adds `${lace.mount()}` entries) |

The key property of the port system: the devcontainer config says "I need a port for X" and lace fills in the number. The config never knows the host port. The v2 mount API achieves the same: the config says "I need mount X" and lace produces the entire mount spec.

### Where the Analogy Breaks Down

Ports resolve to a single scalar value. Mounts resolve to a compound value (source + target + type + flags). This creates a tension: sometimes callers need the whole thing, sometimes just one field.

The accessor syntax resolves this: `${lace.mount(label)}` is the "whole thing" (like `${lace.port(label)}`), while `.source` and `.target` are projections for the cases that need individual fields (environment variables, lifecycle commands, cross-feature references).

### Accessor Syntax vs. Separate Entrypoints

**v1 approach (separate entrypoints)**:
```
${lace.mount.source(ns/label)}  — host path
${lace.mount.target(ns/label)}  — container path
```

**v2 approach (single entrypoint + accessors)**:
```
${lace.mount(ns/label)}         — full mount spec
${lace.mount(ns/label).source}  — host path
${lace.mount(ns/label).target}  — container path
```

The v2 approach is better because:
1. **One concept, not three**: "a mount" is the primitive, with properties you can access. This mirrors how developers think about mounts.
2. **The bare form is the common case**: Most mount references are in the `mounts` array, where the full spec is exactly what's needed. Accessors are the uncommon case.
3. **Regex simplicity**: The `LACE_UNKNOWN_PATTERN` guard needs only `mount\(` as a negative lookahead, covering all three forms. v1 required separate lookaheads for `mount\.source\(` and `mount\.target\(`.
4. **Self-documenting migration**: The old `${lace.mount.source()}` syntax becomes unknown-pattern-rejected, making stale v1 references fail loudly.

### `recommendedSource` as Guidance, Not Default

Mount declarations include a `recommendedSource` field (e.g., `"~/.claude"`) that appears in configuration guidance messages. This is explicitly NOT used as a default source path.

The rationale: **features should not dictate which host directories get mounted**. The actual source is always either:
- A user-configured override in `settings.json` (explicit consent)
- A lace-managed default directory under `~/.config/lace/<project>/mounts/` (empty, safe)

If `recommendedSource` were used as a default, a feature could cause `~/.claude` (or any directory) to be mounted into a container without the user's knowledge. By making it guidance-only, the user must explicitly opt in via settings.

This design enables the configuration UX to be helpful ("configure source to ~/.claude") without being presumptuous ("I've mounted your ~/.claude directory for you").

### Feature Opacity Prevention

The consent model: features declare mount _needs_ (a target path in the container), not mount _sources_ (host directories). The source is always user-controlled. This prevents:

- A feature silently mounting `~/.ssh` into a container
- A feature reading arbitrary host directories without user knowledge
- Opaque mount behavior that varies between machines

The user sees every host-side mount binding in `settings.json` and can audit exactly what's exposed to each project's containers.

### `project/` as Reserved Namespace

Alternatives considered:
1. **Bare labels** (`bash-history` without namespace): risk collision with feature shortIds; ambiguous whether it's a feature mount or project mount.
2. **Project name as namespace** (`lace/bash-history`): conflates project identity with namespace semantics; different projects with the same name would collide.
3. **No project-level mounts** (require features for everything): architecturally clean but overengineered for simple persistence like bash history.

`project/` is unambiguous, self-documenting, and consistent with the port system's namespace convention.

### String-Format Output

The devcontainer Mount JSON schema uses `additionalProperties: false` with only `{type, source, target}` as valid keys. Mounts with `readonly` cannot be expressed as JSON objects — they require string format. Since lace controls the resolved output, it always produces well-formed string-format mount specs. This avoids the need for a `DevcontainerMount` type (the structured output proposal for which was rejected).

## Recommendations

1. The v2 accessor API should be implemented on the existing `mountvars` branch, reworking the v1 implementation in-place. No backwards compatibility needed (pre-merge).
2. Mount validation (namespace, target conflicts) should fail hard — these are config errors that would cause subtle runtime failures if allowed through.
3. Guided configuration should be informational (console output during `lace up`), not blocking. New users should be able to `lace up` without configuring settings.json first.
4. Prebuild feature mount declarations are auto-injected identically to regular feature mounts. Unlike ports — where prebuild features require asymmetric `appPort` injection because the port value is baked at build time — mounts are runtime config (`docker run` flags) with no build/runtime lifecycle distinction.
