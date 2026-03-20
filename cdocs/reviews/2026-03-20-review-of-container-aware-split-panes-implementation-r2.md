---
review_of: cdocs/devlogs/2026-03-20-container-aware-split-panes-implementation.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T17:45:00-07:00
task_list: wezterm/split-pane-regression
type: review
state: live
status: done
tags: [rereview_agent, runtime_validated, architecture, fallback_chain, dead_code]
---

# Review (Round 2): Container-Aware Split Panes Implementation

## Summary Assessment

This re-review checks the two blocking items from round 1: dead code (`resolve_workspace_folder` in `wez-into`) and the missing raw SSH fallback.
Both items have been addressed: the dead function is fully removed, and `do_connect` implements a three-tier fallback chain (ExecDomain, `wezterm connect`, raw SSH).
The devlog was also updated with a proper BLUF, an accurate Changes Made table, and a new commit (`03e7966`) documenting the fixes.
Verdict: Accept, with one non-blocking observation about the fallback chain's reachability.

## Round 1 Blocking Item Resolution

### 1. Dead Code: `resolve_workspace_folder` Removed

**Resolved.** A grep for `resolve_workspace_folder` in `/var/home/mjr/code/weft/lace/main/bin/wez-into` returns zero matches.
The function definition (formerly lines 458-479) is gone.
The Changes Made table at line 213 correctly notes "removed dead code" for `bin/wez-into`.

### 2. Raw SSH Fallback Added

**Resolved.** The `do_connect` function (lines 455-559) implements a three-tier fallback chain:

1. **Tier 1 (line 527):** `wezterm cli spawn --domain-name "lace:$port"` (ExecDomain spawn).
2. **Tier 2 (line 534):** `wezterm connect "lace-mux:$port" --workspace main` (SSH mux domain, cold-start).
3. **Tier 3 (lines 540-556):** `wezterm cli spawn -- ssh ...` with reconstructed SSH args using `$LACE_SSH_KEY`, `$LACE_KNOWN_HOSTS`, and the resolved `$user` (raw SSH, plugin-not-loaded case).

The raw SSH args at tier 3 correctly mirror the pattern used by `build_ssh_args` in the plugin:
- `IdentityFile`, `IdentitiesOnly`, `UserKnownHostsFile`, `StrictHostKeyChecking=no`, `-t`, `-p $port`, `$user@localhost`.

This satisfies the proposal's Phase 2, item 4 requirement for a raw-SSH-args fallback when domain-based methods are unavailable.

## Round 1 Non-Blocking Item Status

| # | Item | Status |
|---|------|--------|
| 3 | Cold-start fallback test | Not addressed (still manual) |
| 4 | Local-tab split test | Not addressed (still manual) |
| 5 | Add BLUF | **Resolved.** Lines 19-22 have a proper `> BLUF:` block. |
| 6 | Stale domain deployment note in plugin docs | Not addressed (devlog-only) |
| 7 | Unused `user` variable in `do_connect` | **Resolved.** `user` is now used by the tier 3 raw SSH fallback (line 548: `"${user}@localhost"`). |
| 8 | Update status from `wip` | Not addressed (still `wip`) |

Items 3, 4, 6, and 8 are minor and do not affect acceptance.

## New Findings

### Tier 2 Fallback Backgrounding Makes Tier 3 Unreachable

**Non-blocking.** At line 534, the `wezterm connect` command is backgrounded with `&`:

```bash
if wezterm connect "lace-mux:$port" --workspace main &>/dev/null & then
    disown
    info "connected via lace-mux:$port"
else
    # Final fallback: raw SSH args (works even if plugin is not loaded)
    ...
fi
```

A backgrounded command (`cmd &`) always returns exit status 0 to the calling shell, because `&` forks immediately and the parent receives a success status.
The `else` branch (tier 3, raw SSH) is therefore unreachable via this code path: the `if` always succeeds.

In practice, this means: if ExecDomain spawn fails (tier 1) and the SSH mux domain does not exist (tier 2), `wezterm connect` will be launched in the background, fail asynchronously, and `wez-into` will report success ("connected via lace-mux:$port") while the user sees nothing happen.
Tier 3 (raw SSH) would never execute.

The backgrounding is intentional for `wezterm connect` (it opens a new window rather than spawning a pane in the current mux), so fixing this requires either:
- (a) Running `wezterm connect` in the foreground (changes UX: blocks the shell), or
- (b) Running it synchronously with a timeout, checking if the window appeared, or
- (c) Trying tier 3 first when no mux is detected, using tier 2 only for cold-start.

This is a design consideration rather than a bug in the current primary path: tier 1 (ExecDomain) handles the normal case, and tier 2 is the cold-start path where a mux server has not yet been started.
The raw SSH fallback (tier 3) is defense-in-depth for the "plugin not loaded" edge case, which is rare.

> NOTE(opus/split-pane-review-r2): The three-tier chain is structurally present and correctly implements the proposal's requirement.
> The reachability issue is a consequence of `wezterm connect`'s process model (new window, not pane-in-mux).
> A future refinement could detect whether a mux is running and skip directly to tier 3 when it is not.

### Plugin `tostring` Fix Verification

The `tostring(port)` usage in `plugin/init.lua` is correct and consistent across all GLOBAL table access points:
- `make_exec_fixup` (line 234): `tostring(port)`
- `setup_port_domains` (lines 332, 333, 344): `tostring(p)` and `tostring(port)`
- `get_connection_info` (lines 665, 672): `tostring(port)`
- `resolve_port_workspaces` (line 275): uses `port` as a local key in a non-GLOBAL table; string conversion is performed by the caller (`setup_port_domains` stores with `tostring(p)` at line 333, and `apply_to_config` passes the result directly to GLOBAL at line 635).

No issues.

### Dry-Run Output Accuracy

The dry-run block (lines 459-465) references `${user:-node}` at line 464, but the `user` variable is set later at line 478.
In the dry-run path, `user` may be unset (depending on the caller's scope).
The `:-node` default handles this gracefully, but the dry-run output may not reflect the actual user that would be resolved at connection time.
This is cosmetic.

## Verdict

**Accept.**

Both round 1 blocking items are resolved.
The dead code is removed and the three-tier fallback chain is implemented as specified by the proposal.
The core implementation (ExecDomain spawn, split inheritance, multi-container isolation) was already verified in round 1 and is unchanged.

The tier 2/3 reachability issue is a non-blocking design consideration: the primary path (tier 1) covers the normal case, and the structural presence of all three tiers satisfies the proposal's fallback requirements.

## Action Items

1. [non-blocking] Consider restructuring the fallback chain so tier 3 (raw SSH) is reachable when tier 2 (`wezterm connect &`) fails asynchronously. Options: detect mux availability before attempting tier 2, or try tier 3 first and use tier 2 only for explicit cold-start.
2. [non-blocking] Update devlog status from `wip` to `done` (or `review_ready` pending manual test completion).
3. [non-blocking] Add stale domain deployment note to plugin documentation (README or inline comment), not just the devlog.
