---
review_of: cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-24T16:00:00-06:00
task_list: lace/wezterm-server
type: review
state: live
status: done
tags: [fresh_agent, architecture, ssh, mount-templates, api_surface, breaking_changes, feature_ownership, pipeline_ordering]
---

# Review: File Mount Declarations with SSH Key Validation for wezterm-server

## Summary Assessment

This proposal extends lace's mount declaration system with a `fileMount: true` flag to handle the SSH public key requirement for wezterm-server, replacing the current three-place declaration pattern (fileExists + static mount + comment) with a single source of truth in feature metadata.
The proposal is well-structured, grounded in real code (the feasibility report is thorough), and the user-facing error experience is significantly better than today.
However, there are several architectural concerns: the `fileMount` flag introduces a boolean dimension to the mount API that conflates resolution strategy with type metadata, the pipeline reordering (Option A) has unexamined failure modes, feature-level ownership of the SSH key is debatable given that sshd (not wezterm-server) is the actual consumer, and the Phase 4 cleanup has no migration path for non-lace contributors.
Verdict: **Revise** -- the core idea is sound but several design decisions need reconsideration before implementation.

## Section-by-Section Findings

### BLUF

The BLUF is comprehensive and accurate.
It correctly identifies the single source of truth benefit and the settings.json override mechanism.
No issues.

### Objective

Clear and well-scoped.
The three objectives (error-interrupt, eliminate redundancy, enable per-user config) are concrete and testable.
No issues.

### Background: Current SSH key setup

**Non-blocking.** The description of the three-place pattern is accurate -- I verified against `.devcontainer/devcontainer.json` lines 27-33 (fileExists), 69 (comment), and 70 (static mount).
One minor note: the proposal says "There is no way for a user to override the key path without forking devcontainer.json."
Technically the user could add a settings.json mount override today if someone manually added the mount to the declarations.
The claim is practically true but slightly overstated.

### Proposed Solution Section 1: `fileMount` flag

**Blocking.** The `fileMount: boolean` flag is the crux of the design, and it has a conceptual problem.

The current `LaceMountDeclaration` is agnostic about what it mounts: it declares a target, optional source guidance, and Docker mount options.
Adding `fileMount: true` introduces a binary type system (file vs. directory) into the declaration, but the actual behavioral difference is entirely in resolution strategy: "validate existence" vs. "auto-create."
This conflation means:

1. The name `fileMount` is misleading. All bind mounts in Docker are "file mounts" in the sense that they use the filesystem. The real distinction is "pre-existing source required" vs. "auto-provisioned source."
   A name like `requireExistingSource: true` or `autoProvision: false` would be more precise and extensible.

2. The boolean creates a false dichotomy. What about a mount where the source is a directory that must already exist (e.g., a dotfiles directory)?
   Under this API, you would need `fileMount: true` even though it's a directory, because the semantics are really "don't auto-create."
   The name `fileMount` would be actively confusing in that case.

3. The `hint` field is only useful when `fileMount: true`.
   This is a code smell: two fields that only make sense together suggest they should be a single compound concept (e.g., a `validation` sub-object) rather than sibling booleans.

**Recommendation:** Replace `fileMount: boolean` + `hint: string` with a `validation` sub-object:

```typescript
export interface LaceMountDeclaration {
  target: string;
  recommendedSource?: string;
  description?: string;
  readonly?: boolean;
  type?: string;
  consistency?: string;
  /** When present, source must already exist (no auto-provisioning). */
  validation?: {
    /** Remediation hint shown when source is missing. */
    hint?: string;
  };
}
```

This is more extensible (future validation options like `minSize`, `permissions`, `contentMatch` can go here), avoids the misleading name, and makes the intent explicit: the presence of `validation` means "check, don't auto-create."

### Proposed Solution Section 3: `resolveSource()` for file mounts

**Blocking.** The proposal says file mounts use `recommendedSource` as the default path instead of the auto-derived path.
This is the right call for SSH keys, but it changes the semantics of `recommendedSource` in a subtle and potentially breaking way.

Currently, `recommendedSource` is documented as "surfaced in config guidance (never used as actual source)" (line 62 of `feature-metadata.ts`).
This proposal would make `recommendedSource` the actual default source for file mounts.
That is a semantic contract change: code that treats `recommendedSource` as informational-only would be wrong for file mounts.

The proposal should either:
- Explicitly acknowledge this contract change and update the JSDoc on `recommendedSource`, or
- Introduce a separate field like `defaultSource` that is used as the actual source path, keeping `recommendedSource` purely informational.

I lean toward the latter because it preserves the separation between "where we tell the user to put things" and "where we actually look."
For SSH keys they happen to be the same, but for other file-mount use cases they might differ (e.g., a team convention says keys go in `~/.ssh/team/`, but the recommended source is `~/.ssh/lace_devcontainer.pub`).

### Proposed Solution Section 4: Error-interrupt message

Well-designed.
The error message includes all five necessary elements (feature name, file description, default path, creation command, settings override).
The settings.json override example being copy-paste-ready is a good UX decision.
No issues.

### Proposed Solution Section 5: Remove redundant declarations

This is covered in detail under Phase 4 below (breaking changes).

### Decision: Feature-level ownership

**Blocking.** The proposal argues wezterm-server should own the SSH key declaration because "the SSH key is a requirement of the wezterm-server feature."
This is incorrect in a precise sense: the SSH key is a requirement of the `sshd` feature.
WezTerm-server *uses* SSH to connect, but it is sshd that authenticates against `authorized_keys`.

The wezterm-server feature's own `devcontainer-feature.json` already acknowledges this tension in its `hostSshPort` option description (line 16): "TODO: Decouple SSH port handling into a thin sshd wrapper feature. The wezterm-server feature should not own SSH port metadata."
The same logic applies to SSH key management: wezterm-server should not own the authorized_keys mount.

Today, wezterm-server owns `hostSshPort` as a pragmatic compromise because there is no lace-aware sshd wrapper feature.
Extending that pragmatic ownership to the SSH key mount is defensible as a short-term measure, but the proposal should:

1. Explicitly acknowledge this is the same ownership compromise as `hostSshPort`.
2. Document the intended future state (sshd feature or wrapper owns both port and key).
3. Consider whether making the key mount a project-level declaration (in devcontainer.json's `customizations.lace.mounts`) is simpler for now, since it avoids publishing a new feature version and keeps the ownership question open.

The project-level approach has a real cost (every project using wezterm-server must declare the mount), but it has the advantage of not baking incorrect ownership into the OCI registry.
Once a feature version is published with the mount declaration, consumers will inherit it, and migrating the declaration to a different feature later requires a breaking change in both features.

### Decision: No auto-generation

The "stepping stone" framing needs scrutiny.

**Non-blocking, but important.** The proposal claims a future auto-generation feature "would integrate by populating the key at the `recommendedSource` path before `lace up` runs, at which point the file mount validation would pass naturally."
This is true only if the auto-generation feature runs as a pre-hook to `lace up`.
But the RFP (`cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md`) envisions a `lace ssh` subcommand, which implies a separate lifecycle.

The stepping-stone framing is valid if auto-generation is a pre-hook.
It becomes an impediment if auto-generation is a separate command, because then the user must remember to run `lace ssh setup` before `lace up`, and the "helpful error" from this proposal becomes a confusing extra step rather than a safety net.

The proposal should acknowledge both integration paths and express a preference.
If the preferred path is a pre-hook (integrated into `lace up`), say so explicitly so the auto-generation proposal can be designed accordingly.

### Edge Cases: Container user is not `node`

**Non-blocking.** The proposal correctly identifies this as a pre-existing limitation.
However, the proposal is the right place to fix it, since the mount target is now being declared in feature metadata rather than in a project-specific devcontainer.json.
When a user of a different base image adopts wezterm-server, the hardcoded `/home/node` target will be wrong, and they have no override mechanism (the settings.json override only covers the source path, not the target).

This could be addressed by making the target a feature option that defaults to the current value, or by deferring to the docker-user-lookup work.
At minimum, the proposal should note that the target path override is a gap.

### Edge Cases: Feature used without lace

Accurate.
The `customizations.lace` section is ignored by standard devcontainer CLI.
No issues.

### Edge Cases: `--skip-validation` behavior

Correct and consistent with existing behavior.
No issues.

### Pipeline ordering (Phase 2: Option A vs Option B)

**Blocking.** The proposal recommends Option A: moving file mount validation to after metadata fetch (Phase 1.5), before template auto-injection.
This is presented as straightforward, but there is an unexamined failure mode.

Looking at `up.ts`, the current pipeline is:

1. Phase 0a: Workspace layout
2. Phase 0b: Host validation (runs `runHostValidation` on the raw config)
3. Metadata fetch + validation
4. Auto-inject port templates
5. Auto-inject mount templates
6. Mount namespace/target validation
7. Settings load + MountPathResolver construction
8. Template resolution (calls `resolveSource()` which can throw for missing overrides)

Under Option A, file mount validation would run at step 3.5: after metadata fetch, before auto-injection.
But `resolveSource()` is called during step 8 (template resolution), and it already throws on missing sources for overrides.
This means file mount validation would happen twice:

- Once at step 3.5 (the new explicit validation)
- Once at step 8 (when `resolveSource()` is called during template resolution)

If the step 3.5 validation passes (key exists) but something changes between 3.5 and 8 (unlikely but possible: user deletes key, network filesystem flake), the error at step 8 would be a raw `resolveSource()` error, not the nice formatted message from step 3.5.

More importantly, if metadata fetch fails (network error, registry down), the user gets a MetadataFetchError but no SSH key validation error.
The existing fileExists check at Phase 0b runs before metadata fetch, so it catches the missing key even when the network is down.
Option A would lose this property: a network failure would mask the missing key error.

**Recommendation:** Use a hybrid approach. Keep the existing `fileExists` check in Phase 0b for the project-level devcontainer.json (it already works and is network-independent). Add the feature-level file mount validation after metadata fetch as a supplement, not a replacement. The Phase 4 cleanup should not remove the `fileExists` check until the feature metadata is the only source of truth and the pipeline ordering question is fully resolved.

Alternatively, if the goal is to truly eliminate `fileExists`, the validation should happen at step 7.5 (after MountPathResolver construction, before template resolution) and produce the nice error message there, using the same code path that `resolveSource()` would use.
This avoids the double-validation problem and produces a single, consistent error.

### Test Plan

Thorough and covers the right cases.
Two gaps:

**Non-blocking.** Missing test case: file mount with `recommendedSource` that is a directory (not a file).
Docker behavior differs for file vs. directory bind mounts, and `existsSync` returns true for both.
The mount resolver should check whether the source is a file (not a directory) when the declaration is a "file mount."
Otherwise, a user who accidentally creates a directory at `~/.ssh/lace_devcontainer.pub` (e.g., `mkdir -p ~/.ssh/lace_devcontainer.pub`) would pass validation but fail at Docker mount time with a confusing error.

**Non-blocking.** Missing test case: interaction between `--skip-validation` and `--skip-metadata-validation`.
If both are set, what happens to file mount validation for feature-level mounts?

### Implementation Phases

**Phase 3 (feature metadata update):** The proposal notes "This is a feature metadata change that requires a new feature version publish."
This is correct and represents a significant coupling: the lace CLI and the feature version must be coordinated.
If a user has lace v(current) and the new feature version, file mount validation would fire but the lace CLI wouldn't know about `fileMount: true` yet.
The `parseMountDeclarationEntry` function in `feature-metadata.ts` already silently drops unknown fields, so the `fileMount` flag would be ignored by old lace versions.
This is safe but means old lace versions would auto-create a directory at the default mount path instead of validating the file.
The proposal should document this forward-compatibility behavior.

**Phase 4 (project devcontainer.json cleanup):**

**Blocking.** The proposal acknowledges this is "a breaking change for contributors running without lace" and suggests adding a comment.
A comment is insufficient.
The current devcontainer.json works without lace: the static mount string and `fileExists` check are plain devcontainer spec features.
Removing them means contributors without lace would get:

- No SSH key validation (the `fileExists` check is gone)
- No SSH key mount (the static mount string is gone)
- A broken container (sshd starts but has no authorized_keys, so SSH connections fail silently)

The proposal should either:

1. Keep the static mount string in devcontainer.json alongside the auto-injected template (belt and suspenders), with a comment explaining that lace users get the template and non-lace users get the static string.
   The mount target conflict validation in `validateMountTargetConflicts()` would need to be taught to deduplicate.
2. Add a lace-free devcontainer.json variant (e.g., `.devcontainer/devcontainer.nolace.json`) that non-lace contributors can use.
3. Gate Phase 4 on lace adoption being complete for all contributors (not just the author).

Option 1 is the most pragmatic.

## Broader Architectural Observations

### The `fileMount` abstraction's relationship to Docker semantics

Docker bind mounts have a specific, important behavioral difference between file and directory mounts: when you bind-mount a path that does not exist on the host, Docker auto-creates it as a **directory** (not a file).
This means a missing SSH key file would result in Docker creating a directory at `~/.ssh/lace_devcontainer.pub`, which then silently breaks sshd (it tries to read a directory as a file).

The current `fileExists` check prevents this.
The proposal's file mount validation would also prevent this.
But the gap is `--skip-validation`: the proposal says validation errors are downgraded to warnings, and "the mount is still injected...but the missing source will cause a Docker bind-mount error."
In reality, Docker does NOT error on a missing bind-mount source; it creates a directory.
The container starts, sshd starts, but SSH authentication silently fails because `authorized_keys` is a directory.

This is worth documenting explicitly in the proposal as a known risk of `--skip-validation`, and the error message for file mount validation should warn about this Docker behavior.

### Is settings.json the right override surface?

The proposal uses `~/.config/lace/settings.json` for SSH key path overrides, which is the same mechanism as directory mount overrides.
This is reasonable for a single-project setup.
But the proposal notes (in the edge case section) that settings.json is global, not per-project.
For SSH keys this is "typically correct," but it creates a problem for the auto-management RFP, which envisions per-project or per-container key isolation.

If auto-management generates a unique key per project, the global settings.json cannot express that.
The proposal should note this as a known limitation that the auto-management RFP would need to solve (likely via per-project settings or a project-scoped override mechanism).

## Verdict

**Revise.**
The core idea (bring SSH key mount into the declarative system) is clearly the right direction, and the error UX improvement is substantial.
However, the `fileMount` API naming and structure need reconsideration, the pipeline ordering has unexamined failure modes, the feature ownership question should be explicitly acknowledged as a compromise, and Phase 4 needs a real migration path for non-lace contributors.

## Action Items

1. [blocking] Rename `fileMount: boolean` + `hint: string` to a `validation` sub-object (or similar) that expresses "source must pre-exist" without implying file-vs-directory semantics. This is more extensible and avoids confusion when the pattern is reused for pre-existing directories.
2. [blocking] Resolve the `recommendedSource` semantic change: either update the JSDoc to reflect its new dual role (informational + actual default for validated mounts), or introduce a separate `defaultSource` field.
3. [blocking] Address pipeline ordering: either adopt the hybrid approach (keep `fileExists` at Phase 0b, add feature-level validation post-metadata-fetch as supplement), or move validation to after MountPathResolver construction (step 7.5) to avoid double-validation and network-failure masking.
4. [blocking] Add a migration path for Phase 4: keep the static mount string in devcontainer.json for non-lace contributors, or defer Phase 4 until lace adoption is universal, or provide an alternative config file.
5. [blocking] Explicitly acknowledge the feature ownership compromise (same pattern as `hostSshPort`), document the intended future state (sshd wrapper feature owns both), and consider whether project-level declaration is simpler for now.
6. [non-blocking] Add a test case for source-is-directory-not-file: `existsSync` returns true for directories, so file mount validation should check `statSync().isFile()` when the declaration requires a file source.
7. [non-blocking] Document Docker's auto-create-directory behavior for missing bind-mount sources in the `--skip-validation` edge case, so users understand the silent failure mode.
8. [non-blocking] Note the global-vs-per-project settings.json limitation as a constraint the auto-management RFP must address.
9. [non-blocking] Clarify the stepping-stone relationship: state whether auto-generation is expected to be a `lace up` pre-hook or a separate `lace ssh` command, as this determines whether the "validation error" UX is a stepping stone or an obstacle.
10. [non-blocking] Document forward-compatibility: old lace versions will silently ignore `fileMount: true` in feature metadata, resulting in directory auto-creation instead of file validation.
