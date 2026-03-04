---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T12:00:00-08:00
task_list: lace/documentation
type: proposal
state: live
status: implementation_wip
tags: [documentation, architecture, onboarding, migration, contributing, troubleshooting, idioms]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-03-03T14:00:00-08:00
  round: 1
---

# Documentation: Idioms and Usage Guide

> BLUF: Add three new documentation files to `packages/lace/docs/` and one `CONTRIBUTING.md` at the repo root, covering (1) architecture overview with pipeline flow diagram, (2) troubleshooting guide for common failure modes, (3) migration guide from standard `devcontainer` CLI to lace, and (4) contributing guidelines explaining codebase idioms and testing patterns. The existing `packages/lace/README.md` is comprehensive as API reference but lacks the "why" and "how to think about it" documentation that helps new users adopt lace and new contributors navigate the codebase. The root `README.md` and `packages/lace/docs/prebuild.md` are the only other docs. This proposal does not touch existing files (except adding cross-links in Phase 5) -- it adds new files that cross-reference the existing README for detail.
>
> - **Key source files:** `packages/lace/docs/` (new files), `CONTRIBUTING.md` (new, repo root), `packages/lace/README.md` (existing, cross-referenced)
> - **Scope:** Documentation only, no code changes

## Objective

Lace has grown to seven abstraction layers with sophisticated template resolution, mount management, workspace detection, and prebuild pipelines. The existing README covers the "what" comprehensively but lacks:

1. **Architecture overview** -- no visual or narrative guide to how the layers compose into the `lace up` pipeline. A user reading the README sees 14 numbered steps but no mental model for why they are in that order or how data flows between them.

2. **Troubleshooting guide** -- common failure modes (port exhaustion, stale metadata cache, prebuild-induced config breakage, Docker auto-creating directories instead of files) are undocumented. Users hit these issues and have no breadcrumb trail.

3. **Migration guide** -- users with existing `devcontainer.json` configs have no path from "standard devcontainer CLI" to "lace-managed." The README assumes you are starting from scratch.

4. **Contributing guidelines** -- the codebase uses consistent idioms (custom error classes, discriminated unions, subprocess injection, scenario test helpers) that are invisible without reading every source file. New contributors duplicate patterns incorrectly or miss them entirely.

## Background

### Existing documentation inventory

| File | Coverage | Gap |
|------|----------|-----|
| `README.md` (root) | Brief overview, package list, project structure, build instructions | No architecture, no "getting started beyond the basics" |
| `packages/lace/README.md` | Full API reference: commands, flags, template syntax, mount system, ports, prebuilds, workspace layout, validation, file layout, hardcoded defaults | No architecture narrative, no troubleshooting, no migration path |
| `packages/lace/docs/prebuild.md` | Prebuild pipeline internals: FROM rewriting, image naming, cache, lock file | Narrow scope (prebuild only), thorough within its scope |
| `cdocs/proposals/` | 80+ design proposals with detailed rationale | Not user-facing; design history, not usage guidance |
| `cdocs/devlogs/` | 50+ development logs | Not user-facing; implementation records |

### Documentation principles for this proposal

- **Cross-reference, do not duplicate.** The README is the source of truth for API details. New docs link to it rather than restating syntax.
- **Mental models over reference tables.** Architecture and troubleshooting docs explain "how to think about it," not "what the flags are."
- **Concrete examples.** Every concept gets a realistic `devcontainer.json` snippet showing the before/after or the failure/fix.
- **Separate audience concerns.** Users read architecture + troubleshooting + migration. Contributors read contributing guidelines. The docs do not try to serve both audiences in one file.

## Proposed Solution

Add three files under `packages/lace/docs/` and one at the repo root:

```
CONTRIBUTING.md              # Codebase idioms, testing patterns (repo root)
packages/lace/docs/
  prebuild.md                # (existing)
  architecture.md            # Pipeline overview, layer interactions
  troubleshooting.md         # Common failures and fixes
  migration.md               # From devcontainer CLI to lace
```

### 1. Architecture Overview (`architecture.md`)

#### Content outline

**Pipeline flow narrative.** Walk through `lace up` as a data transformation pipeline. Start with the user's `devcontainer.json` and end with the generated `.lace/devcontainer.json` passed to `devcontainer up`. Show how each phase transforms the config object.

**Seven abstraction layers.** Not as a numbered list (the README already has that), but as a dependency diagram showing which layers feed into which:

```
User's devcontainer.json
  │
  ├─ Workspace Layout Detection ──────────────────┐
  │   (bare-worktree → workspaceMount/Folder)     │
  │                                                │
  ├─ Host Validation ─────────────────────────────┐│
  │   (fileExists checks, pre-flight)             ││
  │                                                ││
  ├─ Feature Metadata (OCI registry) ─────────┐   ││
  │   (fetch + cache + validate)               │   ││
  │                                            │   ││
  ├─ Mount Management ◄────────────────────────┤   ││
  │   (declarations + auto-inject + validate   │   ││
  │    + sourceMustBe + dedup)                 │   ││
  │                                            │   ││
  ├─ Template Resolution ◄─────────────────────┤   ││
  │   (port + mount expressions → concrete)    │   ││
  │                                            │   ││
  ├─ Port Allocation ◄────────────────────────-┤   ││
  │   (symmetric 22425-22499, persistent)      │   ││
  │                                            │   ││
  ├─ Prebuilds ◄───────────────────────────────┘   ││
  │   (feature baking → lace.local/ images)        ││
  │                                                ││
  └─ Generated .lace/devcontainer.json ◄───────────┘│
      │                                             │
      └─ devcontainer up ◄──────────────────────────┘
```

**Layer-to-step mapping.** An explicit table mapping the seven conceptual layers to the README's 14 pipeline steps, so readers can cross-reference between the architecture narrative and the README's step list:

| Conceptual Layer | README Steps | Key Operations |
|------------------|-------------|----------------|
| Workspace Layout Detection | 1-2 | Detect layout, set workspaceMount/Folder |
| Host Validation | 3 | fileExists checks, pre-flight validation |
| Feature Metadata (OCI) | 4-5 | Fetch, cache, validate feature metadata |
| Mount Management | 6-8 | Declarations, auto-inject, validate, sourceMustBe, dedup |
| Template Resolution | 9-10 | Port + mount expressions resolved to concrete values |
| Port Allocation | 11-12 | Symmetric allocation, persistence, port entries |
| Prebuilds | 13-14 | Feature baking, lace.local/ images, FROM rewriting |

(Exact step numbers to be finalized during Phase 1 implementation against the current `runUp()` source.)

**Data flow examples.** Show a minimal config going through each phase with the intermediate state annotated. For example:

*Port example:*
- Input: `${lace.port(sshd/port)}` in features block
- After metadata fetch: port declaration extracted from OCI registry
- After auto-injection: template already present, injection suppressed
- After port allocation: port 22430 assigned, persisted
- After template resolution: `"port": 22430` (integer, full-match coercion)
- After port entry generation: `appPort`, `forwardPorts`, `portsAttributes` added

*Mount example:*
- Input: `${lace.mount(sshd/ssh-dir).source}` in mount target, with `customizations.lace.mounts` declaration specifying `sourceMustBe: "directory"`
- After metadata fetch: mount declaration extracted from OCI registry annotations
- After auto-injection: mount entry injected into `mounts` array (or injection suppressed if template already present)
- After settings lookup: source path resolved from `~/.config/lace/settings.json` (e.g., `~/.ssh`)
- After host validation: `sourceMustBe: "directory"` check confirms `~/.ssh` exists and is a directory (not Docker's auto-created empty dir)
- After namespace validation: `sshd/ssh-dir` validated -- `sshd` matches a feature short ID in the config
- After template resolution: `"source": "/home/user/.ssh"` (string substitution)

**Settings and state files.** Explain the three data locations (per-project `.lace/`, user-level `~/.config/lace/`, Docker daemon) and when each is read/written during the pipeline.

#### Rationale

The README's 14-step numbered list in `lace up` is accurate but opaque. Users need to understand that the pipeline is a series of config transformations, that earlier phases feed into later ones (metadata enables auto-injection, which enables template resolution), and that the output is a standard `devcontainer.json` that the standard CLI consumes. This mental model makes everything else in the README click.

### 2. Troubleshooting Guide (`troubleshooting.md`)

#### Content outline

Organized as problem-symptom-cause-fix entries:

**Port allocation failures**
- Symptom: `lace up` fails with "no ports available in range"
- Cause: All 75 ports (22425-22499) allocated or occupied by other services
- Fix: Check `.lace/port-assignments.json` for stale entries, check `ss -tlnp` for port users, delete stale assignments

**Stale metadata cache**
- Symptom: Feature options have changed but lace still uses old schema
- Cause: Floating tag cache (24h TTL) serving stale `devcontainer-feature.json`
- Fix: `--no-cache` flag, or delete `~/.config/lace/cache/features/` manually

**Prebuild-induced config breakage**
- Symptom: `devcontainer up` fails after `lace prebuild` with "image not found"
- Cause: Docker image was pruned, or `lace.local/` FROM reference left in Dockerfile after `docker system prune`
- Fix: `lace restore` then `lace prebuild --force`, or `lace status` to diagnose

**Docker auto-creates directory instead of file mount**
- Symptom: Feature expects a file (e.g., SSH key) but gets an empty directory
- Cause: Bind-mount source does not exist; Docker auto-creates it as a directory
- Fix: Use `sourceMustBe: "file"` in mount declaration, or create the file before `lace up`

**Template resolution errors**
- Symptom: `lace up` fails with "unknown lace template expression"
- Cause: Typo in template (`${lace.prot(...)}`) or stale v1 syntax (`${lace.mount.source(...)}`)
- Fix: Check the exact expression; valid forms are `${lace.port(...)}` and `${lace.mount(...)}[.source|.target]`

**Silent fallback to default mount paths**
- Symptom: Container starts but feature data is missing (e.g., Claude config not available)
- Cause: No settings override configured; lace used auto-created empty directory under `~/.config/lace/`
- Fix: Read the guided config output from `lace up`, configure `settings.json` with actual source paths

**Workspace layout mismatch**
- Symptom: `lace up` fails with "workspace layout detection found normal-clone but bare-worktree was declared"
- Cause: Config declares `"layout": "bare-worktree"` but workspace is a normal git clone
- Fix: Remove the `workspace` block if not using bare-worktree layout, or set up bare-repo worktrees

**Feature metadata fetch failures (network/OCI)**
- Symptom: `lace up` fails with OCI registry errors or timeouts
- Cause: Network unavailable, registry rate-limited, or feature not published
- Fix: `--skip-metadata-validation` for offline/emergency use. Check feature ID spelling. Try `devcontainer features info manifest <feature-id>` directly.

**Namespace validation errors for mounts**
- Symptom: "Unknown mount namespace 'foo' -- expected 'project' or a feature short ID"
- Cause: Mount label uses a namespace that does not match any feature in the config
- Fix: Use `project/` prefix for project-level mounts, or feature short ID for feature-level

**Lock file contention**
- Symptom: `lace up` hangs or fails with "lock file held"
- Cause: Concurrent `lace up` invocations contending on the lock file in `.lace/`
- Fix: Check for stale lock files in `.lace/`. If a previous `lace up` was interrupted (e.g., killed, crashed), the lock file may remain. Remove it manually (`rm .lace/*.lock` or the specific lock file) and retry. Avoid running multiple `lace up` commands against the same project simultaneously.

#### Rationale

Every one of these failure modes has occurred in practice (evidenced by devlogs and proposals addressing them). Currently a user hitting any of these has to read source code or cdocs proposals to diagnose the problem.

### 3. Migration Guide (`migration.md`)

#### Content outline

**Starting point: a standard devcontainer.json.** Show a realistic config that uses the standard `devcontainer` CLI directly -- image-based, a few features, manual port forwarding, static mounts.

**Step 1: Minimal lace wrapper.** Replace `devcontainer up` with `lace up`. No config changes. Lace generates `.lace/devcontainer.json` and passes it through. Everything works as before. Add `.lace/` to `.gitignore`.

**Step 2: Port allocation.** Replace hardcoded port values with `${lace.port()}` templates. Show before/after for a feature like `sshd` with a port option. Explain the symmetric port model and why it matters for multi-container setups.

**Step 3: Mount declarations.** Replace static `mounts` array entries with `customizations.lace.mounts` declarations and `${lace.mount()}` templates. Show the guided config output and settings.json setup. Explain auto-injection and how it reduces boilerplate.

**Step 4: Prebuilds (optional).** Move slow features to `prebuildFeatures`. Show the workflow: `lace prebuild` → develop → `lace restore` → commit. Link to `prebuild.md` for internals.

**Step 5: Workspace layout (optional).** If using bare-worktree repos, add the `workspace` block. Show the before (manual `workspaceMount`/`workspaceFolder`) and after (auto-detected).

**Step 6: Host validation (optional).** Add `validate.fileExists` checks for prerequisites. Show how `--skip-validation` works for CI or initial setup.

**What NOT to migrate.** Explicitly call out things lace does not replace: the `devcontainer` CLI itself (lace wraps it), VS Code remote container extension (lace is terminal-native but the generated config is VS Code compatible), Docker Compose (lace targets single-container devcontainers).

#### Rationale

The single biggest barrier to adoption is not knowing where to start. Users with existing configs need incremental migration steps, not a blank-page tutorial. Each step is independently valuable -- you can stop at step 2 and still benefit from port allocation.

### 4. Contributing Guidelines (`CONTRIBUTING.md` at repo root)

#### Content outline

**Project structure recap.** Brief orientation: monorepo with `packages/lace/` (CLI) and `devcontainers/features/` (OCI features). Build with `pnpm --filter lace build`, test with `pnpm --filter lace test`.

> **NOTE:** Documented patterns should be verified against source code on each major version. If a pattern described here does not match what you see in the code, the code is authoritative -- please update this guide.

**Codebase idioms:**

*Custom error classes with `.name` property.* Every module defines its own error class extending `Error` with `this.name` set in the constructor. Pattern:

```typescript
export class DevcontainerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevcontainerConfigError";
  }
}
```

Found in: `DevcontainerConfigError`, `MetadataFetchError`, `AnnotationMissingError`, `RepoCloneError`, `DockerfileParseError`, `MountsError`, `SettingsConfigError`. The `.name` property enables catch-site discrimination without `instanceof` across module boundaries.

*Discriminated unions for multi-outcome results.* Functions that can succeed in multiple ways (or fail in multiple ways) return tagged unions with a `kind` discriminant:

```typescript
export type PrebuildFeaturesResult =
  | { kind: "features"; features: Record<string, Record<string, unknown>> }
  | { kind: "absent" }
  | { kind: "null" }
  | { kind: "empty" };
```

Callers switch on `kind` for exhaustive handling. This pattern appears in `PrebuildFeaturesResult`, `ConfigBuildSource`, `RepoMountsResult`, and throughout the template resolution pipeline.

*Command-level result objects.* Top-level commands return `{ exitCode, message, phases }` objects where `phases` is a record of per-phase results. This enables structured output, testing without process.exit, and phase-level error reporting:

```typescript
export interface UpResult {
  exitCode: number;
  message: string;
  phases: {
    workspaceLayout?: { exitCode: number; message: string };
    hostValidation?: { exitCode: number; message: string };
    // ...
  };
}
```

*Subprocess injection for testability.* External commands (devcontainer CLI, git, docker, OCI fetches) are invoked through a `RunSubprocess` function type that can be injected via constructor or options parameter. Production code uses the real `execFileSync` wrapper; tests inject mocks:

```typescript
export type RunSubprocess = (
  command: string,
  args: string[],
  options?: { cwd?: string },
) => SubprocessResult;
```

Every class or function that shells out accepts an optional `subprocess` parameter. This avoids global mocking and makes tests hermetic.

*JSONC parsing throughout.* All config files are parsed with `jsonc-parser` (not `JSON.parse`). This allows comments in `devcontainer.json` and `settings.json`. When modifying JSONC files (like the prebuild image rewrite), lace uses `jsonc-parser`'s edit operations to preserve comments and formatting.

*Template expression regex-based extraction with full-match coercion.* Template resolution uses regex patterns to find `${lace.port(...)}` and `${lace.mount(...)}` expressions. When a template is the *entire* string value (full match), it is coerced to the appropriate type (integer for ports). When embedded in a larger string, it is substituted as a string. This enables `"port": "${lace.port(sshd/port)}"` to resolve as `"port": 22430` (integer), not `"port": "22430"` (string).

*Label validation.* Mount and port labels follow the `namespace/label` format validated by `/^[a-z0-9_-]+\/[a-z0-9_-]+$/`. The namespace must be `project` (for project-level mounts) or a feature short ID. Labels that do not match the pattern fail loudly with a descriptive error.

**Testing patterns:**

*Scenario workspace helpers.* Integration tests use `createScenarioWorkspace()` to create isolated temp directories with `.devcontainer/`, `.lace/`, and metadata cache subdirectories. Each workspace has a `cleanup()` method for teardown. Related helpers: `writeDevcontainerJson()`, `setupScenarioSettings()`, `symlinkLocalFeature()`, `readGeneratedConfig()`, `readPortAssignments()`.

*Docker-gated tests.* Tests that require Docker use `isDockerAvailable()` with `describe.skipIf(!isDockerAvailable())`. This allows the full test suite to run on machines without Docker (skipping integration tests gracefully).

*Port connectivity helpers.* `waitForPort()` and `getSshBanner()` provide TCP-level verification for end-to-end tests that start real containers.

*Subprocess mocking.* Tests create mock `RunSubprocess` functions that return predetermined `SubprocessResult` objects. This avoids shelling out to real CLIs and makes tests fast and deterministic.

**Conventions:**

- Every source file starts with `// IMPLEMENTATION_VALIDATION` (a marker for tooling).
- Interfaces are exported from the module that owns the concept (e.g., `LaceMountDeclaration` from `feature-metadata.ts`, not from a shared types file).
- Test files live alongside source files in `__tests__/` subdirectories, matching the module name (`foo.ts` → `__tests__/foo.test.ts`).
- Integration tests that test the full `runUp()` pipeline live in `__tests__/up-*.integration.test.ts`.

#### Rationale

The codebase is remarkably consistent in its patterns, but that consistency is invisible to new contributors. Documenting these idioms prevents pattern drift and reduces onboarding time. The subprocess injection pattern is particularly important -- without understanding it, contributors will introduce untestable code.

## Important Design Decisions

### Separate files rather than expanding the README

**Decision**: Three new files in `packages/lace/docs/` (architecture, troubleshooting, migration) and one `CONTRIBUTING.md` at the repo root, rather than adding sections to `packages/lace/README.md`.

**Why**: The README is already 750+ lines and serves well as API reference. Architecture overview, troubleshooting, and contributing guidelines serve different audiences (users vs. contributors) at different points in their journey. Separate files allow linking directly to the relevant doc without scrolling past 14 sections. The contributing guide is placed at the repo root because GitHub surfaces `CONTRIBUTING.md` in the repository UI and when opening issues/PRs. Since this is a monorepo with one main package, root placement is appropriate; if additional packages gain their own contributing guides later, the root file can link to them.

### No generated API docs

**Decision**: Do not add JSDoc-to-HTML or TypeDoc generation.

**Why**: The codebase is internal tooling, not a library consumed by external developers. The README already documents every user-facing concept. TypeDoc would add build complexity for marginal value. If lace becomes a public library, this decision should be revisited.

### Architecture doc focuses on pipeline flow, not module structure

**Decision**: The architecture doc describes the data flow through `lace up`, not the file/module dependency graph.

**Why**: Users and contributors care about "what happens when I run `lace up`" more than "which TypeScript file imports which." The module structure is straightforward (one file per concept) and navigable via IDE. The pipeline flow is not navigable without documentation.

### Troubleshooting organized by symptom, not by subsystem

**Decision**: Troubleshooting entries start with what the user observes ("lace up fails with...") rather than what subsystem is involved ("Port allocator: ...").

**Why**: Users do not know which subsystem caused their problem. They know what they saw. Symptom-first organization matches how people actually debug.

### Contributing doc includes literal code snippets from the codebase

**Decision**: The contributing guide includes real code patterns copied from source files, not pseudocode or descriptions.

**Why**: Concrete examples prevent misinterpretation. "Custom error classes with `.name` property" could mean many things; showing `DevcontainerConfigError` with the actual constructor body leaves no ambiguity.

## Edge Cases / Challenging Scenarios

### Documentation going stale as the codebase evolves

The architecture doc describes the `lace up` pipeline as of March 2026. If phases are added, removed, or reordered, the doc becomes misleading. **Mitigation**: The doc references the README's step list rather than duplicating it. The conceptual "layers feed into each other" narrative is more stable than specific step numbers. A NOTE callout at the top reminds maintainers to update when the pipeline changes.

### Migration guide assumes a specific starting point

Not all devcontainer configs look alike. Some use Docker Compose, multi-stage builds, or VS Code-specific extensions. **Mitigation**: The guide explicitly calls out "what NOT to migrate" and focuses on the most common single-container Dockerfile/image pattern. Edge cases are linked to the README's detailed sections.

### Contributing guide's code snippets diverge from source

As the codebase evolves, the contributing guide's snippets may drift from actual source. **Mitigation**: Three-layer defense:

1. **Source-code cross-reference comments.** A comment `// Documented in CONTRIBUTING.md -- update if changing this pattern` is placed near each documented pattern in the source code. Anyone modifying the pattern sees the reminder and can update the guide in the same changeset.

2. **Snippets show the pattern, not the full implementation.** Custom error class shape, discriminated union shape, etc. are illustrated with the minimal representative code. The pattern is more stable than specific fields.

3. **Major-version verification note.** The contributing guide includes a NOTE callout advising readers to verify documented patterns against source on each major version. If a pattern in the guide does not match the code, the code is authoritative.

### Docs directory naming confusion

`packages/lace/docs/` (new files) vs `cdocs/` (proposals, devlogs). **Mitigation**: The root README already links to `packages/lace/README.md`. New docs live alongside the existing `prebuild.md` in `packages/lace/docs/`. `cdocs/` remains the project-internal design documentation. The audiences are different: `docs/` is for lace users and contributors; `cdocs/` is for project design history.

## Implementation Phases

### Phase 1: Architecture Overview

**Goal**: Create `packages/lace/docs/architecture.md`.

**Content**:
- Pipeline flow narrative following the `lace up` command
- ASCII diagram showing layer dependencies and data flow
- Layer-to-step mapping table: maps the seven conceptual layers to the README's 14 pipeline steps
- Worked examples: minimal config through each pipeline phase with intermediate states annotated (port example and mount example)
- Settings and state file explanation (`.lace/`, `~/.config/lace/`, Docker daemon)
- Cross-references to README sections for API details

**Files created**: `packages/lace/docs/architecture.md`

**Success criteria**:
- A reader with no prior lace knowledge can describe the `lace up` data flow after reading the doc
- All cross-references to README sections are valid (section headings exist)
- The pipeline description matches the actual step order in `runUp()` (verify against `packages/lace/src/lib/up.ts`)

**Constraints**:
- Do not modify any existing files
- Do not duplicate content from the README; link to it

### Phase 2: Troubleshooting Guide

**Goal**: Create `packages/lace/docs/troubleshooting.md`.

**Content**:
- 8-10 symptom/cause/fix entries covering the failure modes listed in the Proposed Solution
- Each entry includes a realistic error message or symptom description
- Fixes reference specific commands, flags, or file paths

**Files created**: `packages/lace/docs/troubleshooting.md`

**Success criteria**:
- Every troubleshooting entry has a concrete symptom, cause, and fix
- Fixes are actionable (specific commands to run, files to check/edit)
- Error messages match what lace actually produces (verify against source code `console.error` and `message` strings)
- All cited error messages have been grep-verified against actual source code strings

**Constraints**:
- Do not modify any existing files
- Do not invent error messages; use actual messages from the codebase

### Phase 3: Migration Guide

**Goal**: Create `packages/lace/docs/migration.md`.

**Content**:
- Realistic starting-point `devcontainer.json` (image-based, standard features, manual ports and mounts)
- Six incremental migration steps with before/after configs
- "What NOT to migrate" section
- Each step is independently valuable -- users can stop at any point

**Files created**: `packages/lace/docs/migration.md`

**Success criteria**:
- The starting-point config is valid for `devcontainer up` without lace
- Each step's "after" config is valid for `lace up`
- The migration path is incremental -- each step adds one lace feature without requiring later steps
- Cross-references to README are valid

**Constraints**:
- Do not modify any existing files
- Use features that actually exist in the OCI registry for realistic examples (e.g., `ghcr.io/devcontainers/features/sshd:1`)

### Phase 4: Contributing Guidelines

**Goal**: Create `CONTRIBUTING.md` at the repo root. GitHub surfaces root `CONTRIBUTING.md` in the repo UI and when opening issues/PRs. Since this is a monorepo with one main package, root placement is appropriate. If additional packages gain their own contributing guides later, the root file can link to them.

**Content**:
- Project structure and build/test commands
- Seven codebase idioms with code snippets and rationale
- Testing patterns: scenario helpers, Docker-gated tests, subprocess mocking
- Conventions: file markers, interface ownership, test file locations
- NOTE callout advising readers to verify documented patterns against source on each major version
- Source-code cross-reference comments added near each documented pattern

**Files created**: `CONTRIBUTING.md` (repo root)

**Files modified**: Source files containing documented patterns -- add a comment `// Documented in CONTRIBUTING.md -- update if changing this pattern` near each pattern (e.g., near custom error class definitions, discriminated union types, `RunSubprocess` type definition, `createScenarioWorkspace` helper, `IMPLEMENTATION_VALIDATION` marker usage).

**Success criteria**:
- Every code snippet matches a real pattern in the codebase (verify against source files)
- The idiom descriptions explain "why" not just "what"
- A new contributor can set up, build, and run tests by following the doc
- Every documented pattern in source code has a `// Documented in CONTRIBUTING.md -- update if changing this pattern` comment nearby

**Constraints**:
- Code snippets are illustrative of the pattern, not full file copies
- Source-code comments are minimal (one line each) and do not alter behavior

### Phase 5: Cross-linking and root README update

**Goal**: Add a "Documentation" section to the root `README.md` and `packages/lace/README.md` linking to the new docs, including `CONTRIBUTING.md`.

**Files modified**:
- `README.md` (root) -- add a "Documentation" section with links to all four new docs (architecture, troubleshooting, migration in `packages/lace/docs/`, and `CONTRIBUTING.md` at root)
- `packages/lace/README.md` -- add a "Further reading" section at the top or bottom linking to `docs/` and to the root `CONTRIBUTING.md`

**Success criteria**:
- All four new docs are discoverable from both READMEs
- Links use relative paths that work on GitHub
- No content is removed from existing READMEs

**Constraints**:
- Minimal changes to existing files -- only add links, do not restructure

## Resolved Questions

1. **ASCII diagrams, not Mermaid.** Lace is terminal-native CLI tooling; its docs should be readable in terminals and editors without a rendering engine. ASCII diagrams are universally readable and already drafted in this proposal. Mermaid can be added later as a supplement if GitHub-rendered visuals become desirable, but ASCII is the primary format.

## Open Questions

1. **Should troubleshooting entries link to specific source files?** This helps contributors debug but creates maintenance burden. The proposal includes module names (e.g., "check `port-allocator.ts`") but not line numbers or GitHub URLs.
