---
review_of: cdocs/proposals/2026-02-04-dev-dependency-cross-project-mounts.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T17:30:00-08:00
task_list: lace/dotfiles-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, cli_integration, edge_cases, test_plan]
---

# Review: Dev Dependency Cross-Project Mounts

## Summary Assessment

This proposal defines a well-architected three-layer system for mounting sibling git repositories as read-only dev dependencies inside devcontainers: project-level declarations (`devDependencies`), user-level path mappings (`repos.json`), and lace-controlled mount points (`/lace.local/<name>`). The separation of concerns is sound and follows established lace CLI patterns from the prebuild proposal. The test plan is comprehensive. The main gaps are around `lace up` integration details (which lacks implementation specifics) and several open questions that should be resolved before implementation rather than left underspecified. **Verdict: Revise** -- a few blocking issues around CLI integration and path handling need clarification.

## Section-by-Section Findings

### BLUF and Objective

**Assessment: Strong**

The BLUF clearly articulates the three-layer architecture and identifies the key design decision around the `lace.local` namespace. The objective section correctly identifies the separation of concerns and provides concrete use cases that justify the feature.

### Background

**Assessment: Strong**

The background section effectively establishes context by referencing the existing mount patterns in the lace devcontainer, explaining devcontainer specification limitations, and connecting to the established lace CLI pattern from the prebuild proposal. The motivating use cases (Claude plugins, dotfiles, shared libraries) are practical and well-justified.

### Proposed Solution: Layer 1 (Project-Level Declaration)

**Assessment: Mostly good, minor clarification needed**

The `devDependencies` schema is reasonable. The repo identifier format (`github.com/user/repo`) is a good choice -- it is unambiguous and self-documenting.

**Non-blocking**: The proposal shows `"github.com/user/dotfiles": {}` for the simple case, but also mentions a string shorthand (`"readonly"` is equivalent to `{ readonly: true }`). However, the schema definition shows `DevDependencies[repoId]` can be `DevDependencyOptions | string`, which is inconsistent with the JSON examples showing only objects. The schema and examples should be consistent.

### Proposed Solution: Layer 2 (User-Level Mapping)

**Assessment: Solid**

The XDG-compliant location (`~/.config/lace/repos.json`), fallback discovery order, and rationale for user-level mapping are all well-justified. The optional `branch` field for future staleness warnings is a nice forward-thinking detail.

### Proposed Solution: Layer 3 (Container Mount Points)

**Assessment: Good with one concern**

The `/lace.local/<basename>/` convention is consistent with the existing `lace.local/` Docker tag pattern. The basename collision handling (prefixing with org/user) is reasonable.

**Non-blocking**: The note about potential namespace collision with future uses of `/lace.local/` is a valid concern. The proposal acknowledges this and suggests evolving to `/lace.local/deps/` if needed. Given that this is a new feature, it may be worth proactively using `/lace.local/deps/` from the start to avoid a migration later. However, consistency with the existing Docker tag pattern has value, so this is a judgment call.

### Lace CLI Changes: `lace resolve-deps`

**Assessment: Good specification**

The command design follows the established lace CLI pattern. The output format (`.lace/resolved-mounts.json`) is well-defined and includes useful metadata (version, timestamp, warnings).

### Lace CLI Changes: `lace up`

**Assessment: Blocking -- needs more detail**

The `lace up` command description is too high-level. Specifically:

1. **Does `lace up` already exist?** Checking the codebase shows `packages/lace/src/index.ts` only defines `prebuild`, `restore`, and `status` commands. The proposal should clarify whether `lace up` is a new command to be implemented as part of this work, or if it was planned in a prior proposal.

2. **Devcontainer CLI integration mechanism**: The proposal says lace should "Generate an extended devcontainer configuration in `.lace/devcontainer.json` with resolved mounts merged into the `mounts` array" and then "Invoke `devcontainer up --config .lace/devcontainer.json`". This is plausible but the implementation details matter:
   - How does lace handle the case where the user invokes `devcontainer up` directly (bypassing `lace up`)?
   - Should lace wrap all devcontainer commands, or only `up`?
   - The prebuild proposal established a pattern where lace rewrites the Dockerfile but the user still runs `devcontainer up` directly. This proposal introduces `lace up` as the entry point, which is a different model. The relationship between these patterns needs clarification.

3. **Prebuild integration**: The proposal mentions `lace up` should "Run `lace resolve-deps` (if `devDependencies` are declared)" but does not mention running `lace prebuild`. Should `lace up` be an umbrella command that orchestrates both prebuild and resolve-deps before invoking the devcontainer CLI?

### Design Decisions

**Assessment: Well-reasoned**

All seven design decisions (D1-D7) are clearly articulated with rationale and rejected alternatives. The defaults (read-only, non-required, generate extended config) are sensible.

**Non-blocking**: D7 states "Generate extended config, don't modify original" and references "Matches the prebuild pattern." However, the prebuild pattern actually rewrites the Dockerfile's FROM line in place. The patterns are similar (generated artifacts in `.lace/`) but not identical. Minor wording clarification would help.

### Edge Cases / Challenging Scenarios

**Assessment: Comprehensive**

The nine edge cases (E1-E9) cover the expected failure modes. The behaviors are reasonable:
- E1/E2 (unmapped/missing paths): Warn vs error based on `required` flag.
- E3 (basename collision): Disambiguation with org prefix.
- E4 (mirrorPath on Windows): Error with guidance.
- E5 (circular dependencies): Correctly identified as a non-issue.
- E6 (large dependencies): Acknowledged as future work.
- E7 (repos.json missing): Setup instructions provided.
- E8 (subdirectory missing): Error (correct -- this is likely a typo).
- E9 (mount conflicts): Error.

**Non-blocking**: E4 mentions Windows hosts, but the prebuild proposal's Phase 6 amendments mention "Windows support is not a concern for this project" and recommend Unix `flock`. The proposal should explicitly scope out Windows support rather than defining Windows-specific error handling.

### Test Plan

**Assessment: Thorough**

The test plan follows the established pattern from the prebuild proposal with unit tests for parsing, extraction, and resolution, plus integration tests for the commands. The test table format is clear.

**Non-blocking**: The test plan mentions `src/commands/__tests__/up.integration.test.ts` but the `lace up` command implementation details are underspecified (see blocking issue above). The test cases assume `lace up` exists and orchestrates resolution + devcontainer invocation.

### Implementation Phases

**Assessment: Clear progression**

The six phases (repos.json parsing, devDependencies extraction, mount resolution, resolve-deps command, lace up integration, documentation) follow a logical order with clear success criteria.

**Blocking**: Phase 5 says "Extend `src/commands/up.ts` (or create if doesn't exist)" -- this implicitly acknowledges that `lace up` may not exist, but does not specify whether creating it is in scope or what its full responsibilities should be. This needs clarification.

### Underspecifications and Open Questions

**Assessment: Needs triage**

The six open questions are valid. However, some should be resolved before implementation rather than left as underspecifications:

1. **mirrorPath and container user** (blocking): This is a real usability issue. If a user specifies `mirrorPath: true` and the host path is `/home/alice/code/...`, but the container runs as `node`, the path `/home/alice/...` will exist (lace creates the mount) but will be owned incorrectly. The proposal should specify the behavior -- likely "lace creates parent directories as needed; ownership follows standard bind mount semantics (host UID)."

2. **Multiple dotfiles repos** (non-blocking): Can be deferred to the dotfiles-specific proposal.

3. **Branch/version validation** (non-blocking): Explicitly marking this as "informational only for v1" is fine.

4. **Config schema versioning** (non-blocking): Can add a version field later when needed; for v1, implicit versioning by lace CLI version is acceptable.

5. **Interaction with prebuild** (non-blocking): The note that resolution happens at `lace up` time, after prebuild, is sufficient for v1.

6. **Expanding `/lace.local/` namespace** (non-blocking): As noted above, proactively using `/lace.local/deps/` would avoid this question.

## Verdict

**Revise**

The proposal is well-structured and the core architecture is sound. However, the `lace up` command is underspecified -- its relationship to the existing lace commands and the devcontainer CLI workflow needs clarification before implementation can proceed confidently. The `mirrorPath` edge case around container user paths also needs a defined behavior.

## Action Items

1. **[blocking]** Clarify `lace up` scope and implementation: Is this a new command? Should it orchestrate prebuild + resolve-deps + devcontainer up? How does it relate to users who invoke `devcontainer up` directly?

2. **[blocking]** Specify `mirrorPath` behavior with non-matching container users: Define whether lace creates parent directories, what the ownership semantics are, and whether this is a documented limitation or an error condition.

3. **[blocking]** Clarify the phase 5 implementation: If `lace up` does not exist, explicitly state that creating it is part of this work and define its full command signature and orchestration responsibilities.

4. **[non-blocking]** Resolve the `/lace.local/` vs `/lace.local/deps/` namespace question: Pick one and commit to it in this proposal to avoid future migration.

5. **[non-blocking]** Align schema definition with examples: The string shorthand (`"readonly"`) is mentioned but not shown in the JSON examples; either show it or remove it from the schema.

6. **[non-blocking]** Explicitly scope out Windows: Given the prebuild proposal's position on Windows, this proposal should state that Windows hosts are out of scope rather than defining Windows-specific error handling.

7. **[non-blocking]** Clarify D7 wording: Note that the prebuild pattern rewrites the Dockerfile in place while this proposal generates a separate config file -- similar but not identical patterns.
