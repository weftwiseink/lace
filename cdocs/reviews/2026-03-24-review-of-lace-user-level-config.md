---
review_of: cdocs/proposals/2026-03-24-lace-user-level-config.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T16:00:00-07:00
task_list: lace/user-config-proposal
type: review
state: live
status: done
tags: [fresh_agent, architecture, security, test_plan, pipeline_integration]
---

# Review: Lace User-Level Config

## Summary Assessment

This proposal introduces `~/.config/lace/user.json` as a declarative mechanism for users to inject universal mounts, prebuild features, git identity, default shell, and environment variables into all lace-managed devcontainers.
The design is well-structured: the separation of concerns from `settings.json` is sound, the security model is principled (read-only enforcement, denylist, env-var-based git identity), and the merge semantics are clearly specified.
The most significant issue is that the pipeline integration description obscures a required code change to `validateMountNamespaces()`, which currently hardcodes "project" and feature short IDs as the only valid namespace prefixes: `user/` would be rejected.
There are also gaps in the denylist that weaken the security story, and the test plan needs a security-focused expansion.

Verdict: **Revise.**

## Section-by-Section Findings

### Frontmatter

**Non-blocking.**
The `first_authored.by` value `@claude-opus-4-6` should use the full API-valid model name per the frontmatter spec (e.g., `@claude-opus-4-6-20260324` or equivalent dated identifier).
The status is `wip`, which is appropriate for a proposal under review.

### BLUF

**Non-blocking.**
The BLUF is comprehensive and covers all key design decisions.
It could be tightened: at 7 lines plus 3 bullet links, it borders on a full abstract rather than a bottom-line summary.
The most important signal (security constraints and the three-RFP subsumption) is clear.

### Objective

No issues.
The seven requirements are well-scoped and specific.

### Background / Existing Pipeline Integration Points

**Blocking.**
The pipeline phase numbering in the Background section (phases 1-15) does not match the actual code structure in `up.ts`.
The code uses a different labeling convention: Phase 0a (workspace layout), Phase 0b (host validation), then a long sequence of unnumbered "Steps" (metadata fetch, auto-injection, mount template injection, variable resolution, mount validation, mount path resolution, template resolution, inferred mount validation, prebuild, repo mount resolution, config generation, devcontainer up).

The proposal then uses yet another numbering in the Pipeline Integration section (Phase 0a/0b/0c/1/2/3...) that also does not match the code.
This inconsistency makes it harder for implementers to locate the correct insertion point.

The actual insertion point should be after `loadSettings()` (Step 7 in the current code, around line 425-434 of `up.ts`) and before the mount namespace validation (Step 5.5), because:
1. User mount declarations need to exist in `mountDeclarations` before `validateMountNamespaces()` runs.
2. User features need to exist in `allRawFeatures` before `fetchAllFeatureMetadata()` runs.

This means user config loading must happen in two places, or more precisely, must happen early enough that its mounts and features are included in the respective data structures before those structures are consumed.
The proposal's claim that "from the perspective of phases 1 onward, user features and mounts are indistinguishable from project-declared ones" is the right goal, but the integration point needs to be specified more precisely against the actual code.

### Security Constraints: Path Denylist

**Blocking.**
The denylist has meaningful gaps that should be addressed or explicitly acknowledged:

1. **`~/.config/lace/settings.json` itself**: A user mount of `~/.config/lace/` would expose `settings.json`, which contains mount source paths (information about host filesystem layout). More critically, if settings.json is ever extended with sensitive data, this becomes a real leak. The denylist should block `~/.config/lace` or the proposal should explain why this is acceptable.

2. **`~/.local/share/keyrings/`** (GNOME Keyring), **`~/.password-store/`** (pass), **`~/.config/op/`** (1Password CLI): These are credential stores not covered by the current denylist. The research report acknowledges "new credential paths appear constantly" and recommends a constrained allowlist, but the proposal does not carry forward that nuance.

3. **`~/.netrc`**: Contains plaintext HTTP credentials used by curl, wget, and git.

4. **`~/.config/gh/hosts.yml`**: The denylist blocks `~/.config/gh/` but it is worth verifying the prefix match catches this (it should, given the path-prefix check).

5. **Symlink following**: If `~/innocent-dir/` contains a symlink to `~/.ssh/`, the denylist on `~/.ssh/` would not catch this. The proposal should state whether lace resolves symlinks before denylist checking, or note this as an accepted risk.

> NOTE(opus/review): The research report itself says "A denylist approach is fragile (new credential paths appear constantly)" and recommends a "constrained allowlist with escape hatch." The proposal chose the denylist without carrying forward the allowlist recommendation or explaining the deviation.

### Security Constraints: Home Directory Constraint

**Non-blocking.**
The proposal says "Absolute paths outside `$HOME` are rejected" but does not specify what happens with `$HOME` itself (i.e., `source: "~/"` or `source: "~/"`).
Mounting all of `$HOME` read-only would expose everything the denylist tries to protect.
The denylist check runs on the source path, so `~/` would not be prefix-matched by `~/.ssh/`.
Consider explicitly blocking `~/` and `~` as mount sources.

### Security Constraints: Feature Registry Requirement

**Non-blocking.**
The proposal says features must "contain `ghcr.io/`, `mcr.microsoft.com/`, or similar registry prefixes."
The word "similar" is vague.
The implementation should specify an exact allowlist or, better, block the known-dangerous patterns (local paths: `./`, `../`, absolute paths) and allow everything else, which is what the existing `isLocalPath()` function in `feature-metadata.ts` already does.
The proposal should reference this existing function explicitly.

### Security Constraints: Git Identity via Environment Variables

No issues.
This is a well-reasoned design decision with clear threat modeling.
The four environment variables (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`) are the correct set.

### Merge Semantics

**Non-blocking.**
The merge semantics table and Mermaid diagram are clear.
One edge case is underspecified: what happens when `user.json` declares a `containerEnv` key that the pipeline also auto-injects?
The `generateExtendedConfig()` function in `up.ts` (lines 930-940) auto-injects `CONTAINER_WORKSPACE_FOLDER` and `LACE_PROJECT_NAME` with a "no overwrite" guard (`if (!containerEnv.CONTAINER_WORKSPACE_FOLDER)`).
The proposal should clarify whether user `containerEnv` values participate in this precedence chain (they should, since user values should be overridable by project values but should override lace's auto-injected defaults).

### Pipeline Integration

**Blocking.**
The pipeline integration section claims user mounts integrate "directly with the existing `MountPathResolver` and `validateMountNamespaces()` infrastructure."
However, `validateMountNamespaces()` at line 329 of `template-resolver.ts` constructs its valid namespace set as:

```typescript
const validNamespaces = new Set(["project", ...featureShortIds]);
```

The `user/` namespace is not in this set.
User mounts with labels like `user/screenshots` would be rejected with "Unknown mount namespace(s)."

This is not a minor fix: the proposal must specify that `validateMountNamespaces()` needs to be extended to include `"user"` in its valid namespace set.
The Phase 4 constraints state "Do not modify `mount-resolver.ts` or `template-resolver.ts`", but the namespace validator in `template-resolver.ts` must be modified to accept the `user/` namespace.
This constraint is incorrect as stated.

Similarly, user mount source resolution differs from project mount source resolution.
Project mounts use `MountPathResolver.resolveSource()`, which auto-creates default directories under `~/.config/lace/<projectId>/mounts/`.
User mounts declare their own source paths (no auto-creation, with missing-source-as-warning semantics).
The proposal should explain whether user mounts go through `MountPathResolver` at all, or whether they are converted to raw mount spec strings before that step.

### File Discovery

No issues.
The pattern mirrors `findSettingsConfig()` exactly and the error semantics are appropriate.

### Chezmoi Integration

**Non-blocking.**
The chezmoi template example uses Go template conditionals inside JSONC, which produces invalid JSON when the conditional falls through without an `else` clause.
For example, if `chezmoi.os` is neither "linux" nor "darwin", the `mounts` object would contain no entries but might have a trailing comma or broken structure depending on template rendering.
A safer pattern would include a default `else` clause or use chezmoi's `toJson` function.

### Design Decisions

All five decisions are well-reasoned with clear rationale.
Decision 4 (user features as prebuild features, with fallback to top-level) is the most nuanced and is handled correctly.

### Edge Cases

**Non-blocking.**
The "Missing mount source on host" edge case correctly identifies the asymmetry between user mounts (warning + skip) and project mounts (error).
One missing edge case: what happens if `user.json` declares a mount with a `target` that contains devcontainer variables (e.g., `target: "/home/${_REMOTE_USER}/notes"`)?
The existing variable resolution happens in `MountPathResolver` using `containerVars`, but if user mounts bypass `MountPathResolver`, variable resolution would not occur.
If user mounts do go through `MountPathResolver`, the variable resolution path is covered.
The proposal should clarify this.

Another missing edge case: what happens if the same `containerEnv` key appears in both user `containerEnv` and user `git` identity injection?
For example, if `user.json` has both `"git": { "name": "Jane" }` and `"containerEnv": { "GIT_AUTHOR_NAME": "Different Name" }`.
Which wins?

### Test Plan

**Blocking.**
The test plan is structured but lacks security-focused testing proportional to the threat surface:

1. **No symlink traversal tests**: The denylist check should be tested with symlinks that resolve to denied paths.
2. **No path canonicalization tests**: What about `~/.ssh/../.ssh/`, `~/./Documents/../.ssh/`, or `~/.SSH/` (case sensitivity)?
3. **No tilde expansion edge cases**: What about `~/` alone (home directory mount)?
4. **No test for user mount + project mount with same label but different namespace**: e.g., `user/config` and `project/config` targeting different paths.
5. **No negative test for `user/` namespace acceptance**: The test plan should explicitly verify that `validateMountNamespaces()` accepts the `user/` prefix after the required modification.
6. **No test for the containerEnv precedence chain**: user env -> project env -> auto-injected env.

### Implementation Phases

**Blocking (Phase 4 constraint).**
Phase 4 states:
> Do not modify `mount-resolver.ts` or `template-resolver.ts` (user mounts integrate via the existing declaration system).

This is incorrect.
`template-resolver.ts` contains `validateMountNamespaces()` which must be modified to accept `user/` as a valid namespace.
The constraint should be narrowed: "Do not modify the mount resolution logic in `mount-resolver.ts` or the template resolution logic in `template-resolver.ts`, but update `validateMountNamespaces()` to include `user/` as a valid namespace prefix."

### Open Questions

The five open questions are relevant.
Questions 1 (repoMounts in user config) and 3 (defaultShell mechanism) are the most impactful for implementation scope.
Missing question: should `user.json` support JSONC comments?
The text says "A new JSONC file" but the file extension is `.json`, which some editors will not recognize as JSONC.
Using `.jsonc` as the extension, or documenting the JSONC parsing explicitly, would reduce user confusion.

## Verdict

**Revise.**
The proposal is fundamentally sound and addresses a real gap in lace's config story.
The security model is principled and the merge semantics are well-specified.
However, the pipeline integration has a concrete correctness issue (namespace validation rejects `user/`), the implementation constraints are self-contradictory, and the security denylist has gaps that should be addressed for a security-critical feature.

## Action Items

1. [blocking] Fix the pipeline integration section to accurately describe the insertion point against the actual `up.ts` code structure, not the idealized phase numbering from the Background section.
2. [blocking] Acknowledge that `validateMountNamespaces()` in `template-resolver.ts` must be modified to accept `user/` as a valid namespace, and remove or correct the Phase 4 constraint that says "do not modify `template-resolver.ts`."
3. [blocking] Expand the denylist to include `~/.netrc`, `~/.local/share/keyrings/`, `~/.password-store/`, and consider blocking `~/` (home directory root) as a mount source. Alternatively, explicitly document these as accepted risks with rationale.
4. [blocking] Add security-focused test cases: symlink traversal, path canonicalization, home directory root mount, `user/` namespace acceptance validation, and containerEnv precedence chain.
5. [non-blocking] Clarify whether user mounts go through `MountPathResolver` (and thus get variable resolution in targets) or are converted to raw mount spec strings before that step.
6. [non-blocking] Specify the precedence when `user.json` git identity and `user.json` containerEnv declare conflicting keys (e.g., both set `GIT_AUTHOR_NAME`).
7. [non-blocking] Tighten the feature registry requirement: reference the existing `isLocalPath()` function in `feature-metadata.ts` rather than using vague "similar registry prefixes" language.
8. [non-blocking] Address the symlink-following gap in the denylist: state whether `realpath()` is called before denylist checking, or document this as an accepted risk.
9. [non-blocking] Fix the chezmoi template example to handle the default case (neither Linux nor macOS) safely.
10. [non-blocking] Clarify JSONC support: the file is described as JSONC but named `.json`. Either use `.jsonc` extension or document that JSONC parsing is used regardless of extension.
