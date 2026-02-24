---
review_of: cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-24T18:30:00-06:00
task_list: lace/wezterm-server
type: review
state: live
status: done
tags: [rereview_agent, architecture, ssh, mount-templates, api_surface, pipeline_ordering, deduplication, forward_compatibility]
---

# Review (Round 2): Validated Mount Declarations with SSH Key Support

## Summary Assessment

This revision addresses all five blocking issues from round 1 with thoughtful, well-reasoned changes.
The `sourceMustBe` enum is a clear improvement over `fileMount: boolean`, the hybrid pipeline ordering properly handles the network failure masking concern, and the belt-and-suspenders approach for non-lace contributors is pragmatic.
The proposal is now thorough, internally consistent, and implementation-ready with two minor gaps: the mount target deduplication logic (Phase 4) needs slightly more specification, and the `statSync()` approach has a symlink edge case worth documenting.
Verdict: **Accept** with non-blocking suggestions.

## Round 1 Findings: Disposition

### 1. API renamed from `fileMount: boolean` to `sourceMustBe: "file" | "directory"` (was blocking)

**Resolved.** The `sourceMustBe` enum is a strict improvement.
It directly expresses the constraint rather than conflating file-vs-directory with must-pre-exist.
The "Important Design Decisions" section (renamed from the original) explains the rationale clearly: a boolean conflates two concerns, a sub-object adds nesting for a single dimension, and the enum is self-documenting.
The proposal also correctly notes that future validation needs (permissions, content checks) can be added as additional fields without restructuring.

One observation: the round 1 review suggested a `validation` sub-object as an alternative.
The proposal's reasoning for rejecting that (single dimension, flat is better, extensible via sibling fields) is sound.
The `sourceMustBe` name reads naturally in both the "file" and "directory" cases, which was the core objection to `fileMount`.

### 2. `recommendedSource` JSDoc updated for dual role (was blocking)

**Resolved.** The updated JSDoc in the interface definition (Section 1) now reads: "When `sourceMustBe` is set, also serves as the default source path (expanded via tilde expansion) if no settings override is configured."
This is clear and explicit about the behavioral change.

The "Important Design Decisions" section documents the rationale: auto-derived paths under `~/.config/lace/.../mounts/` make no sense for externally managed files.
The NOTE callout acknowledges the previous JSDoc said "never used as actual source" and states this is no longer true for validated mounts.

The proposal chose to keep `recommendedSource` serving double duty rather than introducing a separate `defaultSource` field.
This is the right call for now: the two paths are identical for every foreseeable use case, and introducing a separate field would create a new consistency hazard (what happens when `defaultSource` and `recommendedSource` differ?).

### 3. Hybrid pipeline ordering (was blocking)

**Resolved.** The proposal adopts the hybrid approach recommended in round 1: keep `fileExists` at Phase 0b as a network-independent safety net, add feature-level validation after metadata fetch as a supplement.
The "Important Design Decisions" section explains the failure mode clearly: if metadata fetch fails, the user loses the feature-level validation, but Phase 0b still catches the missing key.

Phase 2 in the implementation phases is well-specified: it runs after metadata fetch and auto-injection, uses the same `CheckResult` format as `runHostValidation()`, and is explicitly described as a supplement, not a replacement.
The `--skip-validation` interaction is documented correctly: Phase 0b is downgraded to warning, feature-level validation follows the same pattern.

The edge case section for `--skip-validation + --skip-metadata-validation` interaction is a good addition that was not in the original draft.

### 4. Static mount kept for non-lace contributors + target deduplication (was blocking)

**Resolved.** The proposal keeps the static mount string in devcontainer.json (belt-and-suspenders) and adds a deduplication phase (Phase 4) to handle the conflict when both the auto-injected mount and the static mount target the same container path.

The deduplication rule is clear: auto-injected wins, static mount dropped with debug log.
The constraint that two auto-injected mounts with the same target remain an error, and two static mounts with the same target remain an error, is the right distinction.
See Finding 1 below for a specification gap.

### 5. Feature ownership acknowledged as pragmatic compromise (was blocking)

**Resolved.** The NOTE callout in Section 3 of "Important Design Decisions" explicitly acknowledges this is the same compromise as `hostSshPort`, names the intended future state (sshd wrapper feature owns both), and references the existing TODO in the feature's `devcontainer-feature.json`.
This is sufficient: the compromise is documented, the migration path is named, and the reader understands this is a known debt.

## New Findings

### Finding 1: Phase 4 deduplication needs a target extraction strategy for static mount strings

**Non-blocking.** Phase 4 says `validateMountTargetConflicts()` is updated to detect when an auto-injected mount and a static mount share the same container target.
The auto-injected mounts have structured `LaceMountDeclaration` objects with a `target` field, but static mount strings are raw comma-separated strings like:

```
source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly
```

To detect the conflict, the deduplication logic must parse the `target=` segment out of static mount strings.
This is straightforward (split on commas, find the `target=` part), but the proposal does not specify how static mount strings are parsed for target extraction.

Additionally, the devcontainer spec allows both comma-separated strings and structured objects in the `mounts` array.
The parser should handle both forms.

**Recommendation:** Add a brief note to Phase 4 specifying that static mount strings are parsed for their `target=` segment, and that structured mount objects (the alternate devcontainer spec form) are handled by reading the `target` property directly.
This does not need to be a full specification; a one-line note that the implementation must handle both forms is sufficient.

### Finding 2: `statSync()` follows symlinks; consider documenting this

**Non-blocking.** The proposal uses `statSync().isFile()` to validate that the source exists and is a file.
`statSync()` follows symlinks (unlike `lstatSync()`), which means a symlink pointing to a file will pass validation, and a symlink pointing to a directory (or a broken symlink) will fail.

This is almost certainly the desired behavior: if a user symlinks `~/.config/lace/ssh/id_ed25519.pub` to their actual key, validation should pass.
A broken symlink should fail with a "file not found" error (since `statSync()` throws `ENOENT` for broken symlinks, which is handled the same as a missing file).

The one subtle case: a symlink pointing to a directory would fail with "expected file but found directory," which is correct but might confuse a user who sees a symlink at the expected path and doesn't realize it points to a directory.
This is an edge case not worth special-casing, but a brief mention in the edge cases section ("symlinks are followed; a symlink to a file passes, a broken symlink fails as missing") would preempt questions during implementation.

### Finding 3: Path migration from `~/.ssh/` to `~/.config/lace/ssh/` deserves a migration note in Phase 5

**Non-blocking.** Phase 5 changes the expected key location from `~/.ssh/lace_devcontainer.pub` to `~/.config/lace/ssh/id_ed25519.pub`.
The proposal mentions "Users with keys at the old location can use a settings override" and Phase 5 says "Add a comment noting the migration from the old path."

This is adequate from a technical perspective, but the user experience of the migration deserves slightly more attention.
Existing users who run `lace up` after the update will see an error for a key they already have: it just lives at the old path.
The error message (from the feature-level validation) will tell them to either create a new key at the new path or configure a settings override.
Both options work, but neither is "do nothing," which is what users expect from a patch update.

**Recommendation:** Consider having Phase 5 check both paths during a transition period: if the new path is missing but the old path exists, emit a deprecation warning pointing the user to the settings override mechanism rather than a hard error.
This is a UX polish item, not a design concern, and can be handled during implementation.

### Finding 4: The `hint` field's `chmod 700` command creates the directory if it does not exist

**Non-blocking.** The hint in the feature metadata is:

```
ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh
```

`ssh-keygen` will fail if `~/.config/lace/ssh/` does not exist.
The user would need to `mkdir -p ~/.config/lace/ssh` first, or the hint should include it:

```
mkdir -p ~/.config/lace/ssh && ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N '' && chmod 700 ~/.config/lace/ssh
```

This is a small but important detail: a user following the exact command from the error message should not hit a secondary error.

### Finding 5: Forward compatibility section is accurate and well-reasoned

**No issue.** The forward compatibility analysis matches the actual code.
I verified that `parseMountDeclarationEntry()` (lines 579-600 of `feature-metadata.ts`) explicitly picks only known fields (`target`, `recommendedSource`, `description`, `readonly`, `type`, `consistency`) and discards everything else.
The `sourceMustBe` and `hint` fields would be silently dropped by old lace versions, resulting in the directory auto-creation behavior described in the proposal.
The `fileExists` check at Phase 0b (preserved in devcontainer.json) catches this for the lace project itself, as the proposal notes.

The one subtlety: old lace versions would auto-create a directory at the auto-derived path (`~/.config/lace/<projectId>/mounts/wezterm-server/authorized-keys/`), not at `~/.config/lace/ssh/id_ed25519.pub`.
This directory would be harmless but orphaned.
This is not worth documenting because old lace versions with new feature metadata is inherently a transitional state.

### Finding 6: `--skip-validation` Docker auto-create warning is actionable

**No issue.** The warning message:

```
WARNING: wezterm-server/authorized-keys source missing. Docker will create a
         directory at this path, which will silently break SSH authentication.
```

This is clear, specific, and explains the consequence.
Users who use `--skip-validation` are opting into risk and this warning gives them the information they need.

### Finding 7: Test plan covers the right cases

**No issue.** The test plan addresses all the cases from the round 1 non-blocking items:
- Source-is-directory-not-file (via `statSync().isFile()` / `statSync().isDirectory()`)
- `--skip-validation` + `--skip-metadata-validation` interaction
- Metadata fetch failure graceful skip
- Target deduplication (auto-injected vs. static)

The test plan is comprehensive and maps cleanly to the implementation phases.

## Verdict

**Accept.**

All five blocking issues from round 1 are resolved with well-reasoned design decisions.
The `sourceMustBe` enum is clean and extensible, the hybrid pipeline ordering properly handles network failures, the belt-and-suspenders approach is pragmatic, and the feature ownership compromise is documented honestly.
The remaining findings are all non-blocking polish items that can be addressed during implementation.

## Action Items

1. [non-blocking] Add a note to Phase 4 specifying that static mount strings must be parsed for their `target=` segment, and that structured mount objects are handled by reading the `target` property directly.
2. [non-blocking] Add a brief note to the edge cases section that `statSync()` follows symlinks (symlink to file passes, broken symlink fails as missing).
3. [non-blocking] Consider a transition-period check in Phase 5 that detects the old key path and emits a deprecation warning rather than a hard error.
4. [non-blocking] Update the `hint` command to include `mkdir -p ~/.config/lace/ssh` before `ssh-keygen`, so the command works even when the directory does not exist.
