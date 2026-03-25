---
review_of: cdocs/proposals/2026-03-24-lace-user-level-config.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T20:15:00-07:00
task_list: lace/user-config-proposal
type: review
state: live
status: done
tags: [rereview_agent, architecture, security, git_identity, mount_policy, internal_consistency]
---

# Review (Round 4): Lace User-Level Config

## Summary Assessment

This proposal defines `~/.config/lace/user.json` as a declarative user-level config for universal mounts, prebuild features, git identity, default shell, and containerEnv across all lace projects.
All three blocking issues from round 3 have been resolved: prefix matching is now path-aware with `/` separator boundary, `mergeUserGitIdentity()` correctly uses `LACE_GIT_NAME`/`LACE_GIT_EMAIL` pass-through variables, and Phase 4 sub-step 3 references `mountDeclarations`.
The git identity flow is now internally consistent across BLUF, design section, edge cases, precedence chain, pipeline integration, and implementation phases.
The proposal is thorough, well-structured, and ready for implementation.

Verdict: **Accept.**

## Verification of Round 3 Blocking Issues

### Issue 1: Mount policy prefix-matching ambiguity

**Resolved.**
Line 276 now reads: "Exact paths (no glob characters) use path-aware prefix matching: `~/.ssh` blocks `~/.ssh`, `~/.ssh/config`, and `~/.ssh/keys/id_ed25519`, but does NOT match `~/.sshrc` or `~/.ssh-backup`."
Line 277 adds the specification: "The match requires the source path to be either exactly the rule path or to have a `/` separator immediately after the rule path prefix."
This is precise and implementable.

### Issue 2: `mergeUserGitIdentity()` contradicts two-layer identity

**Resolved.**
Phase 3 (line 808) now correctly describes the mechanism: the function stores git identity values for the init script, does NOT inject `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars, and instead passes identity via `LACE_GIT_NAME`/`LACE_GIT_EMAIL` containerEnv variables that git does not recognize.
The rationale for why `GIT_AUTHOR_*` injection would break the two-layer system is explicitly stated.

### Issue 3: Phase 4 sub-step references `configForResolution`

**Resolved.**
Line 822 now correctly reads: "Merge user mounts into `mountDeclarations` via `mergeUserMounts()`."
Matches the Pipeline Integration section at line 428.

## Git Identity Flow: Internal Consistency Check

The git identity mechanism touches seven distinct sections of the document.
All are now consistent with the `LACE_GIT_NAME`/`LACE_GIT_EMAIL` pass-through approach:

| Section | Location | Description | Consistent? |
|---------|----------|-------------|-------------|
| BLUF | Line 22 | "written to a clean in-container `~/.gitconfig` by the fundamentals init script" | Yes |
| Design: Default identity | Lines 319-327 | Init script writes `~/.gitconfig` via `git config --global` | Yes |
| Merge semantics | Line 411 | "Project can override via `GIT_CONFIG_*` env vars" | Yes |
| Pipeline integration | Line 429 | "Inject git identity default into containerEnv (for init script consumption)" | Yes |
| Decision 2 | Lines 550-551 | "fundamentals init script writes a clean `~/.gitconfig`" | Yes |
| Edge case: conflict | Lines 630-632 | References `LACE_GIT_NAME`/`LACE_GIT_EMAIL` correctly | Yes |
| Precedence chain | Lines 638-645 | Lists `LACE_GIT_NAME`/`LACE_GIT_EMAIL` at correct layer | Yes |
| Phase 3 | Line 808 | Uses `LACE_GIT_NAME`/`LACE_GIT_EMAIL`, explicitly rejects `GIT_AUTHOR_*` | Yes |

## Round 3 Non-Blocking Issue Status

### `includeIf` section clarity (lines 330-337)

**Not addressed.**
The section header "Project-level override via git's `includeIf`" still precedes content that primarily describes `GIT_CONFIG_*` env vars.
Lines 332-338 describe an `includeIf` directive that the init script "sets up," but the actual override mechanism is the `GIT_CONFIG_*` env vars at lines 340-356.
An implementer could reasonably wonder whether the init script should write the `includeIf` directive, who creates `/workspaces/.gitconfig-work`, and whether `includeIf` is an alternative or complement to `GIT_CONFIG_*`.

Remains non-blocking: the core mechanism (`GIT_CONFIG_*`) is clearly specified, and the `includeIf` block reads as supplementary context.
However, the implementer would benefit from either (a) a NOTE callout explaining that `includeIf` is shown for context but `GIT_CONFIG_*` is the primary mechanism, or (b) removing the `includeIf` block and retitling the section to "Project-level override via `GIT_CONFIG_*` env vars."

### Duplicate NOTE callouts (lines 283-285 and 296-298)

**Not addressed.**
Both callouts say essentially the same thing: "The [default policy/denylist] is [conservative/intentionally conservative]. It blocks the most common credential stores. Project-level mounts are not subject to the user-mount [policy/denylist]..."
One should be removed.
Remains non-blocking.

### JSON example comment (line 130)

**New observation (non-blocking).**
The JSON comment reads: "Git commit identity. Injected as containerEnv variables."
Technically true (identity is injected as `LACE_GIT_NAME`/`LACE_GIT_EMAIL` containerEnv variables), but a reader encountering this before the design section could infer that `GIT_AUTHOR_*` env vars are used.
A more precise comment would be: "Git commit identity. Passed to init script via LACE_GIT_* env vars to write ~/.gitconfig."
Non-blocking: the design section clarifies the mechanism.

### Other R3 non-blocking items

The following were not addressed and remain non-blocking suggestions:
- Clarify whether `!`-prefixed allow exceptions use the same matching semantics as deny rules.
- Acknowledge that users can override `!~/` to disable default protection.
- Add test case for prefix-matching boundary behavior.
- Add unit test for `mergeUserGitIdentity()` verifying correct mechanism.

These are all reasonable improvements but none are required for implementation to proceed correctly.

## New Observations

### Integration test for git identity could be more specific

**Non-blocking.**
Line 724 tests: "`lace up` with `user.json` containing git identity: env vars appear in `containerEnv`."
This is correct but vague.
The test should verify specifically that `LACE_GIT_NAME` and `LACE_GIT_EMAIL` appear in containerEnv, and that `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` do not.
This is an implementer-level concern: the test plan provides direction, and the implementer will write the assertions.

### `first_authored.by` still uses short model name

**Non-blocking.**
Frontmatter says `@claude-opus-4-6` rather than a full dated model name like `@claude-opus-4-6-20250324`.
This has been non-blocking since round 2.

## Verdict

**Accept.**

All three round 3 blocking issues are resolved.
The git identity flow is internally consistent across all seven document sections that reference it.
The mount policy specification is precise and implementable.
The remaining non-blocking items are polish: duplicate callouts, section header clarity, and comment precision.
None of these would cause an implementer to produce incorrect code.

The proposal is ready for `implementation_ready` status.

## Action Items

1. [non-blocking] Clarify or retitle the `includeIf` section (lines 330-337): either add a NOTE explaining it is context (not the primary mechanism) or retitle to reflect the `GIT_CONFIG_*` approach.
2. [non-blocking] Remove the duplicate NOTE callout at lines 296-298 (redundant with lines 283-285).
3. [non-blocking] Make the JSON example comment at line 130 more precise: "Passed to init script via LACE_GIT_* env vars" rather than "Injected as containerEnv variables."
4. [non-blocking] Clarify whether `!`-prefixed allow exceptions use the same matching semantics as deny rules (prefix match for bare paths, glob for patterns).
5. [non-blocking] Add test cases for prefix-matching boundary behavior and `mergeUserGitIdentity()` mechanism verification.
