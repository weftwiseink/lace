---
review_of: cdocs/proposals/2026-03-24-lace-user-level-config.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T17:30:00-07:00
task_list: lace/user-config-proposal
type: review
state: live
status: done
tags: [rereview_agent, architecture, security, pipeline_integration, test_plan]
---

# Review (Round 2): Lace User-Level Config

## Summary Assessment

This proposal designs `~/.config/lace/user.json` for declarative user-level mounts, features, git identity, shell, and environment variables across all lace containers.
All four blocking issues from the round 1 review have been addressed: the pipeline table now matches actual `up.ts` code with accurate line numbers, the `validateMountNamespaces()` modification is explicitly called out, the denylist has been expanded with `~/`, `~/.netrc`, keyring paths, and symlink traversal handling, and the test plan covers security scenarios.
One non-blocking inconsistency remains in the implementation phases: Phase 4 sub-step 3 references merging into `configForResolution` when it should reference `mountDeclarations`.

Verdict: **Accept.**

## Round 1 Blocking Issue Resolution

### Issue 1: Pipeline phase numbering mismatch

**Resolved.**
The Background section (lines 57-83) now contains a detailed table mapping each pipeline step to its actual line number in `up.ts`.
I verified every entry against the code:
- Phase 0a at line 178, Phase 0b at line 214, Step 1 at line 270, Step 2 at line 335, Step 3 at line 341, Step 4 at line 348, Step 4.5 at line 356, Step 5 at line 364, Step 5.5 at line 378, Step 6 at line 414, Step 7 at line 424, Step 7.5 at line 438, Step 8 at line 474, Post-8 at line 538, Prebuild at line 597, Repo mounts at line 621, Generate at line 647, Drift at line 673, Up at line 715, Verify at line 745.
All line numbers match.

The Pipeline Integration section (lines 281-304) correctly identifies the insertion point between Phase 0b (line 243) and Step 1 (line 270), and the sub-steps within Phase 0c have parenthetical timing qualifiers that make the logical ordering clear.

### Issue 2: validateMountNamespaces() rejects "user/" namespace

**Resolved.**
A dedicated subsection "Required modification to `validateMountNamespaces()`" (lines 306-321) now explicitly identifies the code at `template-resolver.ts:329`, shows the current namespace set construction, and specifies the one-line change to add `"user"`.
The Phase 4 constraints (line 683) have been corrected: "Do not modify mount resolution logic in `mount-resolver.ts` or template resolution logic in `template-resolver.ts`, but DO update `validateMountNamespaces()` in `template-resolver.ts` to include `\"user\"` in the valid namespace set."
The round 1 self-contradiction is eliminated.

### Issue 3: Security denylist gaps

**Resolved.**
The denylist (lines 172-191) now includes all paths the round 1 review requested:
- `~/` (home directory root, preventing bypass of all other entries)
- `~/.netrc` (plaintext HTTP credentials)
- `~/.local/share/keyrings` (GNOME Keyring)
- `~/.password-store` (pass GPG-based password manager)
- `~/.config/op` (1Password CLI)
- `/var/run/docker.sock` and `/run/docker.sock`

A new "Symlink traversal" section (lines 199-210) specifies that `realpath()` is called before denylist checking, with appropriate handling for broken symlinks and an honest NOTE callout about the accepted risk of symlinks created inside the mounted directory after container start.
The "Home directory constraint" section (lines 212-215) blocks absolute paths outside `$HOME`.

### Issue 4: Test plan security expansion

**Resolved.**
The test plan now includes:
- Test section 2 (lines 531-537): denylist coverage for all new entries including `~/.netrc`, keyrings, password-store, `~/.config/op`, home directory root, and paths outside `$HOME`.
- Test section 3 (lines 539-543): symlink traversal tests with `realpath()`.
- Test section 4 (lines 545-548): path canonicalization tests (`~/.ssh/../.ssh/`, `~/./Documents/../.ssh/`).
- Test section 8 (lines 569-571): `validateMountNamespaces()` accepts `user/` namespace.
- Test section 6 (line 559): containerEnv precedence chain.

The case-sensitivity edge case (`~/.SSH/` on case-sensitive filesystems) is documented as an accepted risk at line 548.

## Round 1 Non-Blocking Issue Resolution

1. **User mounts through MountPathResolver** (item 5): Resolved. Lines 324-327 clarify that user mounts go through `MountPathResolver`, get variable resolution, and handle missing sources with warning + skip.
2. **Git identity vs containerEnv conflict** (item 6): Resolved. Lines 491-494 specify git identity wins, with rationale.
3. **Feature registry requirement** (item 7): Resolved. Lines 219-222 reference `isLocalPath()` from `feature-metadata.ts` explicitly.
4. **Symlink following** (item 8): Resolved. Lines 199-210 specify `realpath()` with a NOTE callout.
5. **Chezmoi template default case** (item 9): Resolved. Lines 369-372 use `ternary` function and `toJson`. NOTE at lines 385-386 explains the safety improvement.
6. **JSONC support clarity** (item 10): Resolved. Open question 6 (line 710) explicitly addresses this, recommending `.json` with documented JSONC parsing.
7. **Frontmatter `first_authored.by`** (frontmatter item): Not addressed. Still `@claude-opus-4-6` rather than a full dated model name. This remains non-blocking.

## New Findings

### Phase 4 implementation sub-step references `configForResolution` instead of `mountDeclarations`

**Non-blocking.**
Implementation Phase 4 sub-step 3 (line 674) says "Merge user mounts into `configForResolution` via `mergeUserMounts()`."
However, `configForResolution` is the raw devcontainer config object (created at line 342 of `up.ts`).
User mounts should be merged into `mountDeclarations` (the declarations map created by `autoInjectMountTemplates()` at line 350 of `up.ts`), since `extractProjectMountDeclarations()` reads from `config.customizations.lace.mounts` and prefixes with `project/`: it would not pick up user mounts.

The Pipeline Integration section (line 294) correctly says "Merge user mounts into mountDeclarations (before validateMountNamespaces)."
The Implementation Phase 4 sub-step should match: replace `configForResolution` with `mountDeclarations`.
This is a documentation inconsistency, not a design flaw: an implementer reading both sections together would identify the correct target.

### Phase 0c timing is logically split across the pipeline

**Non-blocking.**
Phase 0c is described as a single block "inserted at ~line 245", but its sub-steps span different points:
- Sub-steps 1-4 and 7-8 (load, validate, merge features, inject env) can happen at ~line 245.
- Sub-step 5 (merge user features into `allRawFeatures`) must happen before line 260 where `allRawFeatures` is constructed, which is consistent.
- Sub-step 6 (merge user mounts into `mountDeclarations`) must happen after Step 4 (line 350) creates `mountDeclarations`.

The parenthetical qualifiers "(before fetchAllFeatureMetadata)" and "(before validateMountNamespaces)" make this clear enough for an experienced implementer.
A future revision could make this split explicit (e.g., "Phase 0c loads and validates; mount merging happens between Step 4.5 and Step 5.5").

### Open question 6 deserves a firm recommendation

**Non-blocking.**
Open question 6 (`.json` vs `.jsonc` extension) includes a recommendation but frames it as a question.
Since the proposal already states "A new JSONC file at `~/.config/lace/user.json`" (line 101) and the recommendation matches `devcontainer.json` precedent, this could be moved from Open Questions to a Design Decision.

## Verdict

**Accept.**

All four round 1 blocking issues have been thoroughly addressed.
The pipeline integration now accurately maps to the actual codebase with verified line numbers.
The security model is comprehensive: the denylist covers credential stores, symlink traversal is handled via `realpath()`, and the home directory root is explicitly blocked.
The test plan is proportional to the threat surface.

The remaining non-blocking items (Phase 4 `configForResolution` vs `mountDeclarations` naming, Phase 0c timing split, frontmatter model name) are minor and do not affect the soundness of the design.
The proposal is ready for implementation.

## Action Items

1. [non-blocking] In Implementation Phase 4 sub-step 3 (line 674), change "Merge user mounts into `configForResolution`" to "Merge user mounts into `mountDeclarations`" to match the Pipeline Integration section.
2. [non-blocking] Consider making the Phase 0c timing split explicit: loading/validation at ~line 245, mount merging between Step 4.5 and Step 5.5.
3. [non-blocking] Update `first_authored.by` from `@claude-opus-4-6` to the full dated model name per frontmatter spec.
4. [non-blocking] Consider promoting open question 6 (`.json` extension with JSONC parsing) to a Design Decision, since the proposal already commits to this choice.
