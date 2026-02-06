---
review_of: cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T20:30:00-08:00
task_list: lace/dotfiles-migration
type: review
state: archived
status: done
tags: [self, architecture, feasibility, username-mismatch, known-hosts, ergonomics]
---

# Review: Eliminate Dotfiles Workspace Launcher Script

## Summary Assessment

This proposal makes a compelling argument for eliminating the dotfiles launcher script by leveraging the existing lace ecosystem rather than parameterizing the launcher (the superseded approach). The core insight -- that every launcher responsibility already has a lace ecosystem equivalent -- is sound and well-articulated. However, the proposal has one blocking issue: the lace.wezterm plugin registers all 75 SSH domains with a single username (defaulting to `node`), but the dotfiles container uses `vscode`. This means `wezterm connect lace:22426` will attempt to SSH as `node` into a container that only has `vscode`'s authorized_keys configured, and the connection will fail. The proposal acknowledges this in Open Question 4 but treats it as an open question rather than a blocking prerequisite that must be resolved before the migration can work. Additionally, several claims about WezTerm's behavior (internal SSH retry, known_hosts handling) deserve scrutiny. Verdict: **Revise** -- resolve the username mismatch and tighten the known_hosts story.

## Section-by-Section Findings

### BLUF

The BLUF is clear, well-structured, and accurately summarizes the proposal. The "key insight" callout reframing the question from "how to deduplicate" to "why does this need to exist" is effective. The BLUF correctly identifies the prerequisites (port change, key change) and the end-state workflow.

One inaccuracy: the BLUF states "no manual known_hosts management" but the proposal later acknowledges (in Edge Cases > Known Hosts Rejection) that manual `ssh-keygen -R` may be needed after rebuilds. This is a minor inconsistency.

**Finding: non-blocking.** Consider softening the known_hosts claim in the BLUF or noting the caveat.

### Background

The five-task decomposition table is excellent. Mapping each launcher responsibility to its lace ecosystem equivalent makes the argument concrete and verifiable.

**Finding (blocking): The "SSH readiness polling" row claims "WezTerm retries SSH connection internally."** This needs verification. WezTerm's `wezterm connect` command initiates a connection to an SSH domain. If the SSH server is not yet ready, WezTerm's behavior depends on the SSH backend (libssh2). In practice, WezTerm will show a connection error dialog or fail, not silently retry. The launcher's SSH polling loop (attempts with `ssh ... true`) exists precisely because there is a window between `devcontainer up` returning and sshd being ready. If the user runs `devcontainer up && wez-lace-into dotfiles` immediately, the connection may fail. The proposal should either:
  - (a) Verify that WezTerm does retry internally and document the mechanism, or
  - (b) Acknowledge that the user may need to wait a few seconds or retry manually, or
  - (c) Propose that `wez-lace-into` add a lightweight SSH readiness check before calling `wezterm connect`

This is listed as blocking because it affects the core claim that "no host-side polling loop is needed."

### Proposed Solution

The architecture diagram is clean and the three devcontainer.json changes are clearly specified.

**Finding (blocking): Username mismatch.** The proposal states under "3. No other changes needed" that "The `vscode` user is fine -- `lace-discover` detects the container user from Docker metadata." This is true for discovery, but irrelevant for connection. The connection path is:

1. `wez-lace-into dotfiles` or project picker selects the project
2. `wezterm connect lace:22426` is executed
3. WezTerm looks up the pre-registered `lace:22426` SSH domain
4. The domain was registered with `username = opts.username` (default: `"node"`)
5. WezTerm SSHes as `node@localhost:22426`
6. The container only has `vscode`'s authorized_keys -- connection rejected

Neither `wez-lace-into` nor the project picker passes the discovered user to `wezterm connect`. The SSH domain's username is baked in at WezTerm config load time. This is a fundamental gap.

Resolution options (the proposal should pick one and specify it):
- **A. Change the dotfiles container user to `node`**: Align with the lace convention. Requires updating the devcontainer image/features and the authorized_keys mount path.
- **B. Modify the lace.wezterm plugin to support per-port username overrides**: Add a configuration mechanism (e.g., `port_overrides = { [22426] = { username = "vscode" } }`).
- **C. Add the lace_devcontainer public key to `node`'s authorized_keys in the dotfiles container**: The `base:ubuntu` image may or may not have a `node` user. This is fragile.
- **D. Make the dotfiles container accept SSH as any user by configuring sshd**: Non-standard and potentially insecure.

Option A is simplest if feasible. Option B is most general but requires plugin changes.

### Design Decisions

Decision 1 (Eliminate vs Parameterize) and Decision 5 (Dotfiles before Lace) are well-reasoned.

Decision 2 (Unify SSH Keys) is sound in principle but should note that the shared key means any running lace container can be accessed from any other lace container if SSH agent forwarding is configured. This is not a practical concern for localhost devcontainers but worth a sentence.

Decision 3 (Static Port) is correct. The 75-port range is far more than sufficient for individual developer use.

Decision 4 (No Replacement Script) is reasonable but slightly understates the ergonomic regression. The current launcher provides a single command that does everything. The proposed replacement requires the user to remember two separate actions (`devcontainer up` + `wez-lace-into`). This is fine for experienced users but is worth acknowledging as a tradeoff rather than dismissing entirely.

**Finding: non-blocking.** Add a brief acknowledgment that the two-step workflow is a deliberate tradeoff (simplicity of implementation vs single-command convenience).

### Edge Cases

The edge cases are thorough. The "Known Hosts Rejection" case is particularly important.

**Finding (non-blocking): The known_hosts mitigation is vague.** The proposal says "The lace.wezterm plugin can include `StrictHostKeyChecking=no` in its SSH options." Currently, it does not -- the `ssh_option` table in the plugin only sets `identityfile`. The proposal should be explicit about whether this change to the plugin is part of this proposal's scope or deferred. If deferred, the manual `ssh-keygen -R` step after every rebuild is a real ergonomic cost that should be acknowledged.

The "Mux Server Fails to Start" edge case correctly notes this was a safety net, but downplays the value. The launcher's mux-server detection and auto-restart is the kind of small reliability feature that makes the difference between "it just works" and "I need to debug why my connection failed." This is a non-blocking observation, but the proposal would be more honest if it framed this as a known ergonomic regression rather than an irrelevant concern.

### Test Plan

The test plan is organized by phase and covers the critical paths. The tables are clear.

**Finding (non-blocking): Missing negative test.** The test plan does not include a test for the "connect before container is ready" scenario. Given the SSH readiness concern above, a test like "run `wez-lace-into dotfiles` within 2 seconds of `devcontainer up` completing" would verify whether WezTerm handles the timing gap gracefully.

### Implementation Phases

Phases are well-scoped and have clear success criteria. Phase 4 is correctly marked as optional and deferred.

**Finding (non-blocking): Phase 3 should explicitly check for references to the old port 2223.** If the user's WezTerm config has a static `dotfiles` SSH domain on port 2223, that should be removed as part of cleanup. The Phase 3 constraints mention "verify no other scripts or configs reference `bin/open-dotfiles-workspace`" but should also cover the old WezTerm SSH domain config and any shell aliases pointing to port 2223.

### Open Questions

Open Question 4 (User difference) is the blocking issue discussed above. It should not be an open question; it should be resolved in the proposal's design.

Open Question 2 (Known hosts automation) is important and should at minimum specify the intended approach, even if implementation is deferred.

Open Questions 1 and 3 are genuine open questions appropriate for the proposal.

## Verdict

**Revise.** The core approach is sound, but the username mismatch between the plugin's SSH domain registration (`node`) and the dotfiles container's user (`vscode`) is a functional blocker. The proposal must specify how this is resolved before it can be implemented. The SSH readiness timing gap should also be addressed or explicitly acknowledged as a known regression.

## Action Items

1. [blocking] Resolve the username mismatch: the lace.wezterm plugin registers all SSH domains with `username = "node"`, but the dotfiles container uses `vscode`. Promote Open Question 4 to a design decision with a concrete resolution (recommend either changing the dotfiles container to use `node`, or specifying a plugin change to support per-port username overrides).

2. [blocking] Address SSH readiness timing: verify whether WezTerm retries SSH connections internally, or acknowledge that there is a timing window between `devcontainer up` completing and sshd being ready. If WezTerm does not retry, either accept this as a known regression or propose a lightweight readiness check in `wez-lace-into`.

3. [non-blocking] Tighten the known_hosts story: specify whether adding `StrictHostKeyChecking=no` to the plugin's `ssh_option` is in-scope for this proposal or deferred. If deferred, acknowledge the manual `ssh-keygen -R` step as an ergonomic cost.

4. [non-blocking] Soften the BLUF's "no manual known_hosts management" claim to match the edge case analysis.

5. [non-blocking] Acknowledge the two-step workflow (`devcontainer up` + `wez-lace-into`) as a deliberate ergonomic tradeoff rather than a pure improvement.

6. [non-blocking] Add a negative test for connecting before the container's SSH server is ready.

7. [non-blocking] In Phase 3, add cleanup of the old static `dotfiles` SSH domain from WezTerm config and any shell aliases referencing port 2223.
