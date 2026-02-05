---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T22:08:20-08:00
type: review
state: live
status: done
review_of: cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
tags: [rereview_agent, architecture, discovery, port-scanning, round2]
---

# Review of Port-Scanning WezTerm Discovery (Round 2)

## Summary Assessment

This revised proposal successfully addresses all blocking issues from Round 1. The domain registration timing is resolved with port-based pre-registration, parallel scanning is specified via `xargs -P 10`, and timeout is reduced to 200ms. The proposal is now implementation-ready with a clear, decoupled architecture.

**Verdict: Accept** - All blocking issues resolved. Minor non-blocking suggestions below.

## Prior Action Items Status

| # | Item | Status |
|---|------|--------|
| 1 | Resolve Layer 6 domain registration timing | **Resolved** - Pre-registers `lace:22425` through `lace:22499` |
| 2 | Specify parallel port scanning approach | **Resolved** - Uses `xargs -P 10` with shell one-liner |
| 3 | Reduce timeout to 100-200ms | **Resolved** - Now 200ms |
| 4 | Add edge case for multi-machine scenario | **Resolved** - Added E8 |
| 5 | Specify port availability detection | **Resolved** - Added TypeScript code with TCP connect |
| 6 | Pick canonical approach for LACE_PROJECT_NAME | **Resolved** - Feature approach is now canonical |
| 7 | Add test cases for parallel scanning | **Resolved** - Added Performance Tests section |

## Section-by-Section Findings (Changes Only)

### Layer 2: Per-Project Port Persistence

**Assessment**: Now includes concrete TypeScript implementation for port availability detection.

No issues.

### Layer 3: Container Identity

**Assessment**: Canonicalized to wezterm-server feature with implementation snippet.

No issues.

### Layer 4: Port Scanning in WezTerm

**Assessment**: Parallel scanning via shell script is well-specified with performance analysis.

**Non-blocking**: The shell script uses single quotes around the xargs command, which means the `$ssh_key` variable won't expand. This is a minor bug in the example. Should use:

```lua
local scan_script = string.format([[
  SSH_KEY="%s"
  seq %d %d | xargs -P 10 -I {} sh -c '
    result=$(ssh -p {} -o ConnectTimeout=0.2 -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
      -i "$SSH_KEY" node@localhost "echo \$LACE_PROJECT_NAME" 2>/dev/null) && \
    [ -n "$result" ] && echo "$result:{}"
  ' 2>/dev/null
]], ssh_key, LACE_PORT_MIN, LACE_PORT_MAX)
```

Or use the already-correct pattern from Layer 7 CLI which properly handles the variable.

### Layer 6: Domain Registration Strategy

**Assessment**: Port-based pre-registration is a clean solution. The fallback using `wezterm cli proxy` is a good alternative.

**Non-blocking**: The proposal mentions "75 domains, minimal overhead" but doesn't quantify. Worth noting that WezTerm handles this fine - domains are just config entries until used.

### Resolved Questions

**Assessment**: Open questions are now resolved with clear decisions.

No issues.

### Phase 3 Description

**Assessment**: Phase 3 scope still says "Dynamic connection (not pre-registered domains)" which contradicts the Layer 6 solution.

**Non-blocking**: Update Phase 3 scope to say "Pre-register port-based domains; map project names to ports at discovery" for consistency.

## Action Items

1. **[non-blocking]** Fix shell variable expansion in Layer 4 scan script example.

2. **[non-blocking]** Update Phase 3 scope to match the pre-registration approach from Layer 6.

## Verdict

**Accept** - The proposal is ready for implementation. The non-blocking items are minor documentation fixes that can be addressed during implementation or in a follow-up revision.
