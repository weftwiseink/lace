---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T22:05:42-08:00
type: review
state: archived
status: done
review_of: cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
tags: [fresh_agent, architecture, discovery, port-scanning, simplification]
---

# Review of Port-Scanning WezTerm Discovery

## Summary Assessment

This proposal offers a dramatically simplified approach to multi-project WezTerm support by replacing registry-based discovery with port scanning. The design is clean and achieves the stated goal of decoupling. However, the proposal has a critical gap around dynamic SSH domain registration in WezTerm (domains are evaluated at config load, not runtime) and underspecifies parallel port scanning in Lua. The overall direction is sound, but Layer 6 needs architectural clarification before this can be implemented.

**Verdict: Revise** - Address the WezTerm domain registration timing issue and clarify parallel scanning approach.

## Section-by-Section Findings

### BLUF and Objective

**Assessment**: Clear and well-structured. Correctly identifies the four key components of the approach.

No issues.

### Background

**Assessment**: Good motivation. Clearly explains why registry-based discovery creates coupling and why decoupled discovery is better.

No issues.

### Layer 1: Port Range

**Assessment**: The port range 22425-22499 is well-chosen with memorable rationale.

**Non-blocking**: Consider documenting what happens if the user already has services in this range. The proposal mentions E4 (non-lace service on port) but doesn't address how users could configure an alternative range if needed.

### Layer 2: Per-Project Port Persistence

**Assessment**: Sound approach. The algorithm is clear and handles the common cases well.

**Non-blocking**: Step 3 says "Scan 22425-22499 for first unused port" but doesn't specify how to determine "unused." Is this:
- TCP connect attempt to check if something is listening?
- Check `/proc/net/tcp` or equivalent?
- Docker port binding check?

Clarifying this would improve implementability.

### Layer 3: Container Identity

**Assessment**: Using `LACE_PROJECT_NAME` environment variable is a clean approach.

**Non-blocking**: The proposal shows two ways to set this (containerEnv in devcontainer.json, or via the feature). Recommend picking one canonical approach and deprecating the other to avoid confusion. The feature approach seems cleaner since it bundles related functionality.

### Layer 4: Port Scanning in WezTerm

**Assessment**: The sequential scanning approach is correct but will be slow.

**Blocking**: The code shows sequential port scanning. Scanning 75 ports with 1-second timeout each could take 75 seconds worst case. The proposal mentions "Optimization: Scan ports in parallel batches (5-10 concurrent)" but WezTerm's `wezterm.run_child_process()` is synchronous. How do you parallelize in Lua?

Options to consider:
1. Use a shell script that does parallel probing and returns JSON
2. Use `wezterm.run_child_process()` with a bash one-liner using `&` and `wait`
3. Accept sequential scanning but reduce timeout to 100ms (should be sufficient for localhost)

This needs resolution before implementation.

### Layer 5: Project Picker

**Assessment**: Clean picker implementation that follows WezTerm patterns.

**Non-blocking**: The picker performs discovery synchronously when invoked. This could cause UI hang if scanning is slow. Consider showing a loading state or using cached results.

### Layer 6: Dynamic Domain Registration

**Assessment**: This section identifies a critical problem but doesn't fully solve it.

**Blocking**: The proposal correctly identifies that "WezTerm config is evaluated once at startup. Domains discovered later won't be registered." The proposed solution of using `SpawnCommand` with explicit SSH args bypasses WezTerm's multiplexing entirely - you'd get a raw SSH session, not a wezterm-mux-server session.

The alternative `wezterm connect "lace:$PROJECT"` would fail because that domain was never registered.

**Possible solutions**:
1. **Config reload**: After discovery, trigger `wezterm.reload_configuration()` (but this re-runs the whole config, may have side effects)
2. **Pre-register all possible domains**: Register domains for all 75 ports at startup with generic names like `lace:22425`, then map discovered project names to ports in the picker
3. **Direct mux connection**: The `wezterm serial` approach in the SpawnCommand might work if the path is correct, but this needs verification

This is the most significant gap in the proposal and needs architectural resolution.

### Layer 7: CLI Command (wez-lace-into)

**Assessment**: Good CLI design with helpful flags.

**Non-blocking**: The `discover_projects()` function runs sequentially. For CLI this is more acceptable (can show progress), but 75 ports * 1 second = too slow. Consider:
- Running probes in parallel with `xargs -P` or `parallel`
- Reducing timeout to 200ms for localhost
- Only scanning ports that are actually bound (check with `ss -tlnp` first)

### Design Decisions

**Assessment**: All decisions are well-reasoned and documented.

**Non-blocking**: D4 (SSH Probe for Verification) could note that this requires the SSH key to exist before any discovery works. First-time users will need guidance on key setup.

### Edge Cases

**Assessment**: Good coverage of edge cases.

**Non-blocking**: Missing edge case: What if the same project is cloned to two different machines/directories but both try to use the same port? Since ports are stored per-project and gitignored, this shouldn't happen, but worth noting explicitly.

### Test Plan

**Assessment**: Adequate coverage.

**Non-blocking**: Missing test cases for:
- Parallel scanning behavior
- Discovery timeout handling
- Large number of running containers (10+)

### Implementation Phases

**Assessment**: Phases are well-ordered with clear scope.

**Blocking**: Phase 3 (WezTerm Discovery Plugin) depends on resolving the domain registration timing issue from Layer 6. The scope should explicitly note this as a risk/dependency.

### Open Questions

**Assessment**: Good questions raised.

**Blocking**: Question 2 (Parallel Probes) is not really open - it's a must-solve for acceptable performance. Suggest moving this from "open question" to "implementation requirement" and proposing a solution.

## Action Items

1. **[blocking]** Resolve Layer 6 domain registration timing. Recommend: pre-register domains for all ports at startup (`lace:22425` through `lace:22499`) and map discovered project names to ports at picker time. This decouples domain registration from discovery.

2. **[blocking]** Specify parallel port scanning approach. Recommend: have the Lua code shell out to a bash script that uses `xargs -P 10` or similar for parallel probing, returning JSON results.

3. **[blocking]** Reduce the 1-second timeout recommendation. For localhost connections, 100-200ms is sufficient and dramatically improves UX (75 ports * 0.1s = 7.5s worst case vs 75s).

4. **[non-blocking]** Add edge case for multi-machine same-project scenario.

5. **[non-blocking]** Specify how "port in use" is detected in the allocation algorithm.

6. **[non-blocking]** Pick one canonical approach for setting `LACE_PROJECT_NAME` (recommend feature over containerEnv).

7. **[non-blocking]** Add test cases for parallel scanning and timeout handling.
