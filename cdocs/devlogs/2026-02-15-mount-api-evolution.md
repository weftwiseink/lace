---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-15T09:00:00-08:00
task_list: lace/template-variables
type: devlog
state: live
status: wip
tags: [mount-resolver, template-variables, api-design, architecture]
related_to:
  - cdocs/proposals/2026-02-14-mount-template-variables.md
  - cdocs/devlogs/2026-02-14-mount-template-variables-implementation.md
---

# Mount API Evolution Analysis

## Objective

Evaluate the current mount template variable implementation (`${lace.mount.source()}` / `${lace.mount.target()}`) against a proposed API evolution (`${lace.mount(ns/label)}`) that would:
- Unify the two-accessor pattern into a single template variable
- Tie namespaces to feature IDs (validated against metadata)
- Decouple user-level mount routing from devcontainer config
- Enable richer validation (target conflicts, missing settings, guided config)

This devlog captures the user's design intuition, analyzes tradeoffs, and frames decisions for the next proposal iteration.

## Present State

### What shipped on `mountvars` (not yet merged to main)

6 phases implemented, 555 tests passing (+45 over baseline), 8 commits:

| Component | Status | Key Artifacts |
|-----------|--------|---------------|
| `MountPathResolver` | Complete | `mount-resolver.ts`, 17 unit tests |
| `${lace.mount.source()}` in template-resolver | Complete | Pattern, resolution, UNKNOWN guard relaxation |
| Pipeline wiring in `up.ts` | Complete | Settings load, resolver creation, save, reporting |
| Feature mount declarations | Complete | `LaceMountDeclaration`, `autoInjectMountTemplates()` |
| `${lace.mount.target()}` | Complete | Pattern, `buildMountTargetMap()`, target resolution |
| Lace devcontainer migration | Complete | mounts[0] and mounts[1] use templates |

### Verification gaps identified

1. **No `mount-assignments.json` in real `.lace/` directory** -- `lace up` was never run against the real devcontainer on this branch. The integration tests exercise the full pipeline against synthetic configs, but the dogfood scenario was not verified. A verification agent is running now.

2. **`lace.mount.target()` has no integration test** through the full `runUp()` pipeline. Unit tests pass a pre-built `mountTargetMap` directly. No test exercises: feature metadata parsed -> mount templates auto-injected -> source resolved -> target map built -> target templates resolved.

3. **Test directory leaks** -- hundreds of `lace-test-resolve-mounts-*` dirs under `~/.config/lace/` from test runs that didn't clean up properly.

## User's API Evolution Idea

The user's thinking, paraphrased and elaborated:

> The namespace isn't supposed to be arbitrary -- it should be the trailing name of a feature, validated against the feature spec. Similar to ports, where initially we thought we needed to specify both container and host-side settings, but really the devcontainer itself has no business knowing about the user-side config.
>
> Rework the API to just be `${lace.mount(namespace/var)}` with `.source` and `.target` as accessor methods on the resolved mount. Project-level config can specify unnamespaced mount targets.
>
> Example: user writes `${lace.mount(claude-shared/home)}` in the mount def. Lace validates the user-level setting has something configured for this project, and suggests they configure it to `~/.claude`.
>
> This also enables validation: mount targets can't be shared between features, namespaces must resolve to real features, etc.
>
> The intuition: moving more config into feature metadata for composition/validation, and decoupling user-level mount routing from devcontainer config. But it may be too ambitious.

## Analysis

### The Port System Analogy (and Where It Breaks Down)

The port system provides the clearest model for what the user is imagining:

| Aspect | Ports (current) | Mounts (current) | Mounts (proposed) |
|--------|----------------|-------------------|-------------------|
| Template syntax | `${lace.port(feat/opt)}` | `${lace.mount.source(ns/label)}` | `${lace.mount(feat/name)}` |
| Resolves to | A number (host port) | A host path (source) | A complete mount spec |
| Container-side config | In feature metadata | Hardcoded in mount string target | In feature metadata |
| User-side config | Auto-allocated | Settings override or auto-derived | **Required** in settings |
| Validation | Feature ID exists, option exists | Label format only | Feature ID, mount name, target conflicts |
| Namespace meaning | Feature short ID | Arbitrary (convention: `project/`) | Feature short ID (enforced) |

The port system's key property: **the devcontainer config never knows the host port**. It says "I need a port for wezterm-server/hostSshPort" and lace fills it in. The feature metadata declares the need; the allocator satisfies it.

Current mount system partially achieves this for the source path, but the devcontainer still specifies the container target directly in the mount string: `source=${lace.mount.source(project/bash-history)},target=/commandhistory,type=bind`. The mount _definition_ is split across two concerns in one string.

The proposed `${lace.mount(feat/name)}` would make the devcontainer config say: "I need the claude-shared/home mount here" and lace would produce the entire `source=X,target=Y,type=bind` string from metadata + settings.

### Two Distinct Use Cases

The mount system serves two different populations:

**Feature-declared mounts** (e.g., a claude-code feature needing `~/.claude` mounted):
- Feature metadata declares `{ target: "/home/node/.claude", description: "..." }`
- The feature knows the container side; the user knows the host side
- Namespace = feature ID (naturally)
- This is the strong case for the proposed API

**Project-level mounts** (e.g., bash history persistence):
- No feature metadata exists -- this is a project-specific concern
- Both source and target are specified by the devcontainer author
- No natural feature ID namespace
- The proposed API needs a special handling for this

The current implementation uses `project/` as a reserved namespace for the second case. The proposed evolution would need to either:
- Keep `project/` as a special namespace (validated differently from feature namespaces)
- Allow "unnamespaced" labels for project-level mounts
- Require project-level mounts to be declared in some project-level metadata

### Pros of the Proposed API

**1. Stronger validation**

The current system validates only label format (`namespace/label` with allowed chars). The proposed system could validate:
- Namespace must be a known feature ID (or `project`)
- Mount name must exist in that feature's `customizations.lace.mounts`
- No two features declare the same container target path
- User has configured a source path in settings (or accepted the default)

This catches misconfigurations at `lace up` time rather than at container runtime.

**2. Cleaner separation of concerns**

Current: devcontainer.json contains `source=${lace.mount.source(...)},target=/commandhistory,type=bind` -- the user still writes the target and type in the mount string.

Proposed: devcontainer.json contains `${lace.mount(feat/name)}` -- lace produces the entire mount spec. The devcontainer config becomes purely declarative ("I need this mount") rather than a hybrid of declarative intent and literal mount syntax.

**3. Guided configuration**

When a feature declares a mount and the user hasn't configured a source, lace can:
- Report which mounts need configuration
- Suggest sensible defaults (e.g., "configure claude-shared/home to ~/.claude")
- Fail with actionable error messages rather than silently using empty default dirs

This is a significant UX improvement over the current system where an unconfigured mount silently creates an empty directory under `~/.config/lace/<project>/mounts/...`.

**4. Target conflict detection**

With mount declarations centralized in feature metadata, lace can detect when two features declare the same container target path -- a conflict that would cause Docker to fail or produce unexpected behavior.

**5. Consistency with port system mental model**

A single template function (`${lace.mount()}` like `${lace.port()}`) is simpler to learn. The current `mount.source` / `mount.target` split leaks implementation details (the two sides of a bind mount) into the template API.

### Cons and Complications

**1. The `.target` accessor problem**

Even with `${lace.mount(feat/name)}` expanding to a full mount string in the `mounts` array, other places in the config need to reference the container-side path:

```jsonc
// containerEnv -- needs just the target path
"CLAUDE_CONFIG_DIR": "${lace.mount.target(claude-code/config)}"

// lifecycle commands -- needs just the target path
"postCreateCommand": "mkdir -p ${lace.mount.target(claude-code/config)}/extensions"
```

So `${lace.mount.target()}` (or an equivalent accessor) cannot be eliminated. The API becomes:
- `${lace.mount(feat/name)}` in mounts array -> full mount spec
- `${lace.mount.target(feat/name)}` elsewhere -> just the container path

This is arguably _more_ complex than the current system, not less. You now have a template that means different things depending on where it appears (full spec vs. just a path). Or you need two templates anyway.

> NOTE: One resolution: `${lace.mount(feat/name)}` always produces the full mount spec, and is only valid in the `mounts` array. For the target-path use case, features should use the literal path in their own metadata (they declared it), or a separate `${lace.mount.target()}` accessor is retained. This makes `.target` a read-accessor for cross-feature references, not a general-purpose template.

**2. Project-level mounts become second-class**

If namespace must be a feature ID, project-level mounts don't fit naturally. Options:
- **`project/` special namespace**: Works but is a special case in the validation logic. Can't be validated against feature metadata.
- **Project-level mount metadata**: Declare project mounts in `customizations.lace.mounts` in the devcontainer.json itself (not in a feature). This would be new infrastructure.
- **Require features for all mounts**: Push bash-history and claude-config into features. This is architecturally clean but means every project mount becomes a feature, which may be overengineered.

The current implementation handles both cases uniformly -- `project/bash-history` and `claude-code/config` go through the same resolution path. The proposed API needs to decide how to handle the project case.

**3. Mandatory settings configuration**

Current system: unconfigured mounts silently use a default directory. This is convenient for new contributors who just want to `lace up` and go.

Proposed system: if lace validates that user settings exist, it either:
- Fails when settings are missing (poor first-run experience)
- Falls back to defaults when settings are missing (then what's the point of validation?)
- Warns but proceeds (current behavior with extra noise)

The port system sidesteps this because port _allocation_ is automatic -- there's no "host-side configuration" to validate. Mount routing inherently requires host-specific knowledge (where is your data on disk?), which is fundamentally user-configured.

**4. API surface change before shipping**

The implementation is on `mountvars` branch, not merged to main. This is the right time to change the API -- there's no backwards compatibility to maintain. But it does mean reworking 45+ tests and 6 phases of implementation.

**5. Scope creep risk**

The user flagged this themselves: "it may be too ambitious." The current implementation solves the immediate problem (hardcoded paths) with a clean, tested solution. The proposed evolution adds:
- Namespace validation against feature metadata
- Mount target conflict detection
- Guided configuration flow
- Full mount spec generation
- Project-level mount handling

Each of these is individually reasonable but collectively they represent a significant expansion in scope.

### A Middle Path?

Rather than a full API rework, consider incremental evolution that gets the key wins without the full rewrite:

**Keep `${lace.mount.source()}` and `${lace.mount.target()}`** but add:

1. **Namespace validation**: when the namespace isn't `project`, validate it matches a feature ID in the config. This is a ~20-line addition to `resolveStringValue()`.

2. **Mount name validation**: when the namespace is a feature ID, validate the mount name exists in that feature's `customizations.lace.mounts`. This reuses the existing `metadataMap`.

3. **Target conflict detection**: add a `validateMountTargets()` function that checks the `mountTargetMap` for duplicate container paths. Call it during `runUp()`.

4. **Better defaults/guidance**: when mount.source resolves to a default path, log a message suggesting the user configure it in settings.json if they have existing data.

This gets 80% of the validation/safety wins without changing the template syntax. The existing 555 tests continue to pass. The API evolution to `${lace.mount()}` can happen in a v2 if the simpler syntax proves valuable.

### Full Evolution: What It Would Look Like

If we do go with `${lace.mount(ns/name)}`:

**Template behavior by context:**
- In `mounts` array: expands to `source=<resolved>,target=<from-metadata>,type=bind[,readonly]`
- In `containerEnv`, lifecycle commands, settings: ERROR -- use `${lace.mount.target(ns/name)}` instead
- `${lace.mount.target(ns/name)}`: works everywhere, resolves to just the container path

**Project-level mounts:**
- `project/` namespace with declarations in a new `customizations.lace.projectMounts` section of devcontainer.json
- Or: project-level mounts use the old `${lace.mount.source()}` syntax and only feature mounts use the new `${lace.mount()}`

**Settings requirement:**
- Feature-declared mounts with no settings override use lace-managed defaults (preserving zero-config first run)
- `lace status` shows unconfigured mounts and suggests settings entries
- No hard failure for missing settings (that would break the "clone and go" story)

**Validation additions:**
- Feature namespace must exist in the config's features
- Mount name must exist in that feature's metadata
- No duplicate container target paths across features
- Settings source paths must exist on disk (already implemented for overrides)

## Recommendation

The middle path is the pragmatic choice for landing `mountvars`:

1. **Ship the current API** (`mount.source` / `mount.target`) with the existing implementation
2. **Add namespace + mount name validation** against feature metadata (small scope)
3. **Add target conflict detection** (small scope)
4. **Add guided messaging** for unconfigured default mounts (small scope)
5. **Open an RFP** for the `${lace.mount()}` unified API as a future evolution

The full API rework has real merit -- the user's intuition about decoupling user-level routing from devcontainer config is sound. But the current implementation already solves the motivating problem, and the rework touches everything (template patterns, resolution logic, test suite, pipeline wiring, devcontainer migration). Doing it well requires a clean proposal with its own review cycle.

The key question for the user: **Is the current `mount.source`/`mount.target` API acceptable for the initial merge, with the unified `mount()` API as a fast-follow?** Or does the API surface need to be right from the start, since changing it after merge requires migration support?

## Verification Results

Both follow-up agents completed successfully:

1. **Cleanup**: 249 leaked `lace-test-resolve-mounts-*` dirs removed from `~/.config/lace/`.
2. **Dogfood verification**: `lace up` ran against the real lace devcontainer. All mount templates resolved correctly. `.lace/mount-assignments.json` created. Default dirs auto-created. Port pipeline unaffected.

## Design Decisions (User Direction, Verbatim)

### Accessor Syntax: `${lace.mount(ns/label).target}` not `${lace.mount.target(ns/label)}`

> I was thinking `lace.mount(var).target` would be better than having 3 different template "entrypoints." Would that address your concerns?

**Decision**: Single entrypoint with property accessors:
- `${lace.mount(ns/label)}` — full mount spec
- `${lace.mount(ns/label).source}` — just the host path
- `${lace.mount(ns/label).target}` — just the container path

This addresses the three-entrypoint concern completely. One conceptual "thing" with property access.

### Project-Level Mount Declarations in Devcontainer Customizations

> Yes in the devcontainer customizations is what I'm thinking. And maybe, lace mounts specify a target and can also have a recommendedSource, because the source ends up in user-level config unless hard coded into the devcontainer config. That way a feature can't opaquely mount a random folder without user consent/config

**Decision**: Both features and the devcontainer itself declare mounts in `customizations.lace.mounts`. Mount declarations include:
- `target` (required) — container path
- `recommendedSource` (optional) — suggested host path, surfaced to user during config guidance
- The actual source is always user-configured in `~/.config/lace/settings.json`, never baked into the devcontainer config
- A feature cannot opaquely mount a host directory without the user having configured (or accepted default for) that mount in settings

### Auto-Injection Model (Like Ports)

> You're right — we can do it similar to ports, where we supply the configured mount as a default unless a mount declaration references the var, overriding the default. So the feature and devcontainer can specify other docker mount fields like type, and we'll include that in the prompt about configuring ~/.lace/settings.json

**Decision**: Mount auto-injection follows the port auto-injection pattern:
- Declared mounts are auto-injected into the mounts array as defaults
- If the devcontainer.json explicitly references `${lace.mount(ns/label)}` in a mount entry, that overrides the auto-injected default (user controls placement/ordering)
- Mount declarations can include other Docker mount fields (type, readonly, consistency) which are preserved in the generated mount spec
- Guided configuration messages reference these fields when prompting the user to configure `~/.config/lace/settings.json`

### `project/` Reserved Namespace

> Yes I've come around to the project special case.

**Decision**: `project/` is a reserved namespace for project-level mounts. These are declared in the devcontainer's own `customizations.lace.mounts` section (not in feature metadata). Validation: namespace must be either `project` or a known feature ID in the config.

### Rapid Iteration Over Safe Shipping

> IMO we're still in the rapid iteration phase so I'd rather invest another round of work than put something off IFF we become convinced it's better. So right now it's all about "what is best"

**Decision**: The current `mount.source`/`mount.target` API on `mountvars` will be reworked to the unified `${lace.mount()}` API before merging. No need for migration support — this is pre-merge iteration.

## Proposal Outline

Plan for writing the `/propose` proposal that evolves the existing `cdocs/proposals/2026-02-14-mount-template-variables.md`:

### 1. BLUF + Objective

- Summarize the evolved API: `${lace.mount(ns/label)}` with `.source` and `.target` accessors
- Motivating problem unchanged: hardcoded host paths, non-portable devcontainer configs
- Key evolution: mount declarations are metadata (in features and devcontainer customizations), host-side routing is user config (settings.json), lace composes them

### 2. Background

- Reference the v1 implementation on `mountvars` (what we learned, what worked, what needs to change)
- Port system as structural model (auto-injection, metadata declarations, template resolution)
- Accessor syntax rationale (single entrypoint vs. multiple template functions)

### 3. Proposed Solution: API Design

- Template syntax: `${lace.mount(ns/label)}`, `.source`, `.target` accessor forms
- Regex patterns for all three forms (match order: most specific first)
- Resolution semantics for each form:
  - Bare: produces full mount spec string `source=X,target=Y,type=bind[,readonly]`
  - `.source`: produces just the resolved host path
  - `.target`: produces just the container target path
- `LACE_UNKNOWN_PATTERN` guard update

### 4. Proposed Solution: Mount Declaration Schema

- `LaceMountDeclaration` interface evolution: `{ target, recommendedSource?, description?, readonly?, type?, consistency? }`
- Feature metadata: `customizations.lace.mounts` in `devcontainer-feature.json`
- Project metadata: `customizations.lace.mounts` in `devcontainer.json`
- Both use the same schema; namespace derivation differs (feature shortId vs. `project`)

### 5. Proposed Solution: Resolution Pipeline

- `MountPathResolver` evolution: how it reads declarations + settings to produce full mount specs
- Auto-injection: declared mounts auto-injected into mounts array (like ports)
- Override semantics: explicit `${lace.mount()}` in mounts array overrides auto-injection
- Settings schema: `mounts` key in `settings.json` with `{ source: string }` per label
- Default path derivation when no settings override: `~/.config/lace/<projectId>/mounts/<ns>/<label>`
- Auto-create behavior for defaults; hard error for missing overrides

### 6. Proposed Solution: Validation

- Namespace validation: must be `project` or a known feature ID
- Mount name validation: must exist in the declaring metadata's `customizations.lace.mounts`
- Target conflict detection: no two declarations can share a container target path
- Settings validation: override source paths must exist on disk

### 7. Proposed Solution: Guided Configuration UX

- When a mount has no settings override and uses a default path, log actionable guidance
- Include `recommendedSource` in the guidance message when available
- Include mount field details (type, readonly) in the guidance
- Consider a `lace configure` or `lace init` command that walks the user through mount setup (future scope, but mention it)

### 8. Design Decisions

- Accessor syntax rationale (vs. separate template functions)
- `recommendedSource` as guidance, not default (user must explicitly configure or accept lace-managed default)
- Feature opacity prevention: features can't mount host dirs without user settings config
- `project/` namespace as special case
- String-format output (JSON mount objects can't express readonly)

### 9. Concrete Before/After

- Lace devcontainer.json: current state → evolved state
- Mount declaration in devcontainer customizations
- Settings.json example with overrides
- Feature metadata example (hypothetical claude-code feature)
- Resolved `.lace/devcontainer.json` output

### 10. Stories

- New contributor clones + runs `lace up` (default paths, guided messaging)
- Existing user migrates (settings overrides for existing dirs)
- Feature declares a mount (auto-injection, user configures source)
- Cross-feature reference via `.target` accessor
- Project-level mount with `recommendedSource`

### 11. Edge Cases

- Duplicate target paths across features
- Override path doesn't exist
- Mount referenced by `${lace.mount()}` in mounts array AND auto-injected (override semantics)
- `.source` accessor used outside mounts array (valid: just gives the path)
- Bare `${lace.mount()}` used outside mounts array (should warn or error — produces a mount spec string, not a path)
- Feature in prebuildFeatures declares mounts (same asymmetric handling as ports?)

### 12. Implementation Phases

High-level phase structure (detailed implementation specs in each phase):

1. **Rework `MountPathResolver` + declaration schema** — updated interfaces, `recommendedSource`, declaration parsing from both feature metadata and devcontainer customizations
2. **Rework template patterns + resolution** — new regex patterns for accessor syntax, resolution logic for all three forms, `LACE_UNKNOWN_PATTERN` update
3. **Rework auto-injection** — mount declarations auto-injected, override detection, mount field passthrough
4. **Rework pipeline wiring in `up.ts`** — validation (namespace, target conflicts), guided config messaging, settings integration
5. **Migrate lace devcontainer** — move bash-history and claude-config declarations to `customizations.lace.mounts`, update mounts array
6. **Smoke test: `lace up` dogfood** — explicit verification step, not left to chance

### 13. Test Plan

- Unit tests for each phase (mirroring current test structure but for new API)
- Integration tests through full `runUp()` pipeline
- Accessor-specific tests (bare, `.source`, `.target` in various config positions)
- Validation tests (namespace, target conflicts, missing settings)
- Auto-injection + override interaction tests
- Regression: port pipeline unaffected
- Smoke test: real devcontainer verification as an explicit test artifact (not just "run it and see")

### 14. Migration Notes

- This evolves the `mountvars` branch, replacing the v1 API before merge
- Existing 555 tests will be reworked, not preserved
- No backwards compatibility needed (pre-merge)
- The v1 proposal (`2026-02-14-mount-template-variables.md`) gets `status: evolved` + `superseded_by` reference
