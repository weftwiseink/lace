---
review_of: cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-10T17:15:00-08:00
task_list: lace/workspace-validation
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, git_compatibility, version_mismatch]
---

# Review: Fix `extensions.relativeWorktrees` Git Version Mismatch in Devcontainers

## Summary Assessment

This proposal addresses a real, actively breaking issue where the host's git 2.53.0
sets `extensions.relativeWorktrees` in the bare repo config, and the container's
git 2.39.5 fatally rejects it. The diagnosis was independently confirmed against
the running lace container. The two-part fix (upgrade container git + add preventive
detection) is well-structured. The proposal has one blocking issue around scoping
Phase 4 into the implementation phases, and several non-blocking refinements.
Verdict: Revise -- one blocking issue on scope creep, then accept.

## Section-by-Section Findings

### Background (lines 39-138)

Thorough and accurate. All claims were independently verified:
- Host git: 2.53.0 (confirmed)
- Container git: 2.39.5 (confirmed)
- `extensions.relativeWorktrees = true` in bare repo config (confirmed)
- `docker exec lace git -C /workspace/lace/main status` returns the fatal error (confirmed)

The version landscape table and explanation of `repositoryformatversion = 1` semantics
are clear and correct.

No issues.

### Part 1: Immediate Fix -- Upgrade Container Git (lines 144-169)

The approach is correct. The current `devcontainer.json` at
`.devcontainer/devcontainer.json` line 41 has:

```json
"ghcr.io/devcontainers/features/git:1": {},
```

Adding `"version": "latest"` will cause the feature to build git from source.

**Finding 1 (non-blocking): Consider pinning to a specific version rather than
`"latest"`.** Using `"latest"` means the container's git version can change
unpredictably on rebuild. A pinned version like `"2.48.0"` or the current host
version `"2.53.0"` would provide reproducibility. However, `"latest"` is simpler
and the devcontainer features system already caches prebuild images, so this is a
minor concern. The proposal could note this tradeoff.

### Part 2: Preventive Check (lines 171-253)

The detection algorithm is sound. It follows the existing `absolute-gitdir` warning
pattern in `workspace-detector.ts` and `workspace-layout.ts`.

**Finding 2 (blocking): Phase 4 (Smart Suppression) adds significant complexity
for marginal benefit and should be deferred.** The proposal includes Phase 4
(lines 539-560) which adds logic to check the devcontainer config for a git feature
with a sufficient version and suppress the warning accordingly. This introduces
tight coupling between the workspace detector and devcontainer config parsing,
requires version comparison logic for `"latest"`, `"lts"`, and semver strings,
and has its own edge cases (E4). Since Phase 1 already fixes the actual breakage
by upgrading git, Phase 4 is not needed for correctness -- it only avoids a
warning that would be correct (the extension IS present) but harmless (the git IS
new enough). The warning can simply be addressed by noting in the message that
it can be suppressed with `--skip-validation` if the container git is known to
support the extension. Phase 4 should be explicitly marked as "future, out of
scope" (like Phases 2 and 3 of the wez-into proposal) rather than included as
an implementation phase.

**Finding 3 (non-blocking): The `GIT_EXTENSION_MIN_VERSIONS` map includes `noop`
which is not a real extension.** The `noop` extension is a test artifact in the
git source tree, not something that appears in real repositories. Including it in
the map adds clutter without value. The map should only include extensions that
users are likely to encounter.

**Finding 4 (non-blocking): The git config parser scope is appropriate but the
proposal could be more explicit about what it does NOT parse.** The proposal
mentions not needing a full INI parser (E5, line 379) but should explicitly state
that multiline values (trailing backslash continuation), quoted values, and
include directives (`[include]` / `[includeIf]`) are not handled. This is fine
because `core.repositoryformatversion` and `extensions.*` never use these features,
but documenting the limitation prevents future maintainers from assuming the parser
is general-purpose.

### Design Decisions (lines 256-321)

All four decisions are well-reasoned. The decision to parse git config directly
(not shell out to git) is particularly good because it avoids a host-git dependency
and keeps the workspace detector filesystem-only.

**Finding 5 (non-blocking): The decision to check in workspace-detector.ts rather
than host-validator.ts is correct and well-justified.** The host validator operates
on declarative checks from devcontainer.json; the workspace detector operates on
filesystem-detected state. Extension compatibility is filesystem-detected state.

### Edge Cases (lines 323-392)

Good coverage. E1 (multiple extensions), E3 (non-bare repos), and E5 (config format)
are well-handled.

**Finding 6 (non-blocking): E6 mentions documenting a note in `wt-clone`'s output,
but `wt-clone` is a nushell dotfile script outside this repo.** The proposal should
clarify where this documentation change would live. If `wt-clone` is in the dotfiles
repo, this action item should be tracked separately rather than included in this
proposal's implementation phases.

### Test Plan (lines 394-460)

Solid test plan. The diagnosis verification (items 1-3) and fix verification (item 4)
are straightforward. Unit tests for the parser and extension detection (items 5-7)
follow existing test patterns.

**Finding 7 (non-blocking): Item 8 (integration smoke test) references
`lace up --skip-devcontainer-up` which should be verified as an actual flag.**
A quick grep shows this is not a current flag in the codebase. The intent is clear
(run the pipeline without actually building the container) but the exact CLI
interface should be confirmed or the test description should note it may need
adjustment.

### Implementation Phases (lines 463-560)

Phases 1-3 are well-scoped. Phase 4 is the blocking issue noted above.

**Finding 8 (non-blocking): The `createBareRepoWorkspace` helper in
`scenario-utils.ts` does not currently write a `config` file inside `.bare/`.** The
extension check reads the bare repo's git config at `.bare/config` (or wherever
`HEAD` is). The test helper creates `HEAD`, `objects/`, and `refs/` but no `config`
file. The implementation will need to either extend the helper with a `config`
option or write the config file directly in tests.

## Verdict

**Revise.** Phase 4 (Smart Suppression) should be deferred to a future proposal.
Once that is scoped out, the remaining Phases 1-3 are well-designed and ready for
implementation.

## Action Items

1. [blocking] Move Phase 4 (Smart Suppression for Configured Git Feature) to a
   "future, out of scope" section, matching the pattern used in the wez-into
   proposal. It adds complexity without fixing the actual breakage.
2. [non-blocking] Consider pinning the git feature version (e.g., `"2.53.0"`)
   instead of `"latest"` for reproducibility, or at least note the tradeoff.
3. [non-blocking] Remove `noop` from the `GIT_EXTENSION_MIN_VERSIONS` map --
   it is a test artifact, not a user-facing extension.
4. [non-blocking] Explicitly document what the git config parser does NOT handle
   (multiline values, quoted strings, include directives) to prevent scope creep.
5. [non-blocking] Clarify that the `wt-clone` documentation change (E6) belongs
   in the dotfiles repo and should be tracked separately.
6. [non-blocking] Verify `lace up --skip-devcontainer-up` exists as a CLI flag
   or adjust the integration test description.
7. [non-blocking] Note that `createBareRepoWorkspace` will need a `config` file
   option for the extension detection tests.
