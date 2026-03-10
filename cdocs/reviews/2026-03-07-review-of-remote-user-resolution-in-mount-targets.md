---
review_of: cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-07T15:30:00-06:00
task_list: lace/mount-resolver
type: review
state: live
status: done
tags: [fresh_agent, architecture, DRY, dockerfile-parsing, mount-resolver]
---

# Review: Resolve `${_REMOTE_USER}` in Mount Targets

## Summary Assessment

The proposal correctly diagnoses a real bug (literal `${_REMOTE_USER}` directories created by Docker) and proposes a sound fix: resolve devcontainer variables eagerly in `MountPathResolver` before they reach Docker mount specs. The architecture (resolve at construction, not lazily) and scoping decisions (only `_REMOTE_USER` and `containerWorkspaceFolder`) are well-reasoned. However, the proposal introduces a hand-rolled Dockerfile USER parser that duplicates logic already available via `dockerfile-ast` (used extensively in `dockerfile.ts`) and duplicates the remote user resolution logic that `lace-discover` already implements in bash. Additionally, the proposed top-down Dockerfile parsing approach is unnecessarily complex when a bottom-up scan would be simpler. Verdict: **Revise** -- directionally correct, two blocking issues around DRY and parsing direction.

## Section-by-Section Findings

### Proposed Solution / Code Changes (Section 6: `parseDockerfileUser`)

**Blocking: Hand-rolled Dockerfile parser duplicates `dockerfile-ast` and should DRY with `lace-discover`.**

The proposal introduces a new `parseDockerfileUser()` in a new `dockerfile.ts` file that does line-by-line regex parsing of FROM and USER directives. But:

1. **`dockerfile-ast` is already a dependency.** The existing `dockerfile.ts` uses `DockerfileParser` from `dockerfile-ast` to parse FROM instructions with full AST support. The new function should use the same parser to extract USER directives rather than reimplementing line-by-line parsing. `dockerfile-ast`'s `getInstructions()` returns all instructions with their keywords -- filtering for `USER` instructions in the final stage is straightforward with the existing AST.

2. **`lace-discover` already resolves the remote user.** Lines 89-105 of `bin/lace-discover` implement the same three-tier resolution: `remoteUser` from metadata, `Config.User` from Docker inspect, then a default. The proposal's `extractRemoteUser()` replicates this logic in TypeScript without acknowledging or reusing it. While `lace-discover` operates at runtime (on running containers) and this operates at config-generation time (on files), the resolution semantics are identical. The proposal should:
   - Acknowledge the parallel implementation explicitly
   - Extract the resolution logic into a shared utility (or at minimum, reference `lace-discover` as the canonical definition and ensure the TypeScript version stays in sync)
   - Note that `lace-discover` defaults to `"node"` while this proposal defaults to `"root"` -- this inconsistency should be resolved or explicitly justified beyond "the spec says root"

### Proposed Solution / Code Changes (Section 6: parsing direction)

**Blocking: Top-down Dockerfile parsing with FROM-reset is more complex than necessary. Parse bottom-up instead.**

The proposed `parseDockerfileUser()` scans top-down, resetting `lastUser` on each `FROM` to find the final stage's USER. This works, but a bottom-up scan is more straightforward: read lines in reverse, return the first USER directive found, stopping at the first FROM (which marks the start of the final stage). This eliminates the `inFinalStage` state variable entirely:

```typescript
function parseDockerfileUser(instructions: Instruction[]): string | null {
  for (let i = instructions.length - 1; i >= 0; i--) {
    const keyword = instructions[i].getKeyword();
    if (keyword === 'USER') {
      return instructions[i].getArguments()...;  // extract username
    }
    if (keyword === 'FROM') {
      return null;  // reached start of final stage without finding USER
    }
  }
  return null;
}
```

This is a single pass with early return, no mutable state, and the intent ("find the USER in the last stage") maps directly to the algorithm ("scan backward from end, stop at FROM boundary").

### Design Decision D3: Default `root` vs `node`

**Non-blocking: The `root` vs `node` inconsistency with `lace-discover` deserves more attention.**

The proposal justifies defaulting to `"root"` per the devcontainer spec, while acknowledging `lace-discover` defaults to `"node"`. The spec justification is correct in the abstract, but in the lace ecosystem every project currently uses node-based images. A user who omits `remoteUser` will get mounts targeting `/home/root/` which is wrong for their actual container. The proposal notes this in E1 (edge case about `/root` vs `/home/root`) but doesn't resolve it. Consider: should the default be `"root"` for spec compliance, or should lace log a warning when it falls back to the default, nudging users to set `remoteUser` explicitly?

### Design Decision D1: Resolve in `MountPathResolver`, not `template-resolver.ts`

**Non-blocking: Sound decision, well-justified.** The distinction between data-model-level variables (feature metadata) and config-template-level variables (`${lace.port()}`) is clear. The proposal correctly identifies that `template-resolver.ts` operates on devcontainer.json strings, while `_REMOTE_USER` appears in declaration objects. No issues.

### Design Decision D2: Eager resolution at construction time

**Non-blocking: Correct.** Eager resolution is necessary for conflict detection to work properly. The deep-copy approach avoids mutating shared declaration objects. Well-reasoned.

### Edge Cases

**Non-blocking: E2 (ARG references) is well-handled.** Detecting `$` prefix and falling through to the default is the right approach. Using `dockerfile-ast` would make this even cleaner since ARG references would be parsed structurally rather than detected via string prefix.

### Test Plan

**Non-blocking: Test plan is thorough.** 17 test cases covering unit, integration, and edge cases. The conflict detection test (item 15) is particularly important for validating the eager resolution design. One addition: test the bottom-up parsing behavior with a multi-stage Dockerfile where an intermediate stage has a USER but the final stage does not (should return `null`, not the intermediate USER).

### Implementation Phases

**Non-blocking: Phase structure is reasonable.** Phases 1 and 2 being independent allows parallel implementation. Phase 4 (documentation cleanup) is important since several cdocs currently claim verbatim passthrough.

### Proposal references a non-existent function

**Non-blocking: `tryResolveBuildSource` does not exist.** The `extractRemoteUser()` code sample calls `tryResolveBuildSource(raw, workspaceFolder)`, but the codebase only has `resolveBuildSource()` (which throws on failure). Either use `resolveBuildSource` with a try/catch, or create the `try` variant. Minor, but the code sample should be accurate.

## Verdict

**Revise.** The proposal is directionally correct and the core architecture (eager resolution in `MountPathResolver`) is sound. Two blocking issues must be addressed:

1. Use `dockerfile-ast` (already a dependency) instead of hand-rolling line-by-line Dockerfile parsing, and DRY the remote user resolution logic with `lace-discover` (or at minimum, explicitly acknowledge the duplication and justify it).
2. Parse the Dockerfile bottom-up instead of top-down for simplicity.

## Action Items

1. [blocking] Replace hand-rolled `parseDockerfileUser()` with a `dockerfile-ast`-based implementation that reuses the existing `DockerfileParser`. Add a `parseDockerfileUser(content: string)` function to the existing `dockerfile.ts` rather than creating a new file.
2. [blocking] Parse Dockerfile bottom-up (reverse iteration over instructions, return first USER before first FROM boundary) instead of top-down with FROM-reset state tracking.
3. [blocking] DRY the remote user resolution with `lace-discover`. Options: (a) extract a shared spec/contract that both implementations follow, (b) have `lace-discover` call the TypeScript implementation via `lace resolve-user` subcommand, or (c) at minimum, add cross-references and a test that validates both implementations agree for the same inputs.
4. [non-blocking] Resolve the `root` vs `node` default inconsistency between this proposal and `lace-discover`. Either align them or add a warning when falling back to the default.
5. [non-blocking] Fix the `tryResolveBuildSource` reference to use the actual `resolveBuildSource` function (with error handling) or create the `try` variant.
6. [non-blocking] Add a test case for multi-stage Dockerfile where intermediate stage has USER but final stage does not.
