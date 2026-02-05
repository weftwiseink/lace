---
review_of: cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T14:00:00-08:00
task_list: lace/devcontainer-workflow
type: review
state: archived
status: done
tags: [fresh_agent, devcontainer, workflow_automation, developer_experience, lifecycle_hooks, technical_accuracy]
---

# Review: Auto-Attach WezTerm Workspace After Devcontainer Setup

## Summary Assessment

This proposal aims to replace a multi-step manual process (start devcontainer, wait, press Leader+D) with a single `bin/open-weft-workspace` script that chains `devcontainer up`, a readiness poll, and `wezterm connect weft`. The overall quality is high: the BLUF is clear and accurate, the lifecycle hook analysis is correct, the design decisions are well-reasoned with genuine tradeoffs, and the scope is appropriately constrained to a PoC. The most important findings are: (1) the readiness check command has a technical issue that would cause it to fail even when services are ready, (2) the relationship to the existing `packages/lace` CLI proposal is unaddressed, and (3) the `wezterm connect` vs `SwitchToWorkspace` behavioral difference is more significant than the proposal acknowledges. Verdict: **Revise** to address one blocking issue and several substantive non-blocking items.

## Section-by-Section Findings

### BLUF

The BLUF is well-structured and follows the established proposal conventions: problem statement, constraint (no host-side post-ready hook), solution, and concrete behavior. It correctly identifies the key technical constraint and the proposed workaround.

**Finding**: The BLUF says the script "(1) runs `devcontainer up` if needed." The word "if needed" implies the script conditionally runs `devcontainer up`, but the body clarifies that `devcontainer up` is always run (it is idempotent). The BLUF phrasing is slightly misleading -- the script always invokes `devcontainer up`; the "if needed" part is handled by `devcontainer up` itself. **Non-blocking**: Minor wording. Consider "runs `devcontainer up` (idempotent)" instead.

### Objective

Clear and concise. The objective correctly frames this as a developer-experience improvement and accurately describes the current multi-step workflow.

### Background: Current Workflow

The five-step workflow description is accurate when cross-referenced against the actual project configuration:
- `devcontainer.json` confirms `postCreateCommand` runs `git config --global --add safe.directory '*'` and `postStartCommand` runs `wezterm-mux-server --daemonize 2>/dev/null || true`.
- `wezterm.lua` confirms the `weft` SSH domain at `localhost:2222` and the Leader+D binding using `SwitchToWorkspace`.
- Port 2222 is exposed via `appPort` in `devcontainer.json`.

**Finding**: The proposal says "Developer presses Leader+D to connect to the weft SSH domain." This is correct per `wezterm.lua` line 141-151, where Leader+D triggers `SwitchToWorkspace` with `domain = { DomainName = "weft" }`. However, the proposal later (Decision 2) equates this with `wezterm connect weft`, which is not the same behavior. `SwitchToWorkspace` operates within an existing WezTerm process and creates/switches to a named workspace. `wezterm connect weft` spawns a new WezTerm GUI window. These are different operations with different UX implications. See the Decision 2 finding below for the full analysis. **Non-blocking** here, but relevant to Decision 2.

### Background: Devcontainer Lifecycle Hooks

The lifecycle hook table is accurate against the devcontainer spec. The six hooks are listed in the correct order with the correct execution context (host vs container) and timing.

**Finding**: The proposal says "There is no `postReadyCommand` or equivalent that runs on the host after the container is fully set up." This is correct. The spec does define a `waitFor` property that controls which lifecycle event the tool waits for before considering the container "ready," but `waitFor` is a configuration for the client tool (VS Code, CLI), not a hook that fires on the host. The proposal's conclusion -- that `devcontainer up && host-command` is the spec-aligned approach -- is sound. **No action needed**: the analysis is accurate.

**Finding**: The proposal says `postCreateCommand` runs on "First creation only." The devcontainer spec actually says `postCreateCommand` runs after `onCreateCommand` and `updateContentCommand` during first creation. However, `postCreateCommand` does also run when the container is rebuilt, not just on literal first creation. The distinction is minor in this context and does not affect the proposal's reasoning. **Non-blocking**: Consider saying "after creation (including rebuild)" for precision, or leave as-is since it does not affect the solution.

### Background: `devcontainer up` CLI Behavior

The description of `devcontainer up` as synchronous and returning JSON is correct. The claim that it "blocks until the container is running and all lifecycle hooks through `postStartCommand` have executed" is accurate per the devcontainer CLI documentation and behavior.

**Finding**: The sample JSON output shows `remoteWorkspaceFolder` as `/workspaces/project`, but the actual `devcontainer.json` sets `workspaceFolder` to `/workspace/main` (singular "workspace", not "workspaces"). This is a minor detail in an illustrative example, but could cause confusion if someone copies it as-is. **Non-blocking**: Update the example to use `/workspace/main` to match the actual configuration, or add a note that the example is illustrative.

### Background: Existing WezTerm Connect Infrastructure

Accurate. The `weft` SSH domain is confirmed in `wezterm.lua` lines 64-75, connecting to `localhost:2222` with the `node` user and `~/.ssh/weft_devcontainer` key. The `wezterm connect weft` CLI command and the Leader+D `SwitchToWorkspace` approach are both accurately described.

### Proposed Solution: Script Behavior

The three-step script behavior (devcontainer up, readiness poll, wezterm connect) is well-structured and addresses the core problem.

**Finding (BLOCKING)**: Step 2 describes polling with `ssh -p 2222 -o ConnectTimeout=1 node@localhost wezterm cli list`. The `wezterm cli list` command requires the `wezterm` CLI to connect to a running mux server. Inside the container, `wezterm cli list` communicates with `wezterm-mux-server` via a Unix socket (the default is `$XDG_RUNTIME_DIR/wezterm/mux-*`). However, the SSH command connects as the `node` user and runs `wezterm cli list` in a fresh SSH session. For this to work, the `WEZTERM_UNIX_SOCKET` or `XDG_RUNTIME_DIR` environment variable must be set correctly in the SSH session. SSH sessions do not inherit the environment from `postStartCommand`. The sshd feature likely does not set `XDG_RUNTIME_DIR` for the `node` user. If `XDG_RUNTIME_DIR` is not set, `wezterm cli list` will look for the socket at a default path that may not match where `wezterm-mux-server --daemonize` created it.

A simpler and more reliable readiness check would be to verify that `ssh -p 2222 -i ~/.ssh/weft_devcontainer -o ConnectTimeout=1 -o StrictHostKeyChecking=no node@localhost true` succeeds (confirming sshd is up and authentication works), since `wezterm connect weft` handles the mux server connection negotiation itself. If the mux server is not ready, `wezterm connect` will fail with a clear error, which is better than a misleading timeout from the wrapper script.

Alternatively, if you want to verify the mux server specifically, set `XDG_RUNTIME_DIR=/run/user/$(id -u)` in the SSH command: `ssh ... node@localhost 'XDG_RUNTIME_DIR=/run/user/1000 wezterm cli list'`. But this hard-codes UID 1000 and adds complexity.

**Blocking**: The readiness check command as specified will likely fail with a socket-not-found error even when services are fully running. Revise the readiness check strategy.

**Finding**: Step 2 mentions the SSH key path (`-i ~/.ssh/weft_devcontainer`) only in the Phase 1 implementation section (Step 4), not in the Script Behavior section. The readiness check in the Script Behavior section omits the `-i` flag, which means it would use the default SSH key and likely fail. **Non-blocking** (subsumed by the blocking finding above): ensure the readiness check command is consistent between sections.

### Script Location and Naming

The `bin/open-weft-workspace` naming is reasonable and follows the precedent of `bin/nvim`. The `bin/nvim` script (confirmed to exist at `/var/home/mjr/code/weft/lace/bin/nvim`) is a 13-line bash wrapper that sets environment variables and execs nvim, so the pattern is established.

**Finding**: The proposal does not address the relationship between this script and the `packages/lace` CLI proposed in `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`. That proposal describes a `lace` CLI with `lace up` and `lace prebuild` subcommands that wrap `devcontainer up`. The `open-weft-workspace` script duplicates part of the `lace up` functionality (running `devcontainer up --workspace-folder`). If the `lace` CLI is implemented, should `open-weft-workspace` call `lace up` instead of `devcontainer up` directly? Should the WezTerm-attach logic eventually become `lace connect` or `lace workspace`? The proposals should cross-reference each other. **Non-blocking**: Add a note in the Background or Future Work section acknowledging the `packages/lace` CLI and how this script relates to it. The PoC script is reasonable as a standalone first step, but the convergence path should be documented.

### Design Decisions

**Decision 1 (wrapper script over hook)**: Sound. The analysis of the devcontainer spec is accurate. `initializeCommand` runs before container creation, `postAttachCommand` runs inside the container. There is no host-side post-ready hook. A wrapper script around `devcontainer up` is the correct approach.

**Decision 2 (wezterm connect vs wezterm cli spawn)**: The reasoning is solid but understates a behavioral difference.

**Finding**: The proposal says `wezterm connect weft` "matches the behavior of the existing Leader+D keybinding (which uses `SwitchToWorkspace`)." This is not accurate. `SwitchToWorkspace` in wezterm.lua (line 144) creates or switches to a named workspace called "weft" *within the current WezTerm process*. If the workspace already exists, it switches to it. `wezterm connect weft` always creates a new WezTerm GUI window. These have different behaviors:

1. Leader+D is idempotent within a WezTerm session (creates the workspace once, switches to it on subsequent presses).
2. `wezterm connect weft` always spawns a new window, even if one is already connected.

The proposal acknowledges this in the NOTE ("If wezterm is already running with a `weft` workspace, `wezterm connect weft` opens a second window") but frames it as acceptable. This means running `./bin/open-weft-workspace` twice will open two separate WezTerm windows both connected to the same mux server. The mux server handles this fine, but it is a different UX from Leader+D.

**Non-blocking**: Do not claim behavioral equivalence with Leader+D. Instead, state clearly: "The script always opens a new WezTerm window. If a window is already connected to the weft domain, a second window will be created." The future refinement to detect and focus existing windows is the right mitigation.

**Decision 3 (poll vs sleep)**: Sound. Polling the actual service is the right approach. The 15-second timeout is reasonable.

**Decision 4 (devcontainer up vs docker compose)**: Sound. `devcontainer up` is the correct abstraction layer.

### Stories

The four stories are well-chosen and cover the main usage patterns. The "SSH key is missing" and "Port 2222 in use" stories cover realistic failure modes.

**Finding**: The "Container needs to be rebuilt" story says "`devcontainer up` detects the change and rebuilds." This is not quite right. `devcontainer up` does not automatically rebuild when the Dockerfile changes. The user must pass `--build-no-cache` or the devcontainer CLI must detect metadata changes (in `devcontainer.json`). Dockerfile content changes alone do not trigger a rebuild if the image is already cached. **Non-blocking**: Clarify that Dockerfile-change rebuilds may require explicit `--rebuild` or `--build-no-cache`, or note that this depends on Docker layer caching behavior.

### Edge Cases / Challenging Scenarios

The edge cases are relevant and well-analyzed.

**Finding**: The "Container starts but wezterm-mux-server fails to daemonize" section correctly identifies that the `|| true` in `postStartCommand` swallows errors. It notes this is "silent until connection time." This is a real concern. If the readiness check is changed to just verify SSH connectivity (per the blocking finding above), a mux server failure would only surface when `wezterm connect` fails. The script should capture the `wezterm connect` exit code and provide a diagnostic message in this case. **Non-blocking**: Add a note that the script should handle `wezterm connect` failures with a helpful error message pointing to possible mux-server issues.

**Finding**: The edge case for "Multiple devcontainer configurations" is a good forward-looking note. The proposal correctly scopes it out. However, `devcontainer up` also accepts a `--config` flag, not just implied from the workspace folder. **Non-blocking**: Minor detail; the `--config-path` naming in the proposal is close enough.

### Implementation Phases

**Phase 1**: The implementation steps are detailed and actionable. The success criteria are concrete.

**Finding**: Step 4 specifies "exponential backoff, max 15 seconds" for the readiness poll. Exponential backoff for a 15-second window is more complexity than needed. A simple fixed-interval retry (e.g., every 1 second for 15 attempts) would be simpler and just as effective for this use case. The services either come up within a few seconds or something is wrong. **Non-blocking**: Consider simplifying to a fixed 1-second interval. Exponential backoff is more appropriate for longer timeouts or external service polling.

**Finding**: Step 6 says "On timeout, print diagnostic output (which service failed, how to debug)." The script should distinguish between `devcontainer up` failure (container did not start), SSH failure (sshd not ready or auth failed), and mux server failure (SSH works but wezterm connect fails). These have different diagnostic paths. **Non-blocking**: Good aspiration, but the script should at least report which stage failed.

**Finding**: The constraints say "POSIX-compatible bash (no bashisms beyond what is standard on Linux)." This is contradictory: "POSIX-compatible bash" and "no bashisms" are different goals. POSIX sh scripts do not use bashisms; bash scripts can use bashisms. `bin/nvim` uses `#!/bin/bash` and `${BASH_SOURCE[0]}` (a bashism). The constraint should either say "bash script (following bin/nvim precedent)" or "POSIX sh script." Given the precedent and that this runs on the developer's host (where bash is virtually guaranteed), bash is the right choice. **Non-blocking**: Clarify the shell compatibility target. Recommend `#!/bin/bash` to match `bin/nvim`.

**Phase 2**: Reasonable scope for documentation and integration testing.

**Phase 3**: The future improvements are all sensible. The `gui-startup` hook integration and the `bin/lace` wrapper ideas are well-considered.

**Finding**: Phase 3 mentions a `bin/lace` wrapper "that combines devcontainer management and workspace entry as subcommands." This directly overlaps with the `packages/lace` CLI proposal (`cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`), which already defines `lace up`, `lace prebuild`, etc. This is the same convergence concern raised earlier. **Non-blocking**: Cross-reference the existing lace CLI proposal.

### Missing: Test Plan

**Finding**: The proposal has no explicit Test Plan section. The other accepted proposals in this project (e.g., `2026-01-30-devcontainer-feature-based-tooling.md`, `2026-01-30-scaffold-devcontainer-features-wezterm-server.md`) include dedicated Test Plan sections. The success criteria in Phase 1 partially cover this, but a dedicated section would be consistent with the established format. **Non-blocking**: Consider adding a Test Plan section, or note that testing is covered by the Phase 1 success criteria. At minimum, describe: (a) manual test procedure, (b) what constitutes a passing test from a stopped-container state, (c) what constitutes a passing test from a running-container state.

### Missing: Relationship to Existing Proposals

**Finding**: The proposal does not reference any related proposals. It should at minimum reference:
1. `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md` -- the wezterm-server feature that provides the mux server this script connects to.
2. `cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md` -- the lace CLI that wraps `devcontainer up` and would be the natural home for this functionality long-term.
3. `cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md` -- SSH key management that is a prerequisite for the readiness check and `wezterm connect`.

**Non-blocking**: Add a "Related Workstreams" subsection in the Background section, following the pattern used in the scaffold proposal.

## Verdict

**Revise**: One blocking issue must be addressed before acceptance.

The readiness check command (`wezterm cli list` over SSH) will likely fail due to missing `XDG_RUNTIME_DIR` in the SSH session environment. The check should be revised to either (a) verify SSH connectivity only, letting `wezterm connect` handle mux negotiation, or (b) explicitly set the runtime directory in the SSH command. Option (a) is simpler and recommended.

The non-blocking items would strengthen the proposal but do not prevent implementation. The proposal is otherwise well-written, technically sound, and appropriately scoped for a PoC.

## Action Items

1. [blocking] Revise the readiness check strategy. The `wezterm cli list` command over SSH will fail without `XDG_RUNTIME_DIR` set. Replace with a simpler SSH connectivity check (`ssh ... node@localhost true`) or explicitly set `XDG_RUNTIME_DIR=/run/user/1000` in the command. Document the rationale for the chosen approach.
2. [non-blocking] Add a "Related Workstreams" subsection referencing the wezterm-server feature proposal, the lace CLI proposal, and the SSH key management proposal. Follow the pattern from `2026-01-30-scaffold-devcontainer-features-wezterm-server.md`.
3. [non-blocking] Correct the behavioral comparison between `wezterm connect weft` and Leader+D (`SwitchToWorkspace`). They are not equivalent: `connect` always opens a new window; `SwitchToWorkspace` creates-or-switches within an existing process.
4. [non-blocking] Clarify the shell compatibility target in Phase 1 constraints. Recommend `#!/bin/bash` to match the existing `bin/nvim` precedent rather than the contradictory "POSIX-compatible bash."
5. [non-blocking] Add a note that `devcontainer up` does not automatically rebuild on Dockerfile changes (the "container needs to be rebuilt" story).
6. [non-blocking] Simplify the retry strategy from exponential backoff to fixed-interval polling (1-second intervals for 15 attempts). Exponential backoff adds complexity without benefit in a 15-second window.
7. [non-blocking] Update the `devcontainer up` JSON output example to use `/workspace/main` to match the actual project configuration, or note it is illustrative.
8. [non-blocking] Add a Test Plan section for consistency with other proposals in the project.
