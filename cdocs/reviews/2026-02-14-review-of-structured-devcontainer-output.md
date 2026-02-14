---
review_of: cdocs/proposals/2026-02-14-structured-devcontainer-output.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-14T18:00:00-08:00
task_list: lace/structured-output
type: review
state: live
status: done
rounds:
  - round: 1
    by: "@claude-opus-4-6"
    at: 2026-02-14T18:00:00-08:00
    verdict: revise
  - round: 2
    by: "@claude-opus-4-6"
    at: 2026-02-14T21:00:00-08:00
    verdict: accept
tags: [fresh_agent, rereview_agent, architecture, mounts, validation, test_plan, spec_accuracy, backward_compatibility, postCreateCommand]
---

# Review: Structured Devcontainer.json Output

## Summary Assessment

This proposal refactors lace's config generation pipeline to prefer typed intermediate representations and structured JSON output where the devcontainer specification permits. The architecture is well-motivated and the three-layer mount model (internal representation, devcontainer mount interface, output serialization) is clean. However, the proposal has several issues: the `parseMountString` function does not validate the `source` field despite declaring it required in the `DevcontainerMount` interface (the spec marks `source` as optional); the `postCreateCommand` object format conversion has a semantic correctness problem -- the object format runs tasks in parallel, not sequentially, which changes the execution semantics of the user's original command when combined with lace's symlinks; the proposal's claim about `existing.join(" ")` being lossy for array-format commands understates the problem -- the current code already has this bug and the proposal's fix is incomplete; and the mount string parser's strict rejection of unknown parameters will break forward compatibility with future Docker mount options. Verdict: **Revise** -- all blocking issues are bounded and fixable.

## Section-by-Section Findings

### Spec Accuracy (Section: Specification Constraints)

**Finding 1 (non-blocking): The BLUF and body correctly identify the `additionalProperties: false` constraint on mount objects.**

The research report at line 62 confirms `"required": ["type", "target"]` and `"additionalProperties": false`. The proposal correctly concludes that `readonly` mounts MUST stay as strings. The claim is accurate and well-supported by the research report.

**Finding 2 (blocking): The `parseMountString` function requires `source` but the spec does not.**

The Mount JSON schema (research report line 62) shows `"required": ["type", "target"]` -- `source` is NOT required. Volume mounts can omit `source` (Docker auto-generates an anonymous volume name). The `DevcontainerMount` interface at proposal line 73 declares `source: string` as required (not optional), and `parseMountString` at line 140 casts `mount as DevcontainerMount` without checking for `source`. This means:

1. A valid mount string `"type=volume,target=/data"` would pass through `parseMountString` but the resulting object would have `source: undefined` while the TypeScript type claims `source: string`. This is a type unsoundness.
2. The `serializeMount` function at line 100 accesses `mount.source` unconditionally, which would produce `"source=undefined"` in the serialized string.

Fix: Make `source` optional in `DevcontainerMount` (`source?: string`), handle the missing-source case in `mountToString` and `serializeMount`, and only validate source presence for bind mounts (where it is semantically required even though the schema does not enforce it).

**Finding 3 (non-blocking): The research report's recommendation 1 says "continue generating string-format mounts" but the proposal deliberately moves away from that.**

The research report at line 542 recommends continuing with string-format mounts, citing the `readonly` requirement. The proposal correctly identifies this as overly conservative -- mounts without `readonly` can benefit from object format. The proposal's approach of auto-selecting format via `serializeMount()` is a well-reasoned evolution beyond the research report's recommendation. This is not a conflict; the proposal has more nuanced analysis than the research report.

### Mount String Parser (Section: Mount String Parser)

**Finding 4 (blocking): The strict rejection of unknown parameters breaks forward compatibility.**

The parser at proposal line 135 throws `MountsError("Unknown mount parameter: ${key}")` for any key not in the known set. This will break if:
- Docker adds new mount parameters (e.g., `bind-recursive` support was added relatively recently)
- Users use mount parameters that lace's parser does not yet know about (e.g., `volume-opt`, `volume-driver`, `volume-nocopy`, `bind-propagation`)

The research report at lines 86-110 documents many valid Docker mount parameters that the proposal's parser does NOT handle: `bind-propagation`, `bind-recursive`, `volume-driver`, `volume-opt`, `volume-nocopy`, `volume-subpath`. A user mount string like `"type=bind,source=/foo,target=/bar,bind-propagation=shared"` would cause `lace up` to fail with an error, even though it is a perfectly valid Docker mount string.

Open Question 1 in the proposal (line 469) acknowledges this tradeoff but recommends "strict with an escape hatch." The escape hatch (skipping validation via annotation) is not specified in enough detail -- how would a user annotate a mount to skip validation? In a JSON array, there is no natural place for annotations.

Fix: The parser should preserve unknown key-value pairs as an `extras: Record<string, string | undefined>` field rather than rejecting them. The `serializeMount` function would always serialize mounts with extras as strings (since the object format cannot represent them). This achieves the validation benefit (type, source, target are checked) without breaking forward compatibility. Emit a warning for unknown parameters instead of an error.

**Finding 5 (non-blocking): The `MOUNT_KEY_ALIASES` constant is referenced but not defined in the proposal.**

Proposal line 129 references `MOUNT_KEY_ALIASES[key] ?? key` but the alias map is not shown. The research report at line 117 shows the devcontainer CLI's normalization: `src -> source`, `destination -> target`, `dst -> target`. The proposal should include the alias map definition or reference the research report's mapping. Additionally, the `ro` alias for `readonly` (mentioned in the test plan at line 250) should be included in the alias map.

**Finding 6 (non-blocking): The parser does not handle the `readonly` flag's valueless form correctly.**

The `readonly` mount parameter is a flag -- it has no `=value` part. In the parser at line 126, `const [key, ...valueParts] = part.split("=")` would produce `key = "readonly"` and `valueParts = []`, so `value = ""` (empty string from `valueParts.join("=")`). The `switch` at line 133 sets `mount.readonly = true` regardless of `value`, which is correct. But the `ro` alias (test plan line 250) would need the same flag treatment -- `part.split("=")` on `"ro"` produces `key = "ro"` and `value = ""`, which should work after alias normalization. This is fine but subtle; a comment in the implementation would help.

### postCreateCommand Object Format (Section: postCreateCommand Object Format)

**Finding 7 (blocking): The object format runs tasks in parallel, which changes the execution semantics.**

The devcontainer spec (research report line 248) states that object-format lifecycle commands run tasks "in parallel with no ordering guarantees." The proposal converts:

```json
"postCreateCommand": "git config --global --add safe.directory '*' && mkdir -p ... && ln -s ..."
```

To:

```json
"postCreateCommand": {
  "user-setup": "git config --global --add safe.directory '*'",
  "lace-symlinks": "mkdir -p ... && rm -f ... && ln -s ..."
}
```

This changes the semantics: the original single-string command guaranteed sequential execution (`git config` before `mkdir/ln`). The object format runs `user-setup` and `lace-symlinks` in parallel. In this specific case, the two tasks are likely independent, so parallel execution is safe. But the proposal generalizes this to ALL user `postCreateCommand` strings, and the general case is NOT safe.

Consider a user `postCreateCommand` like: `"npm install && npm run build"`. Converting to `{ "user-setup": "npm install && npm run build", "lace-symlinks": "..." }` is correct (the user's original command stays intact as one string). However, the proposal at line 401 says: "When user has string postCreateCommand and lace adds symlinks: output is `{ "user-setup": "<original>", "lace-symlinks": "<symlink commands>" }`." The success criteria imply the original string is preserved as a single task, which IS correct.

But there is a deeper issue: what if the user's `postCreateCommand` depends on the symlinks being present? Or vice versa? The current `&&` chaining guarantees the user command runs first, then symlinks. The object format provides no ordering guarantee. If a user's `postCreateCommand` references a path created by a symlink, the parallel execution could race.

In practice, lace's symlink commands create symlinks from default mount locations to override targets, and user commands typically do not reference these paths. But the proposal should acknowledge this semantic change explicitly and document that parallel execution is safe because lace symlinks and user commands operate on independent paths.

**Finding 8 (blocking): The existing array-format handling is lossy, and the proposal's fix is incomplete.**

The current code at `up.ts:480` does `existing.join(" ")`, which the proposal correctly identifies as lossy (line 213). The array format `["npm", "install"]` is a single command with no shell -- `join(" ")` converts it to a shell string `"npm install"`, which is semantically different (shell expansion, different quoting rules).

The proposal's success criteria at line 402 says: "When user has array postCreateCommand and lace adds symlinks: output is `{ "user-setup": ["cmd", "args"], "lace-symlinks": "<symlink commands>" }`." This preserves the array format under the `user-setup` key, which is correct -- the object format's values can be arrays.

However, the proposal does not address the case where the user's array command has arguments containing spaces. Array format `["echo", "hello world"]` passed as `["echo", "hello world"]` in the object is fine. But if the implementation uses the current `join(" ")` pattern as a fallback anywhere, it would produce `"echo hello world"` which is semantically different. The implementation must ensure the array is passed through as-is, never joined. The code sample in the proposal does not show the implementation, only the types and success criteria.

**Finding 9 (non-blocking): The proposal does not handle the edge case where the user's postCreateCommand is already an object with a "lace-symlinks" key.**

If the user has:
```json
"postCreateCommand": { "lace-symlinks": "echo custom", "other": "echo task" }
```

The proposal's approach (line 486-488 in current code, and implied by the success criteria at line 403) does `{ ...existing, "lace-symlinks": ... }`. The spread would be overwritten by lace's `lace-symlinks` key, silently dropping the user's task named `lace-symlinks`. This is unlikely but worth documenting as a known limitation or using a more specific key like `lace:symlinks` (colons are valid in JSON keys).

### Completeness of String Micro-Format Coverage (Section: Current State)

**Finding 10 (non-blocking): The proposal correctly identifies all string micro-formats in the codebase.**

Verified against the source files:
- `mounts.ts:285-297`: `generateMountSpec()` produces `type=bind,source=...,target=...[,readonly]` -- correctly identified.
- `template-resolver.ts`: `appPort` strings like `"${lace.port(...)}: 2222"` -- correctly identified at proposal line 28.
- `.devcontainer/devcontainer.json`: `workspaceMount` at line 90, 4 string mounts at lines 77-84, `postCreateCommand` at line 92 -- all correctly identified.
- `up.ts:471-490`: postCreateCommand merging via `&&` -- correctly identified.

No string micro-formats are missing from the proposal's inventory.

**Finding 11 (non-blocking): The proposal does not address template variables in generated mounts (only in user-authored mounts).**

The proposal's edge case section (line 205) discusses `${localEnv:...}` in user-authored mount strings. However, the lace-generated mounts from `generateMountSpec()` do NOT use template variables -- they use resolved host paths. This is correctly excluded from the template variable handling. Noting this for completeness.

### Template Variable Handling (Section: Edge Cases / Challenging Scenarios)

**Finding 12 (non-blocking): The template variable detection pattern `${...}` is overly broad.**

The proposal at line 206 says the parser should "detect `${...}` patterns in source/target values" and skip validation. The pattern `${...}` would also match shell variables like `${HOME}` (which are not devcontainer template variables and would not be substituted). This is acceptable as a conservative approach -- skipping validation for any `${...}` pattern is safe (false negatives in validation are better than false positives). But the proposal should note that this is intentionally over-inclusive.

The devcontainer template variables are specifically: `${localEnv:NAME}`, `${containerEnv:NAME}`, `${localWorkspaceFolder}`, `${containerWorkspaceFolder}`, `${localWorkspaceFolderBasename}`, `${containerWorkspaceFolderBasename}`, `${devcontainerId}` (research report lines 389-396). A more precise pattern would be `/\$\{(localEnv|containerEnv|localWorkspace|containerWorkspace|devcontainerId)/`, but the broader `${...}` is simpler and safer.

### Implementation Phases (Section: Implementation Phases)

**Finding 13 (non-blocking): Phase ordering and dependencies are correctly structured.**

Phase 1 (types + parser) has no external dependencies. Phase 2 (structured output) depends on Phase 1. Phase 3 (postCreateCommand) depends on Phase 2 (for the updated config generation infrastructure). Phase 4 (source config cleanup) depends on Phase 2 (to verify the generated output is correct). Phase 5 (smoke tests) depends on all prior phases.

The file lists are accurate:
- Phase 1: `mounts.ts` and `mounts.test.ts` -- correct, these are the only files touched.
- Phase 2: `up.ts`, `mounts.ts`, `resolve-mounts.ts`, `resolve-mounts.integration.test.ts` -- verified against the codebase. Also lists `commands/resolve-mounts.ts` which uses `mountSpecs` from `resolve-mounts.ts` and would need type updates.
- Phase 3: `up.ts` and `up.integration.test.ts` -- correct.
- Phase 4: `.devcontainer/devcontainer.json` only -- correct.
- Phase 5: New smoke test file -- correct.

**Finding 14 (non-blocking): Phase 2 constraint "Do not change postCreateCommand handling" is good engineering discipline.**

This ensures mount changes and postCreateCommand changes are independently testable. The constraint correctly prevents a phase from growing too large.

**Finding 15 (blocking): Phase 2 changes `GenerateExtendedConfigOptions.mountSpecs` type from `string[]` to `DevcontainerMount[]`, but `runResolveMounts` returns `mountSpecs: string[]` and is NOT in the Phase 2 file list for modification.**

At `up.ts:396`, `mountSpecs: string[]` is the current type. The proposal at line 390 says this changes to `DevcontainerMount[]`. But the `mountSpecs` value originates from `runResolveMounts()` at `resolve-mounts.ts:175` which calls `generateMountSpecs()` returning `string[]`. The resolve-mounts module at `resolve-mounts.ts:37` declares the return type as `mountSpecs?: string[]`.

Phase 2's file list includes `resolve-mounts.ts` (the command file at `src/commands/resolve-mounts.ts`) but the module that actually generates mount specs is at `src/lib/resolve-mounts.ts`. Both files need updating:
- `src/lib/resolve-mounts.ts`: Change `generateMountSpecs()` call and `ResolveMountsResult.mountSpecs` type
- `src/commands/resolve-mounts.ts`: No change needed (it just passes through)

The proposal lists `packages/lace/src/commands/resolve-mounts.ts` in Phase 2's file list but should also list `packages/lace/src/lib/resolve-mounts.ts`, which is where the actual type change propagates from. Looking more carefully, the proposal at line 373 lists `packages/lace/src/lib/mounts.ts` with "change `generateMountSpec` return type to `DevcontainerMount`" -- this is the right change, but the file list is missing `packages/lace/src/lib/resolve-mounts.ts` which consumes `generateMountSpecs`.

Fix: Add `packages/lace/src/lib/resolve-mounts.ts` to Phase 2's file list and update `ResolveMountsResult.mountSpecs` type from `string[]` to `DevcontainerMount[]`.

### Test Plan

**Finding 16 (non-blocking): The unit test cases for `parseMountString` are comprehensive.**

The test plan at line 233 lists: valid bind, valid volume, readonly flag, consistency parameter, alias normalization, missing type error, missing target error, unknown parameter error, empty string error. This covers the major parse paths. Additional cases worth considering:
- Mount string with only `type` and `target` (no `source`) -- tests the Finding 2 issue
- Mount string with `=` in values (e.g., `source=/path/with=equals`)
- Mount string with trailing comma

**Finding 17 (non-blocking): The `serializeMount` round-trip test should verify normalization, not exact string equality.**

The test plan at line 236 says "round-trip (generate -> parse -> serialize matches original)." However, `parseMountString` normalizes aliases (`src` -> `source`, `dst` -> `target`) and `mountToString` normalizes ordering (`type` first). So a round-trip of `"src=/foo,dst=/bar,type=bind"` would produce `"type=bind,source=/foo,target=/bar"` -- NOT the original string. The round-trip test should verify semantic equivalence (same fields, same values), not string equality.

**Finding 18 (non-blocking): The smoke tests are well-designed and cover the right scenarios.**

S1-S3 use `devcontainer read-configuration`, which is a fast validation check that does not require a running container. S4 tests the actual `lace up` pipeline. S5 verifies the validation gap (devcontainer CLI does not catch malformed mounts). S6 is correctly flagged as manual/CI-only.

One gap: there is no smoke test for the postCreateCommand object format with an EXISTING object-format user command. S3 tests a fresh object-format command, but Phase 3's success criteria include merging with an existing object (line 403). A smoke test verifying that the merged object is accepted by the CLI would strengthen confidence.

**Finding 19 (non-blocking): The integration test for mount validation with template variables (line 247) should specify which template variable.**

The test plan says "user mount with `${localEnv:...}` -> passes validation, template variables preserved." It should clarify that the MOUNT STRUCTURE is validated (type, target present) even when the source/target VALUES contain template variables. This is a subtlety worth making explicit in the test description.

### Source Config Cleanup (Phase 4)

**Finding 20 (blocking): The Phase 4 conversion of source `.devcontainer/devcontainer.json` mounts changes the mount parameter ordering, which could affect the feature mount regex.**

The current source config at `.devcontainer/devcontainer.json` line 77 has mounts in `source,target,type` order (source first). The Phase 4 conversion at proposal lines 437-443 changes the two non-readonly mounts to object format. This is fine for those two mounts.

However, the two readonly mounts stay as strings. The proposal shows them unchanged at lines 440-441:
```
"source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
```

This is `source,target,type,readonly` order. The devcontainer CLI's feature mount regex (proposal line 46) requires `type` first: `^type=(bind|volume),source=...`. But that regex applies only to FEATURE mounts, not user-defined mounts. User-defined mounts go through `parseMount()` which is order-independent. So the current ordering is fine for the CLI.

However, Open Question 2 (line 471) asks whether the mount string normalizer should reorder parameters. If Phase 1's `parseMountString` + `mountToString` is used to normalize the readonly mount strings during Phase 4, the output would change to `type,source,target,readonly` order. This would be a cosmetic change to the source config file. This is not a bug, but it could create an unnecessary diff in Phase 4. The proposal should clarify whether Phase 4 normalizes the remaining string mounts or leaves them as-is.

Actually, re-reading Phase 4 more carefully: the scope says "convert 2 of 4 mounts to objects" and the constraints say "must verify with `devcontainer read-configuration` before committing." The phase does NOT propose normalizing the remaining string mounts. Downgrading to **non-blocking** -- the ordering is fine as-is.

**Finding 21 (non-blocking): Phase 4 success criteria should verify that template variables survive the conversion.**

The two mounts being converted to objects contain `${localEnv:HOME}` in their source paths. Object-format mount source values support template variables (the devcontainer CLI substitutes them in both string and object formats). But the Phase 4 success criteria at line 424 only say "lace up produces the same functional output" and "devcontainer read-configuration accepts the config." It should explicitly verify that `${localEnv:HOME}` in object-format source values is substituted correctly at container creation time.

### Backward Compatibility

**Finding 22 (non-blocking): Converting mount output from string to object format is backward-compatible with the devcontainer CLI.**

The devcontainer CLI's `generateMountCommand()` (research report line 141) handles both string and object mounts. String mounts pass through verbatim; object mounts are serialized to `type=...,src=...,dst=...`. The output change from all-strings to mixed (objects + strings) is transparent to the CLI. No backward compatibility issue.

**Finding 23 (non-blocking): Converting postCreateCommand from string to object format changes semantics (parallel vs. sequential) but is backward-compatible with the CLI.**

The devcontainer CLI handles all three formats. The semantic change (parallel execution) is discussed in Finding 7. The CLI itself has no issue with the format change.

**Finding 24 (non-blocking): The `mountSpecs` type change from `string[]` to `DevcontainerMount[]` is a breaking internal API change.**

The `ResolveMountsResult.mountSpecs` type changes from `string[]` to `DevcontainerMount[]`. Any external consumers of `runResolveMounts()` (unlikely -- it is an internal module) would break. Since the codebase has no external consumers of this type, this is a safe change. The integration tests at `resolve-mounts.integration.test.ts` lines 200-201 will need updated assertions (checking for object properties instead of string contents).

### Edge Cases

**Finding 25 (non-blocking): The proposal's handling of mounts with commas in paths (line 220) correctly identifies the limitation.**

The proposal acknowledges that commas in paths break the parser, notes that the devcontainer CLI has the same limitation, and mentions that Docker uses quoting for values with commas. The parser "should detect quoted values and handle them" -- this is a reasonable approach but the implementation is not shown. Since paths with commas are extremely rare on Linux (the primary lace platform), this is acceptable as a known limitation with a documented future improvement path.

**Finding 26 (non-blocking): The existing `generateMountSpec` function does not escape commas in source/target paths.**

Looking at `mounts.ts:286-296`, the current `generateMountSpec` joins `type=bind,source=...,target=...` with commas. If `repoMount.source` contains a comma, the resulting string is ambiguous. This is a pre-existing issue not introduced by the proposal, but the new `parseMountString` would fail to round-trip such a mount. Worth noting as a known limitation.

### Open Questions

**Finding 27 (non-blocking): Open Question 1 (strict vs. permissive) should be resolved before implementation.**

The proposal recommends strict rejection with an escape hatch, but the escape hatch is not specified. As discussed in Finding 4, the recommendation should be: warn on unknown parameters, preserve them in an extras field, and force string serialization for mounts with extras. This resolves the question without requiring an escape hatch mechanism.

**Finding 28 (non-blocking): Open Question 2 (parameter reordering) can be deferred.**

Normalizing to `type,source,target` order is a cosmetic improvement. It should be part of `mountToString` (always emit in normalized order) but should not retroactively normalize existing string mounts in the source config unless there is a separate cleanup phase.

**Finding 29 (non-blocking): Open Question 3 (full schema validation) is correctly deferred.**

Validating the entire devcontainer.json against the JSON schema is a significant scope increase with diminishing returns for the current proposal. Correctly scoped as out-of-scope.

## Verdict

**Revise.** The proposal is well-structured with a clean architecture and correct understanding of the devcontainer specification constraints. The blocking issues are:

1. **`source` field requirement mismatch (Finding 2):** The `DevcontainerMount` interface declares `source` as required, but the devcontainer Mount schema marks it optional. Volume mounts without source are valid.
2. **Strict unknown parameter rejection (Finding 4):** The parser rejects any key not in its known set, which will break for valid Docker mount parameters like `bind-propagation`, `volume-driver`, etc. The proposal acknowledges this in Open Question 1 but the recommended approach (strict + escape hatch) is underspecified.
3. **Parallel execution semantics of postCreateCommand object format (Finding 7):** The object format runs tasks in parallel, changing the execution semantics from sequential `&&` chaining. The proposal should explicitly acknowledge this semantic change and document why it is safe for lace's use case.
4. **Missing `src/lib/resolve-mounts.ts` in Phase 2 file list (Finding 15):** The type change from `string[]` to `DevcontainerMount[]` must propagate through `src/lib/resolve-mounts.ts`, which is not listed in Phase 2's modified files.

All four issues are bounded fixes that do not require architectural changes.

## Action Items

1. [blocking] Make `source` optional in `DevcontainerMount` (`source?: string`). Update `parseMountString` to not require `source`. Update `serializeMount` and `mountToString` to handle missing source. Add a validation check that bind mounts have source (volume mounts may omit it).
2. [blocking] Change `parseMountString` to preserve unknown key-value pairs in an `extras` field (or similar) instead of throwing on unknown parameters. Emit a warning for unrecognized parameters. Force string serialization for mounts with extras. This preserves validation of the core fields while maintaining forward compatibility.
3. [blocking] Add a note to the postCreateCommand section explicitly acknowledging that the object format changes execution from sequential to parallel. Document why this is safe: lace symlinks and user commands operate on independent filesystem paths, so parallel execution does not introduce race conditions. If a future use case requires ordering, the user's command and lace's symlinks can be combined into a single string task.
4. [blocking] Add `packages/lace/src/lib/resolve-mounts.ts` to Phase 2's file list. Update `ResolveMountsResult.mountSpecs` type from `string[]` to `DevcontainerMount[]` in the Phase 2 scope description.
5. [non-blocking] Define the `MOUNT_KEY_ALIASES` constant explicitly in the proposal. Include `src -> source`, `dst -> target`, `destination -> target`, and `ro -> readonly`.
6. [non-blocking] Update the round-trip test description to verify semantic equivalence (same fields and values) rather than exact string equality, since normalization changes parameter ordering and aliases.
7. [non-blocking] Add a smoke test for postCreateCommand object format when the user's existing command is already in object format (verifying merge behavior with `devcontainer read-configuration`).
8. [non-blocking] Add test cases for `parseMountString` with: (a) volume mount with no source, (b) mount string with `=` in values, (c) trailing comma.
9. [non-blocking] Document in the Phase 4 scope whether the remaining readonly string mounts should be normalized (reordered to `type,source,target,...`) or left in their current `source,target,type,...` order.
10. [non-blocking] Consider using a more specific key like `lace:symlinks` instead of `lace-symlinks` for the postCreateCommand object key, to avoid potential collision with user-defined task names.

## Round 2

### Summary Assessment

The revised proposal addresses all four R1 blocking findings cleanly and without introducing architectural changes.
The `source` field is now optional with bind-mount-specific validation; unknown mount parameters are preserved in an `extras` field instead of being rejected; the postCreateCommand parallel execution semantics are explicitly acknowledged with a safety rationale; and `packages/lace/src/lib/resolve-mounts.ts` is included in Phase 2's file list.
Several R1 non-blocking items were also addressed: the `MOUNT_KEY_ALIASES` constant is now defined, the round-trip test specifies semantic equivalence, a new smoke test S3b covers object-format merging, and the `lace:symlinks` key prefix avoids collision with user-defined task names.
One minor typo was introduced in the revision (`lace:lace:user-setup` instead of `lace:user-setup`), and one non-blocking concern remains about the `parseMountString` value handling for bare flags.
Verdict: **Accept**.

### R1 Blocking Findings Resolution

**R1-B1 (Finding 2): `source` optional in `DevcontainerMount`** -- Resolved.

The `DevcontainerMount` interface now declares `source?: string` (proposal line 81) with a clear comment explaining that volume mounts can omit it and bind mounts enforce it at validation time.
The `parseMountString` function (lines 171-173) validates that bind mounts have `source`, while allowing volume mounts to omit it.
The `serializeMount` function (line 117) checks `!mount.source` and forces string serialization in that case, since the `DevcontainerMountObject` type correctly requires `source` for object-format output.
The Phase 1 success criteria (lines 413, 417) include explicit test cases for both `parseMountString("type=volume,target=/data")` and `serializeMount({ type: "volume", target: "/data" })`.
The test plan (line 272) adds "volume mount without source (valid)" as a named test case.
This is a thorough fix with correct type-level modeling.

**R1-B2 (Finding 4): Unknown parameter preservation via `extras`** -- Resolved.

The `DevcontainerMount` interface now includes an `extras?: Record<string, string | undefined>` field (lines 89-92) with comments explaining its purpose for forward compatibility.
The `parseMountString` default case (line 163) stores unknown parameters in `extras` with a comment indicating that warnings are emitted at the call site.
The `serializeMount` function (line 117) checks `mount.extras` and forces string serialization when extras are present.
The Phase 1 success criteria (line 413) include a test case for `bind-propagation=shared` being preserved in extras.
Open Question 1 (line 530) is now marked as resolved with the permissive approach.
The `extras` type of `Record<string, string | undefined>` correctly models both `key=value` parameters (`string`) and bare-flag parameters (`undefined`), matching the parser's behavior where `valueParts.length > 0` produces a string and `valueParts.length === 0` produces `undefined`.

**R1-B3 (Finding 7): Parallel execution acknowledgment** -- Resolved.

The proposal now has two explicit acknowledgments of the parallel execution semantic change:

1. A NOTE block (line 200) in the postCreateCommand Object Format section states that the object format runs tasks "in parallel with no ordering guarantees," explains why this is safe (independent filesystem paths), and documents the escape hatch (combining tasks into a single string for sequential execution).

2. The Design Decisions section "Decision: Convert postCreateCommand to object format" (lines 216-220) reiterates the parallel semantics and safety rationale in the "Why" justification.

The rationale is convincing: lace symlinks target `/mnt/lace/repos/*` while user commands typically configure the workspace or global settings. These are independent filesystem operations.

**R1-B4 (Finding 15): `resolve-mounts.ts` in Phase 2 file list** -- Resolved.

Phase 2's file list (line 433) now includes `packages/lace/src/lib/resolve-mounts.ts` with explicit scope: "update `ResolveMountsResult.mountSpecs` type from `string[]` to `DevcontainerMount[]`, update `runResolveMounts()` return path."
The Phase 2 file list also retains `packages/lace/src/commands/resolve-mounts.ts` (line 434), noting it passes through from the lib module.
The integration test file `packages/lace/src/commands/__tests__/resolve-mounts.integration.test.ts` (line 437) is listed for expectation updates.
This is complete.

### R1 Non-Blocking Items Addressed

**R1-NB5 (Finding 5): `MOUNT_KEY_ALIASES` defined** -- Addressed.

The alias map is now defined at lines 96-101 with all four aliases: `src -> source`, `dst -> target`, `destination -> target`, `ro -> readonly`.
This matches the devcontainer CLI's normalization (research report line 116-120) plus the `ro` alias for `readonly` that R1 noted was missing.

**R1-NB6 (Finding 6): Bare flag value handling** -- Addressed.

The parser now uses `valueParts.length > 0 ? valueParts.join("=") : undefined` (line 154) instead of always calling `valueParts.join("=")`.
This correctly produces `undefined` for bare flags like `readonly` and `ro`, avoiding the subtle empty-string issue noted in R1.
The comment `// bare flag, value ignored` (line 160) is a helpful annotation for implementers.

**R1-NB9 (Finding 9): `lace:symlinks` key prefix** -- Addressed.

The proposal now consistently uses `lace:` prefixed keys: `lace:user-setup` and `lace:symlinks` (lines 193-194, 333-334, 461-463).
The collision case is explicitly documented at line 463: "if user has a `lace:symlinks` key, it is overwritten -- documented limitation."
The colon-prefixed namespace significantly reduces collision risk with user-defined task names.

**R1-NB12 (Finding 12): Template variable pattern breadth** -- Addressed.

The edge case section (lines 245-246) now explicitly documents that the `${...}` pattern is "intentionally broad" and covers both devcontainer template variables and shell variables.
The rationale is stated: "a more precise regex could target only devcontainer-specific patterns, but the broad match is simpler and conservatively safe (false negatives in validation are preferable to false positives)."

**R1-NB17 (Finding 17): Round-trip semantic equivalence** -- Addressed.

The test plan (line 273) now specifies "round-trip semantic equivalence (generate -> parse -> serialize produces same fields/values, not necessarily same string due to alias normalization and parameter reordering)."

**R1-NB18 (Finding 18): Smoke test for object merge** -- Addressed.

Smoke test S3b (lines 341-354) now tests an object-format postCreateCommand with both an existing task and a `lace:symlinks` key, verified via `devcontainer read-configuration`.

**R1-NB8 (Finding 8): Array-format preservation** -- Addressed.

The Phase 3 success criteria (line 462) now explicitly state: "array user command -> object output preserving array under `lace:user-setup`" and add "(array preserved as-is, never joined)."
This directly responds to the R1 concern about the lossy `join(" ")` pattern.

**R1-NB20 (Finding 20): Phase 4 string mount normalization scope** -- Addressed.

Phase 4 constraints (line 508) now explicitly state: "The two remaining readonly string mounts are left in their current parameter order (`source,target,type,readonly`) -- normalization is NOT in scope for this phase."

### New Issues Introduced by Revisions

**Finding R2-1 (non-blocking): Typo `lace:lace:user-setup` in Design Decisions section.**

Line 220 of the proposal contains `lace:lace:user-setup` which is a stutter introduced during the revision.
Every other occurrence in the proposal uses the correct form `lace:user-setup` (lines 193, 278, 279, 333, 461, 462).
This is clearly a copy-paste artifact from adding the `lace:` prefix to the existing text that already contained `lace:user-setup`, resulting in a doubled prefix.
Fix: change `lace:lace:user-setup` to `lace:user-setup` on line 220.

**Finding R2-2 (non-blocking): The `extras` field comment could clarify the warning emission strategy.**

The `DevcontainerMount` interface comment for `extras` (lines 89-92) says "Preserved for forward compatibility with Docker mount params."
The parser's default case (line 163) says "warn at call site."
The Design Decisions section (line 214) says "A warning is emitted so typos are surfaced without breaking the workflow."
However, none of these specify the warning mechanism: is it a `console.warn`, a structured warning object returned alongside the result, or a logging framework call?
The design is correct to warn rather than error, but the implementation should use whatever structured warning/logging pattern lace already has (likely a logger instance).
This is a minor implementation detail that does not affect the proposal's design, and can be decided during Phase 1.

**Finding R2-3 (non-blocking): Phase 3 success criteria mismatch on no-symlinks case.**

Phase 3 success criteria line 464 says: "When user has no `postCreateCommand` and lace adds symlinks: output is string (no wrapping needed for single command)."
Line 465 says: "When no symlinks needed: `postCreateCommand` passes through unchanged."
The first case is a simplification, not a true object-format constraint.
But there is a slight inconsistency: the no-user-command + has-symlinks case outputs a plain string, while the has-user-command + has-symlinks case outputs an object.
This means the output format of `postCreateCommand` depends on whether the user had an original command, which could be surprising.
However, this is actually the correct behavior: wrapping a single command in an object with one key provides no benefit and adds visual noise.
No action needed, but an implementer might wonder about this asymmetry.

### Remaining R1 Non-Blocking Items Not Explicitly Addressed

**R1-NB16 (Finding 16): Additional `parseMountString` test cases.**

The test plan now includes volume mount without source (line 272), `=` in path values (line 273), and trailing comma (line 273).
All three suggested additions from R1 are now covered.

**R1-NB19 (Finding 19): Template variable mount structure validation.**

The test plan (line 286) still says "user mount with `${localEnv:...}` -> passes validation, template variables preserved" without explicitly noting that mount STRUCTURE (type, target) is validated even when VALUES contain template variables.
The edge case section (lines 247-248) does specify this: "Still validate the mount structure (type, presence of target, source for bind mounts)."
The test case description could be more explicit, but the intent is clear from the edge case section.

**R1-NB21 (Finding 21): Phase 4 template variable survival in object format.**

Phase 4 success criteria (lines 481-485) still do not explicitly verify that `${localEnv:HOME}` in object-format source values is substituted correctly at container creation time.
However, the Phase 4 changes section (lines 497-499) shows the objects with `${localEnv:HOME}` in source values, and the success criteria require running smoke test S6 which starts the full container.
S6 (lines 384-398) inspects actual Docker mounts via `docker inspect`, which would reveal if template variables were not substituted.
Effectively covered by S6, though an explicit callout would be clearer.

**R1-NB28 (Finding 28): Parameter reordering.**

Open Question 2 (line 532) remains open. The proposal recommends normalizing to `type,source,target` order, which is a reasonable default for `mountToString`.
This is correctly deferred to implementation.

### Verdict

**Accept.** All four R1 blocking issues are fully resolved with clean, well-integrated fixes.
The `extras` field approach for unknown parameters is particularly well-designed: it provides forward compatibility, preserves round-trip fidelity, and integrates cleanly with the serialization logic.
The parallel execution acknowledgment is thorough and includes both a NOTE block and a Design Decisions section entry.
The only new issue is a minor typo (`lace:lace:user-setup`) that should be fixed before implementation begins.

### Action Items

1. [non-blocking] Fix typo `lace:lace:user-setup` to `lace:user-setup` on line 220 of the proposal.
2. [non-blocking] During Phase 1 implementation, decide on the warning mechanism for unknown mount parameters (structured logger vs. console.warn) consistent with lace's existing patterns.
3. [non-blocking] Consider adding an explicit note to Phase 4 success criteria that `${localEnv:HOME}` in object-format mount source values is verified to be substituted correctly by the devcontainer CLI (effectively covered by S6 but worth calling out).
