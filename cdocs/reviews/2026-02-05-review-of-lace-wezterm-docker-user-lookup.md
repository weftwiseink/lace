---
review_of: cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:58:00-08:00
task_list: lace/wezterm-plugin
type: review
state: archived
status: done
tags: [fresh_agent]
round: 1
---

# Review: Docker-Based SSH Username Lookup for lace.wezterm Plugin

## Summary Assessment

A lean, well-scoped proposal that correctly identifies the problem (hardcoded username) and proposes a pragmatic solution (use the already-discovered username at connection time through the project picker). The proposal benefits from the fact that `discover_projects()` already does the Docker user lookup -- the gap is only in how that information is used at connection time.

## Section-by-Section Findings

### BLUF

Clear and accurate. Correctly frames both the problem and the dependency relationship with the launcher elimination proposal.

### Objective

Concise, three clear goals. No issues.

### Background

**Non-blocking:** The "What Docker Tells Us" section mentions `Config.User` as the primary source, but does not discuss `remoteUser` from the devcontainer metadata label. In practice, `Config.User` reflects the actual running user (which is what SSH needs), so this is the correct choice. But it would be worth a one-sentence note explaining why `Config.User` is preferred over parsing `remoteUser` from the metadata label -- `Config.User` is authoritative (it is what the container actually runs as), while `remoteUser` is a devcontainer CLI concept that may or may not match the SSH user.

### Proposed Solution

**Blocking (B1): The `ConnectToUri` approach needs validation.** The proposal suggests using `ConnectToUri` with `ssh://user@localhost:port` as the connection mechanism, but this bypasses the SSH domain entirely -- including its configured `identityfile`, `multiplexing` mode, and any other `ssh_option` settings. If `ConnectToUri` is used, the SSH key and other options must be specified separately, or the connection will fail (no key = SSH rejection). The proposal should either:
- (a) Confirm that `ConnectToUri` can accept SSH options (identity file, strict host key checking), or
- (b) Use a different approach: dynamically create/update the SSH domain for the discovered port with the correct username before connecting, or
- (c) Use `SpawnCommand` with the existing domain but override the username field

This is a critical implementation detail. The pre-registered domains exist precisely to bundle the SSH key and multiplexing options. Bypassing them loses those settings.

**Non-blocking (NB1):** The "Connection Paths and Username Resolution" table is helpful. Consider noting that `wez-lace-into` already resolves the correct username via `lace-discover` and passes it through -- this means the CLI path already works correctly today, and this proposal only fixes the WezTerm-native project picker path.

### Edge Cases

Thorough for a lean proposal. The UID case is correctly handled. The "Docker not available" and "no container running" cases are well-covered.

**Non-blocking (NB2):** Missing edge case: what happens if two containers are running on the same port? This cannot happen (Docker rejects duplicate port bindings), but a one-liner acknowledging this would close the loop.

### Implementation Plan

**Blocking (B2): Phase 1 is vague on the WezTerm API mechanism.** "Determine which works at implementation time" is acceptable for a lean proposal, but given that the `ConnectToUri` approach may not carry SSH options (see B1), the proposal should at minimum list the candidate approaches and their tradeoffs:
1. `ConnectToUri` -- simple but loses SSH domain config
2. Dynamic domain creation -- register a temporary domain with the correct username at connection time
3. Modify `SpawnCommand` to override username -- may not be supported by WezTerm's SSH domain model

The implementer needs enough guidance to avoid the `ConnectToUri` pitfall.

### Test Plan

Adequate. Covers the key scenarios (multi-user, fallback, Docker unavailable).

## Verdict

**Revision requested.** Two blocking items:
- B1: Clarify that `ConnectToUri` bypasses SSH domain configuration (identity file, multiplexing) and may not work without additional options. Recommend the approach of dynamically overriding the domain or validating that `ConnectToUri` accepts SSH options.
- B2: List candidate WezTerm API approaches with tradeoffs so the implementer can make an informed choice.

Both are addressable with targeted edits -- no structural rewrite needed.

## Action Items

- [x] **(B1)** Address `ConnectToUri` SSH options concern -- replaced with domain re-registration approach; documented why ConnectToUri is rejected
- [x] **(B2)** Enumerate candidate WezTerm API approaches with tradeoffs in the implementation plan -- added comparison table with three approaches
- [x] (NB1) Note that `wez-lace-into` already handles username correctly via `lace-discover` -- added to Connection Paths section
- [x] (NB2) Acknowledge that duplicate port bindings are impossible (Docker enforces uniqueness) -- added edge case section
