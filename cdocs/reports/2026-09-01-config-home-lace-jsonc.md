---
first_authored:
  by: "@claude-sonnet-4-5-20250929"
  at: 2026-09-01T00:00:00-07:00
task_list: devcontainer-decoupling/config-home
type: report
state: live
status: review_ready
tags: [architecture, future_work, devcontainer, lace]
---

# Externalizing Lace Config to `.lace/lace.jsonc`

> BLUF: Lace's config today is source-nested inside `.devcontainer/devcontainer.json` under `customizations.lace.*`, and its generated output already lives at `.lace/devcontainer.json`.
> Moving lace's own config to a new `.lace/lace.jsonc` source file is architecturally sound and matches where the codebase's own README already says the design has outgrown its "minimalist devcontainer-compat" goal, but it collides on directory naming with the existing generated-output file at the same path, and it does not remove the devcontainer CLI's hard requirement that a real `devcontainer.json` exist somewhere.
> The read surface is bigger than "a few functions": 9 files (`devcontainer.ts`, `workspace-layout.ts`, `host-validator.ts`, `feature-metadata.ts`, `template-resolver.ts`, `up.ts`, `resolve-mounts.ts`, `prebuild.ts`, `restore.ts`, `status.ts`) all read or write `customizations.lace.*` or `.devcontainer/devcontainer.json` directly, and two of them (`prebuild.ts`, `restore.ts`) *rewrite* `.devcontainer/devcontainer.json` and its Dockerfile in place, which is a write-path complication this report treats as high-importance.
> No proposal for this exact directory move exists yet; the closest prior art is `cdocs/proposals/2026-03-25-lace-config-directory-reorganization.md` (host-side `~/.config/lace/` layout, unimplemented RFP stub) and `cdocs/proposals/2026-03-05-lace-init-command.md` (would need to target the new file once it exists).
> Recommendation: treat this as a proposal-worthy design decision, not a mechanical rename, because the `devcontainer` field's semantics (path reference vs. inline vs. generated) determine whether this is a two-week refactor or a rethink of the whole pipeline.

## Context / Background

The user's framing: "Lace has rather outgrown the devcontainer compat. It should have its own `$workspace/.lace/lace.jsonc` with a `devcontainer` field rather than nesting its own config."

This echoes a note already in the codebase.
`packages/lace/README.md` line 787 carries:

> NOTE(mjr): original design goal was for lace to be very minimalist/lightweight, thus the efforts to maintain devcontainer spec compliance, but the surface area for preprocessing/prebuilds has grown such that it may no longer be sensible.

So the request is not a new observation, it is acting on a gap the maintainer already flagged.
This report grounds that intent against the actual code.

## Current State

### Where lace config lives today

All lace-specific config is nested inside the project's `.devcontainer/devcontainer.json`, under `customizations.lace`.
The lace project's own config (`.devcontainer/devcontainer.json`) is the reference example:

```jsonc
{
  "name": "Lace Development (Worktrees)",
  "remoteUser": "node",
  "build": { "dockerfile": "Dockerfile", "args": { /* ... */ }, "context": ".." },
  "customizations": {
    "lace": {
      "workspace": { "layout": "bare-worktree", "mountTarget": "/workspaces/lace" },
      "mounts": { "bash-history": { "target": "/commandhistory", /* ... */ } },
      "repoMounts": { "github.com/weftwiseink/clauthier": {}, /* ... */ },
      "prebuildFeatures": { /* feature refs */ }
    }
  },
  "mounts": [ /* auto-injected */ ],
  "containerEnv": { /* ... */ },
  "postCreateCommand": "..."
}
```

`customizations.lace` currently holds: `workspace`, `mounts`, `repoMounts`, `prebuildFeatures`, and `validate`.
Feature-level metadata (a feature's own `devcontainer-feature.json`) separately declares `customizations.lace.ports` and `customizations.lace.mounts`: a related but distinct namespace read by `feature-metadata.ts`, not `devcontainer.ts`.

> NOTE(sonnet/config-home): The task brief mentioned a `plugins` key under `customizations.lace`.
> No such key exists anywhere in `packages/lace/src` or `README.md`.
> The closest match is Claude Code's own plugin marketplace config (unrelated, documented in the README's "Prefer network-backed references" section around line 724).
> Treat `plugins` as not-yet-real; any future schema work should confirm with the user before including it.

### The generated-output side: `.lace/devcontainer.json` already exists

This is the single most important piece of current-state context: **`.lace/` is not an empty directory today.**
`up.ts` already generates a fully resolved, extended devcontainer config at `<workspace>/.lace/devcontainer.json` (gitignored) and invokes the real `devcontainer` CLI against *that* file via `--config`, not against `.devcontainer/devcontainer.json` directly (`up.ts:1509-1511`, `runDevcontainerUp`).

`packages/lace/docs/architecture.md` states this pipeline model directly:

```
.devcontainer/devcontainer.json   (your source config)
        |
        v
  [ 8 pipeline phases: workspace layout, host validation,
    feature metadata, auto-injection, mount validation,
    template resolution, prebuilds, repo mounts ]
        |
        v
  .lace/devcontainer.json   (generated, gitignored)
        |
        v
  devcontainer up           (standard CLI takes over)
```

This means lace already proved the "wrap the devcontainer CLI with a generated config passed via `--config`" pattern works.
It substantially de-risks one of the target design's key questions (see "Interaction with `.devcontainer/devcontainer.json`" below), but it also means **`.lace/lace.jsonc` (new source) and `.lace/devcontainer.json` (existing generated output) would live in the same directory**, one hand-written and checked into git, the other generated and gitignored.
That is confusing by construction and needs an explicit decision (rename the output, or accept the adjacency, or move the source elsewhere).

### Full read/write site enumeration (non-test source)

All sites below read or write `customizations.lace.*` or a literal `.devcontainer/devcontainer.json` path.
Test fixtures under `__tests__/` are excluded per the report scope but exist in parallel for nearly every function listed and would need equivalent fixture updates.

| File | Site | What it does |
|---|---|---|
| `packages/lace/src/lib/devcontainer.ts` | `extractPrebuildFeatures()` (~137-163) | Reads `customizations.lace.prebuildFeatures` |
| | `extractRepoMounts()` (~246-267) | Reads `customizations.lace.repoMounts` |
| | `readDevcontainerConfig()` / `readDevcontainerConfigMinimal()` (~81-132) | Core JSONC parse of the devcontainer.json file itself |
| | `rewriteImageField()` (~332-335) | **Writes** the `image` field back into the raw file content (used by prebuild/restore) |
| | `resolveBuildSource()`, `extractRemoteUser()` | Read `build.dockerfile` / `image` / `remoteUser` from top-level devcontainer.json, not lace-namespaced but still coupled to the file |
| `packages/lace/src/lib/workspace-layout.ts` | `extractWorkspaceConfig()` (40-76) | Reads `customizations.lace.workspace` |
| `packages/lace/src/lib/host-validator.ts` | `extractValidateConfig()` (58-74) | Reads `customizations.lace.validate` |
| `packages/lace/src/lib/feature-metadata.ts` | `validatePortDeclarations()` (583-608) | Reads `customizations.lace.ports`, but from **feature** metadata, not project config |
| | `extractLaceCustomizations()` (650+) | Same feature-metadata namespace |
| `packages/lace/src/lib/template-resolver.ts` | `extractPrebuildFeaturesRaw()` (56-79) | Live-object accessor to `customizations.lace.prebuildFeatures` for in-place mutation |
| | `extractProjectMountDeclarations()` (88-110) | Reads `customizations.lace.mounts`, prefixes `project/` |
| | `warnPrebuildPortTemplates()` (897-916) | Reads `customizations.lace.prebuildFeatures` |
| `packages/lace/src/lib/up.ts` | `devcontainerPath` construction (225-229) | `join(workspaceFolder, ".devcontainer", "devcontainer.json")`: the pipeline's single source-of-truth path |
| | `readDevcontainerConfigMinimal(devcontainerPath)` (235) | Initial read, drives which phases run |
| | `applyWorkspaceLayout(configMinimal.raw, ...)` (251) | Mutates in-memory config (workspaceMount/Folder/postCreateCommand) |
| | In-memory write-back of merged user features (377-380, 848-863) | Writes merged `customizations.lace.prebuildFeatures` back into the in-memory raw object (not to disk) so downstream phases see merged state |
| | `readDevcontainerConfig(devcontainerPath)` (947) | Second, full read (with Dockerfile) once prebuild is known to be needed |
| | `generateExtendedConfig()` → `writeFileSync(outputPath, ...)` (1476-1481) | **Writes** `.lace/devcontainer.json` (the generated output) |
| | `runDevcontainerUp()` (1495-1537) | Invokes `devcontainer up --config <workspace>/.lace/devcontainer.json` |
| `packages/lace/src/lib/resolve-mounts.ts` | `devcontainerPath` construction + `readDevcontainerConfigMinimal()` (58-67) | Independent path construction, duplicated from up.ts |
| `packages/lace/src/lib/prebuild.ts` | `readDevcontainerConfig(configPath)` (75) | Reads for Dockerfile/image rewrite |
| | `rewriteImageField()` calls (241, 377) | **Writes** `.devcontainer/devcontainer.json`'s `image` field in place, pointing it at a `lace.local/*` prebuild tag |
| `packages/lace/src/lib/restore.ts` | `readDevcontainerConfig(configPath)` (42) | Reads before restoring |
| | `rewriteImageField()` (146) | **Writes** `.devcontainer/devcontainer.json`'s `image` field back to the original value |
| `packages/lace/src/lib/status.ts` | `configPath` construction (38-40) + two `readDevcontainerConfig()` calls (54, 75) | Independent path construction, duplicated a third time |
| `packages/lace/src/lib/user-config-merge.ts` | `applyUserConfig()` | Not a devcontainer.json reader itself, but merges `~/.config/lace/user.json` (`user-config.ts`) into the in-memory raw config at the same `customizations.lace.*` shape. This is the layer that would need to also merge with `.lace/lace.jsonc` |

Three independent constructions of `join(workspaceFolder, ".devcontainer", "devcontainer.json")` exist (`up.ts`, `resolve-mounts.ts`, `status.ts`), plus a fourth pattern in `prebuild.ts`/`restore.ts` where `configPath` is passed in by the caller.
None of these are centralized behind a single "resolve the lace config path" function today: each command re-derives the path.
That is itself a pre-existing maintenance smell this migration should fix, not just work around.

### `customizations.lace.prebuildFeatures` in-memory write-back pattern

`up.ts:377-380` and `up.ts:848-863` mutate `customizations.lace.prebuildFeatures` on the in-memory raw object (merging user.json features into it) so that later phases, which all read via `extractPrebuildFeaturesRaw()` / `extractPrebuildFeatures()`, see the merged result without re-reading the file.
The comment at `up.ts:854-856` explicitly flags this as fragile: "This relies on shared object references through the extraction chain. If configMinimal.raw is ever deep-cloned before this point, this mutation would silently stop working."
This in-memory shape (`raw.customizations.lace.*`) is effectively lace's internal representation, decoupled from the on-disk file format.
That decoupling is useful groundwork for the target design: as long as `.lace/lace.jsonc`'s parsed shape gets normalized into the same `customizations.lace`-equivalent in-memory object before Phase 0a runs, none of the ~15 extraction functions above need to change their signatures. Only the initial load path changes.

## Target Design

### Proposed `.lace/lace.jsonc` schema

```jsonc
// $workspace/.lace/lace.jsonc
{
  // Points at (or generates) the devcontainer config lace hands to the
  // `devcontainer` CLI. See "devcontainer field semantics" below for the
  // three candidate interpretations.
  "devcontainer": "../.devcontainer/devcontainer.json",

  // Everything currently under customizations.lace.* in devcontainer.json
  // moves here verbatim, at the top level instead of nested three deep.
  "workspace": {
    "layout": "bare-worktree",
    "mountTarget": "/workspaces/lace"
  },

  "mounts": {
    "bash-history": {
      "target": "/commandhistory",
      "description": "Bash command history persistence"
    }
  },

  "repoMounts": {
    "github.com/weftwiseink/clauthier": {},
    "github.com/micimize/dotfiles": { "readonly": false }
  },

  "prebuildFeatures": {
    "ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1": {}
  },

  "validate": {
    "fileExists": ["~/.ssh/id_ed25519"]
  }
}
```

This is a direct hoist: every key currently nested under `customizations.lace` becomes a top-level key in `lace.jsonc`.
No new fields are invented beyond `devcontainer` itself: the schema is additive-neutral, which keeps the migration mechanical rather than a redesign.

### `devcontainer` field semantics: three candidates, not resolved by this report

This is the crux open question and it changes the shape of the whole project.

**Option A: path reference to an existing `.devcontainer/devcontainer.json`.**
`lace.jsonc` is purely lace's config; `devcontainer` is a relative path string to the plain devcontainer.json that stays exactly as it is today, minus the `customizations.lace` block.
Lace reads both files and merges them in memory (same internal shape as today).
Lowest risk, smallest diff, but does not fully realize "lace wraps devcontainer": it is still two files describing one container, just split differently.

**Option B: `devcontainer` is inline, and `.devcontainer/devcontainer.json` becomes generated.**
`lace.jsonc` contains the entire devcontainer config (the `devcontainer` key holds an object, not a path) plus lace's own keys as siblings.
Lace generates `.devcontainer/devcontainer.json` from it (much like it already generates `.lace/devcontainer.json`) purely so that tools expecting the standard layout (VS Code's Dev Containers extension, `devcontainer` CLI without lace, CI) still find something there.
This is the design that actually matches "lace is the outer layer wrapping devcontainer" but doubles the number of generated-config write sites (now `.devcontainer/devcontainer.json` *and* `.lace/devcontainer.json` are both lace-authored artifacts, one committed-looking but generated, one gitignored).
Confusing for anyone who edits `.devcontainer/devcontainer.json` directly expecting it to stick.

**Option C: `devcontainer` is inline and `.devcontainer/` is only ever regenerated into `.lace/devcontainer.json` (today's existing output path), never written back to `.devcontainer/`.**
Closest to a clean break: `.devcontainer/devcontainer.json` stops being a lace-relevant file entirely except as a fallback for non-lace tooling, and users who want VS Code's Dev Containers extension to work without lace either accept staleness or lace offers a `lace sync-devcontainer` command to regenerate it on demand (not at every `up`).

None of these was specified by the user's one-sentence request, and each has materially different implementation cost.
This report does not pick one; a proposal must.

### How `ports`/`mounts`/`prebuildFeatures`/`workspace` move over

Mechanically straightforward under Option A or the "hoist" schema shown above: every `extract*()` function in the table above changes from `config.customizations.lace.X` to `laceConfig.X` (one fewer level of nesting, same leaf shapes).
The `ports` key is the one exception: it is feature-declared metadata (`devcontainer-feature.json`'s own `customizations.lace.ports`), not project config, and is unaffected by this migration. It stays exactly where it is regardless of which option is chosen.

The "plugins" key named in the task brief does not exist in the current schema (see NOTE above) and should not be included in a schema example without separate confirmation of what it would mean.

### Interaction with `.devcontainer/devcontainer.json`

Under every option, the `devcontainer` CLI itself is invoked with `--config <path>` already (`up.ts:1509-1511`), so lace does **not** strictly need a file at the conventional `.devcontainer/devcontainer.json` location to function: this is the load-bearing precedent that makes the whole idea viable.
What `.devcontainer/devcontainer.json` is still needed for, regardless of option:
- VS Code's "Reopen in Container" and the Dev Containers extension, which look for it at the fixed path by convention (not configurable to point elsewhere without also opening a `.code-workspace` trick).
- Any CI or tooling that runs the bare `devcontainer` CLI without lace in front of it.
- `prebuild.ts`/`restore.ts`'s in-place `image` field rewrite. Under Option A this rewrite target is unchanged; under B/C it would need to target whichever file is the *generated* one, and the *other* file (if hand-authored) would need its own untouched reference to the original image so restore has something to restore to.

## Back-Compat / Migration Path

Two configs cannot be silently both-supported forever without ambiguity: if both `.devcontainer/devcontainer.json`'s `customizations.lace` and `.lace/lace.jsonc` exist and disagree, precedence must be defined and it will surprise someone.
Recommended shape, not yet validated by a proposal:

1. **Detection-based dispatch, not merge, for v1.** If `.lace/lace.jsonc` exists, use it exclusively for lace config and read `.devcontainer/devcontainer.json` (or wherever its `devcontainer` field points) purely as the devcontainer shape.
   If `.lace/lace.jsonc` does not exist, fall back to today's behavior unchanged (`customizations.lace` in `.devcontainer/devcontainer.json`).
   This avoids a merge-precedence design question entirely for the first cut, at the cost of not supporting a gradual per-key migration.
2. **No auto-migration in v1.** Given `lace init` (proposed, unimplemented, see `cdocs/proposals/2026-03-05-lace-init-command.md`) is the natural scaffolding entry point, a `lace migrate-config` or equivalent one-shot command that extracts `customizations.lace` out of an existing `.devcontainer/devcontainer.json` into a new `.lace/lace.jsonc` is more contained than teaching every read site to accept both shapes indefinitely.
3. **Deprecation window is a product decision, not an engineering one.** This report flags it as an open question rather than recommending a duration, since it depends on how many projects (lace's own repo, dotfiles, weftwise, clauthier, etc.) currently rely on the nested shape. A grep-based audit of sibling repos was out of scope for this report.

## Risks and Open Questions

- **Naming collision, high-importance.** `.lace/lace.jsonc` (new, hand-authored, presumably committed) and `.lace/devcontainer.json` (existing, generated, gitignored) share a directory.
  `.lace/` is currently documented (README ~732-735) as "add to your `.gitignore`... machine-specific artifacts."
  Putting a hand-authored source file in a directory whose entire documented purpose is generated/gitignored artifacts is a direct contradiction that must be resolved (either the source file gets a `.lace/` gitignore carve-out, or it lives somewhere else, e.g. `.lace.jsonc` at workspace root or a differently-named directory).
- **Three duplicated path-construction sites (`up.ts`, `resolve-mounts.ts`, `status.ts`) plus two passed-in-by-caller sites (`prebuild.ts`, `restore.ts`) all need to change in lockstep.** Missing one produces a command that silently keeps reading the old location. This argues for centralizing config discovery behind one function *before* or *as part of* this migration, not after.
- **The `image` field in-place rewrite (`prebuild.ts`, `restore.ts`) is a write path, not just a read path.** Every design option above has to say explicitly which file gets rewritten during prebuild/restore and which (if any) is the durable source of truth for "what was the original image." This is easy to gloss over because the current report's read-site table makes it look like read-only config parsing; it is not.
- **No committed proposal exists yet for this exact change.** `cdocs/proposals/2026-03-25-lace-config-directory-reorganization.md` is an unimplemented RFP stub about `~/.config/lace/` (host-level, cross-container state: SSH keys, caches, per-project state): a related but distinct concern from a per-workspace `.lace/lace.jsonc`. Conflating the two in a single proposal would be a scope-creep risk. They should likely stay separate proposals that reference each other.
- **`lace init` (RFP, `cdocs/proposals/2026-03-05-lace-init-command.md`) currently scopes itself as scaffolding `.devcontainer/devcontainer.json`.** If this migration proceeds, `lace init`'s target output changes to `.lace/lace.jsonc` (+ whatever the `devcontainer` field requires), which is a direct dependency: `lace init`'s RFP should not be elaborated into a full proposal until the `devcontainer` field's semantics are settled, or it will need a rewrite.
- **`user.json` (`cdocs/proposals/2026-03-25-lace-user-json-rollout.md`, implemented) merges user-level features/mounts/git identity into the same `customizations.lace`-shaped in-memory object.** That merge logic (`user-config-merge.ts`) is unaffected in principle (it operates on the parsed in-memory shape, not the file), but its tests and any place that constructs a raw `customizations.lace` fixture for testing purposes will need updating.
- **VS Code / non-lace tooling degradation is a real cost under Options B and C, not a hypothetical.** The lace repo's own `.devcontainer/devcontainer.json` currently has a manual fallback comment block (bottom of the file) for "contributors without lace" who uncomment `workspaceMount`/`workspaceFolder`/`postCreateCommand` by hand. If `.devcontainer/devcontainer.json` becomes fully generated, that manual-fallback affordance either disappears or has to be preserved as a separate concern.
- **Feature-metadata `customizations.lace.ports`/`mounts` (declared inside a *feature's* `devcontainer-feature.json`, not project config) is a separate, unrelated namespace that happens to share the `customizations.lace` name.** This report confirms it is out of scope for this migration (features are third-party OCI artifacts lace does not control the shape of), but the shared naming is worth flagging so a future reader does not assume feature-level config also moves to `lace.jsonc`.

## Work Breakdown

Sizing assumes one implementer with test coverage parity to the existing `__tests__` suite (which mirrors nearly every function touched here).

1. **Proposal: resolve the `devcontainer` field semantics (Option A/B/C above) and the `.lace/` naming collision.**
   Success criteria: a `cdocs/proposals/*.md` exists, reviewed and `implementation_ready`, that picks one option, defines the migration/back-compat policy precisely (not just "TBD"), and states where the hand-authored file physically lives if not `.lace/lace.jsonc` as literally named.
   Not started by this report; this report's job ends here.

2. **Centralize config-path discovery.** Before touching schema, collapse the three duplicated `join(workspaceFolder, ".devcontainer", "devcontainer.json")` sites (`up.ts:225-229`, `resolve-mounts.ts:58`, `status.ts:38-40`) and the two caller-supplied `configPath` sites (`prebuild.ts`, `restore.ts`) behind one exported "resolve lace config location(s)" function.
   Success criteria: single source of truth for path resolution; existing tests pass unchanged (pure refactor, no schema change yet).

3. **Introduce `.lace/lace.jsonc` parsing behind the chosen `devcontainer` field semantics, dispatch-only (no merge) as described in Migration Path.**
   Success criteria: a project with `.lace/lace.jsonc` present runs the full `lace up` pipeline correctly; a project without it is provably unchanged (regression suite green with zero modifications to non-lace.jsonc fixtures).

4. **Migrate all ~15 `extract*()` call sites from `config.customizations.lace.X` to the new top-level shape**, keeping the in-memory representation (`raw.customizations.lace.*` or its replacement) consistent enough that `user-config-merge.ts`'s write-back pattern (`up.ts:377-380`, `848-863`) does not need a parallel second code path.
   Success criteria: every file in the read/write table above updated; test fixtures updated in lockstep (excluded from this report's file-count but not from the actual work).

5. **Resolve the `image` field rewrite write-path (`prebuild.ts`, `restore.ts`) against the chosen option.**
   Success criteria: `lace prebuild` / `lace restore` round-trip correctly against whichever file is now the rewrite target, verified against the lace repo's own devcontainer as the test case (it already exercises prebuildFeatures).

6. **`lace migrate-config` one-shot command** (extracts `customizations.lace` from an existing `.devcontainer/devcontainer.json` into a new `.lace/lace.jsonc`).
   Success criteria: running it against the lace repo's own `.devcontainer/devcontainer.json` produces a `.lace/lace.jsonc` that reproduces an equivalent `lace up` run (same resolved `.lace/devcontainer.json` output modulo key ordering).

7. **Update `lace init` RFP** (`cdocs/proposals/2026-03-05-lace-init-command.md`) to target the new file, once Phase 1's option is settled. Not part of this migration's implementation, but blocks that RFP's elaboration.

8. **Documentation**: `packages/lace/README.md` config sections (ports ~127-166, mounts ~166+, workspace ~540, validate ~614, user-level data ~756-793) and `packages/lace/docs/architecture.md`'s pipeline diagram both need the source-of-truth box relabeled from `.devcontainer/devcontainer.json` to `.lace/lace.jsonc` (or whatever Phase 1 settles on).
   Success criteria: no doc still shows `customizations.lace` as the nesting path for project config once the migration ships.
