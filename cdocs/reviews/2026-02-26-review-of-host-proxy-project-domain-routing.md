---
review_of: cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-26T23:15:00-06:00
task_list: lace/portless
type: review
state: live
status: done
tags: [fresh_agent, architecture, networking, proxy, test_plan, integration_feasibility]
---

# Review: Host-Side Lace Proxy for Port-Free Project Domain Routing

## Summary Assessment

This proposal adds a host-side HTTP reverse proxy to lace that eliminates port numbers from developer URLs by routing `{route}.{project}.localhost` on port 80 to the correct container's portless proxy.
The proposal is well-structured, internally consistent, and implementation-ready with clear phasing and a comprehensive test plan.
The hostname parsing scheme is sound and consistent with the portless proposal's dot-separated naming convention.
The most significant finding is a naming convention divergence from the architecture report that should be explicitly acknowledged, plus a few precision issues in the `lace up` integration description.

**Verdict: Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF and Objective

The BLUF is strong: it communicates the what (host-side proxy on port 80), the how (Node.js daemon, proxy-state.json, lace up integration), the scope boundary (zero changes to portless feature), and the degradation story.
The "Before/After" example in the Objective section is immediately clarifying.

No issues.

### Background

The prerequisite chain is clearly stated.
The DNS resolution section correctly notes that `*.localhost` resolves natively at all nesting depths, which is critical for the multi-segment hostname scheme.

No issues.

### Architecture (Sequence Diagram)

The Mermaid sequence diagram accurately depicts the full request flow: browser to proxy to Docker to portless to app.
The Host header rewriting (`web.main.lace.localhost` to `web.main.localhost`) is shown correctly.

No issues.

### Hostname Parsing

The parsing table is clear and the five examples cover the important cases: multi-segment route, single-segment route, bare project, and bare localhost.

**Non-blocking:** The table shows `lace.localhost` forwarding `Host: localhost` to portless, which serves its route listing page.
This is a nice feature, but the proposal should note that portless's behavior when receiving `Host: localhost` is implementation-dependent: if portless matches routes by exact hostname, `localhost` would only match if there is a route registered as `localhost` (no subdomain).
Worth verifying during implementation, but the fallback (portless 404 page) is acceptable either way.

### Proxy State

The JSON structure is reasonable.
`updatedAt` is useful for `lace proxy status` display.
`workspaceFolder` for diagnostics is a good inclusion.

**Non-blocking:** Consider whether the proxy-state file should also store the proxy daemon's listen port, so that `lace proxy status` can report it without reading settings.json separately.
This is a minor convenience, not a design flaw.

### `lace up` Integration

The proposal says: "This is a single post-start phase appended to the `lace up` pipeline, after `devcontainerUp` (around line 624 of `up.ts`)."

I verified: line 624 is `return result;` at the end of the `up()` function, immediately after the `devcontainerUp` phase.
The `templateResult.allocations` array (computed at line 406) contains `PortAllocation` objects with a `label` field (e.g., `portless/proxyPort`), so scanning for a matching label is straightforward.
The `projectName` variable is also available at that scope.

**Non-blocking (precision):** The proposal says "Read the resolved host port for `portless/proxyPort`" by scanning `allocations`.
This is correct, but the implementation should reference `templateResult.allocations` (which may be null if no template resolution occurred, e.g., when no prebuild features exist).
The proposal's phrasing "If no `portless/proxyPort` allocation exists, the phase is skipped entirely" covers this, but the Phase 2 implementation description could be more explicit about the null guard on `templateResult`.

### `lace proxy` Command

The self-respawning pattern (`start` spawns `start --foreground` as detached child) is clean and avoids needing a separate daemon entry point.
PID file management is standard.

**Non-blocking:** The proposal does not specify how `start` detects that the child has successfully bound port 80 before returning.
A brief startup wait with TCP probe (or a ready signal via stdout) would avoid the race where `lace proxy start` reports success but the daemon fails immediately due to a port conflict.
This is an implementation detail, but mentioning the intent would strengthen the proposal.

### `lace setup` Command

The sysctl approach is well-justified and consistent with the architecture report.
Idempotent detection via file existence is correct.

**Non-blocking:** The proposal mentions `--yes` for non-interactive mode but does not discuss what happens if the sysctl is already in effect (e.g., set manually or by another tool) but the config file does not exist.
The auto-start gate in Decision 5 checks for the file's existence, not the sysctl value.
Consider also probing `sysctl net.ipv4.ip_unprivileged_port_start` as a fallback check.

### Proxy Daemon

The use of `node:http` for both listening and proxying (via `http.request()`) is appropriate: it preserves streaming and avoids the body-buffering that `fetch()` would introduce.
WebSocket upgrade handling via raw TCP socket piping is the correct approach.

**Non-blocking:** The proxy's health probing ("TCP-probe the target port before forwarding") adds latency to every request.
Consider checking only on connection error (forward the request optimistically, serve the "not running" page if the connection is refused) rather than pre-probing.
This is a performance optimization that can be deferred.

### Design Decisions

All seven decisions are well-justified with clear reasoning.

**Decision 2 (Fixed hostname segment parsing):** The constraint about dots in project names is correctly identified and appropriately documented as a known limitation.
I verified: `deriveProjectName()` in `project-name.ts` calls `basename()` on the bare repo root path, and filesystem directory names with dots are indeed rare for git repositories.

**Decision 7 (Host-header rewriting):** Correctly identified as essential: portless routes match `web.main.localhost`, not `web.main.lace.localhost`.

No blocking issues.

### Edge Cases

The edge cases are well-chosen: project name collision, port 80 conflict, dead container, WebSocket, dots in names.
The mitigations are pragmatic (documented limitations, health probing, clear errors).

No issues.

### Test Plan

The test plan is comprehensive with 21 tests across five categories: unit, daemon lifecycle, integration, error handling, and setup.

**Non-blocking:** Test 11 (end-to-end routing) is the most critical test but has the most complex setup.
Consider specifying whether this test uses a real devcontainer or a mock portless (e.g., a simple HTTP server that routes by Host header).
A mock would make the test faster and more deterministic.

**Non-blocking:** The test plan does not include a test for the proxy's `fs.watch()` behavior when the state file is replaced atomically (write temp + rename).
Test 15 covers "file-watch update" but does not specify whether the update is via direct write or atomic rename.
Since the proposal specifies atomic writes, the test should verify that `fs.watch()` fires on rename (which it does on Linux, but is worth documenting as a test case).

### Implementation Phases

The seven phases are well-ordered with clear dependency chains: state management (1) before `lace up` integration (2), daemon (3) before command (4), setup (5) before auto-start (6).

**Non-blocking:** Phase 2 modifies `up.ts` and Phase 6 also modifies `up.ts` (auto-start logic).
Consider whether these could be combined into a single `up.ts` modification to avoid two rounds of changes to the same file.
The current split is reasonable (registration vs auto-start are distinct concerns), but the implementation could merge them if the phases are done sequentially.

### Naming Convention Consistency with Prior Documents

The architecture report (`2026-02-25-worktree-domain-routing-architecture.md`) uses hyphen-separated `{service}-{worktree}` as the portless naming convention (e.g., `web-main.weft-app.localhost`).
The portless proposal (`2026-02-26-portless-devcontainer-feature.md`, accepted round 4) switched to dot-separated `{service}.{worktree}` (e.g., `web.main.localhost:22435`).
This host proxy proposal follows the portless proposal's dot convention: `web.main.lace.localhost`.

This is the correct choice: the portless proposal is the accepted spec, and dots align better with DNS subdomain hierarchy.
However, the architecture report is now stale on this point.

**Non-blocking:** The architecture report's naming convention section should be updated to reflect the dot-separated convention adopted in the portless proposal.
This is not a flaw in the host proxy proposal, but the inconsistency across the document set could confuse a future reader.

### Missing: Startup Behavior on Reboot

The proposal does not address what happens when the host reboots.
The proxy daemon is not managed by systemd or any init system: it relies on `lace up` to auto-start it.
If a developer reboots and opens a browser before running `lace up`, URLs that previously worked will fail silently (connection refused on port 80).

**Non-blocking:** This is acceptable for the current design (the proxy is an enhancement, not infrastructure), but worth noting explicitly.
A future `systemd --user` service file could solve this.

## Verdict

**Accept.**

The proposal is well-designed, implementation-ready, and consistent with its prerequisite documents.
The hostname parsing scheme is unambiguous given the directory-basename constraint.
The `lace up` integration is feasible at the identified code location.
The test plan covers the critical paths.
All design decisions are well-justified.
The non-blocking suggestions below improve precision but do not affect the design's correctness.

## Action Items

1. [non-blocking] Verify during implementation that portless serves its route listing page when receiving `Host: localhost` (no subdomain). If not, the proxy can serve its own equivalent for the `{project}.localhost` case.
2. [non-blocking] Consider detecting startup success in `lace proxy start` (TCP probe or ready signal) before returning to the user.
3. [non-blocking] In `lace setup`, consider probing the live sysctl value as a fallback when the config file does not exist, for cases where the sysctl was set by another mechanism.
4. [non-blocking] Consider optimistic forwarding instead of pre-probing for target health (serve "not running" page on connection refused).
5. [non-blocking] Test 15 (file-watch update) should specify atomic rename as the update mechanism to verify `fs.watch()` behavior.
6. [non-blocking] Update the architecture report's naming convention section to reflect the dot-separated `{service}.{worktree}` convention adopted in the portless proposal.
7. [non-blocking] Add a note about reboot behavior: the proxy daemon requires `lace up` to restart it, with a pointer to a potential future `systemd --user` unit.
8. [non-blocking] In Phase 2 description, note the null guard needed on `templateResult` when no template resolution occurred.
