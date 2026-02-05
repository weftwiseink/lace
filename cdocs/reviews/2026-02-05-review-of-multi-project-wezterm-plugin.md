---
review_of: cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-05T00:05:00-08:00
type: review
state: archived
status: done
tags: [rereview_agent, architecture, port-allocation, registry-design, lua, wezterm, api-transition]
---

# Review: Multi-Project WezTerm Plugin Support (Round 2)

## Summary Assessment

This revised proposal addresses a real problem (multi-project port conflicts and domain collisions) with a well-structured layered solution. The revision successfully resolves all six blocking issues from the first review: port allocation is now sequential (eliminating collision probability concerns), port configuration mechanism is specified via `.lace/devcontainer.json`, Lua file I/O approach uses `io.open()`, plugin structure is consolidated to single `init.lua`, and a comprehensive API transition section has been added. The proposal is now implementation-ready.

**Verdict: Accept** - All blocking issues from round 1 have been addressed. The proposal provides clear specifications for implementation across all five phases.

## Prior Review Status

Checking resolution of round 1 blocking issues:

| Round 1 Issue | Status | Resolution |
|---------------|--------|------------|
| 1. Collision probability inconsistent | **Resolved** | Removed entirely - sequential allocation has zero collision by design |
| 2. Port mapping mechanism underspecified | **Resolved** | Specified: `lace up` writes to `.lace/devcontainer.json` as `appPort` |
| 3. Lua file I/O unspecified | **Resolved** | Specified: use `io.open()` with fallback to `run_child_process` |
| 4. Workspace-to-project mapping | **Resolved** | Documented in E8 edge case with mitigation guidance |
| 5. Multi-file plugin structure | **Resolved** | Consolidated to single `init.lua` (D6 decision) |
| 6. API transition missing | **Resolved** | Added comprehensive "API Transition" section with backward compatibility |

## Section-by-Section Findings

### BLUF and Objective

The BLUF has been updated to reflect the new sequential port allocation and picker filtering behavior. Clear and actionable.

**Non-blocking**: Minor typo in BLUF - mentions "five" points but the enumeration shows five distinct items, which is correct.

### Layer 1: Sequential Port Allocation

Clean replacement of the hash-based approach. The algorithm is simple and correct:
- Find max port in use (starting from BASE_PORT - 1)
- Return max + 1

The choice of 11024 as base port is reasonable. The mnemonic explanation (l-a-c-e alphabet indices) is cute but the comment in the code is slightly confusing. This is purely cosmetic.

**Non-blocking**: The port range isn't bounded. If a user somehow registers 65536 - 11024 = 54512 projects, port allocation would overflow. This is practically impossible but could be noted as a theoretical limit.

### Layer 2: Project Registry

The schema is well-defined with clear TypeScript interfaces. The addition of `weztermEnabled` field enables the picker filtering behavior.

**Non-blocking**: The registry doesn't include a schema version. If the schema evolves, there's no way to detect and migrate old registries. Consider adding a `schemaVersion` field for future-proofing.

### Layer 3: Domain Naming Convention

Sound design unchanged from round 1. The `lace:project` format is clear.

### Layer 4: Unified Project Picker

Good implementation of the filtering behavior:
- Shows ALL projects
- Wezterm-enabled projects can be selected
- Non-wezterm projects show "(no wezterm)" suffix and toast on selection

The sorting (wezterm-enabled first) improves UX.

**Non-blocking**: The picker re-reads the registry on every invocation via `M.load_projects_from_registry()`. For typical use (few projects), this is fine. If latency becomes an issue, consider caching with a refresh mechanism.

### Layer 5: Per-Project Worktree Picker

The worktree picker correctly uses workspace name to determine the active project. Edge case E8 documents the limitation and mitigation.

### Layer 6: Lua File I/O

The `io.open()` approach is clearly specified with error handling and fallback noted. The code example is complete and correct.

### API Transition

This section thoroughly addresses the round 1 concern:
- Documents current single-project API
- Specifies new multi-project API
- Shows backward compatibility detection logic
- Provides clear migration steps

The detection heuristic (`opts.domain_name and opts.ssh_port` indicates legacy mode) is simple and effective.

### Design Decisions

All seven decisions (D1-D7) are well-reasoned. D7 (top-level `projects` key) is a good addition explaining why projects aren't nested under `wezterm`.

### Edge Cases

E2 (duplicate sanitized names) was added per round 1 feedback. The suffix approach (`my-app-2`) is reasonable.

E8 (workspace name conflicts) addresses the round 1 concern about workspace-to-project mapping.

**Non-blocking**: E4 (multiple users on shared machine) notes that users starting at the same base port will conflict. Since this is a rare scenario and manual override is available, this is acceptable but could be called out more prominently as a known limitation.

### Test Plan

Comprehensive coverage including:
- Port allocation (sequential behavior)
- Registry parsing (error cases)
- Domain name generation (sanitization, duplicates)
- Wezterm detection
- Multi-project workflow
- API transition scenarios

**Non-blocking**: Consider adding a test for the port allocation edge case: "Project removed from registry, port not reused" to verify the "don't fill gaps" behavior.

### Implementation Phases

Well-structured with single `init.lua` file throughout (addressing round 1 concern). Each phase has clear scope, files, and verification criteria.

### Open Questions

Reduced from 5 to 4 questions, all still relevant. The questions appropriately scope what's deferred vs. what's specified.

## Verdict

**Accept** - The proposal has been thoroughly revised to address all blocking issues from round 1. Key improvements:

1. Sequential port allocation eliminates collision probability concerns entirely
2. Port configuration mechanism via `.lace/devcontainer.json` leverages existing patterns
3. Lua file I/O approach is clearly specified
4. Single `init.lua` simplifies plugin structure
5. API transition section provides clear migration path
6. Edge cases expanded to cover workspace naming concerns

The proposal is now ready for implementation.

## Action Items

1. **[non-blocking]** Consider adding `schemaVersion` field to registry for future migrations
2. **[non-blocking]** Document theoretical port limit (~54k projects) in open questions or edge cases
3. **[non-blocking]** Consider registry caching if picker latency becomes problematic
4. **[non-blocking]** Add test case for "port not reused after project removal"
