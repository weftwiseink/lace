---
review_of: cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:55:00-08:00
type: review
state: archived
status: done
tags: [revision_review, docker-cli, implementation_plan, test_methodology, architecture]
---

# Review: Port-Scanning WezTerm Discovery (Round 3 - Post-Revision)

## Summary Assessment

This revision successfully addresses all four feedback items from the user: removing custom `LACE_PROJECT_NAME` in favor of Docker labels, eliminating startup-time discovery, removing settings.json dependency, and significantly expanding implementation phases with detailed test methodology. The proposal is now well-aligned with the decoupled, Docker-native approach and provides excellent implementation guidance. The test plans are thorough with specific commands, expected outputs, and debugging steps.

**Verdict: Accept**

## Feedback Integration Verification

### 1. Remove projectName/LACE_PROJECT_NAME
**Status: Addressed**

The revision correctly replaces `LACE_PROJECT_NAME` with Docker's `devcontainer.local_folder` label (Layer 3). The design decision D3 explicitly documents this tradeoff. Project name is derived via `basename` of the local folder path. The fallback for remote containers (git URL, then container name) is also mentioned.

### 2. Don't discover at startup
**Status: Addressed**

Layer 4 explicitly states: "Discovery runs ONLY when the picker is invoked, not at startup." The Background section now includes a new subsection "Problem with Startup-Time Discovery" explaining why startup discovery was removed. Design decision D2 documents this choice.

### 3. Don't use settings.json
**Status: Addressed**

The Configuration section now states the ONLY configuration is the SSH key path in wezterm.lua. Design decision D5 explicitly states "All discovery info comes from Docker. No settings.json dependency." The "What Settings.json Is Still Needed For" section from the previous revision has been removed.

### 4. Expanded implementation/test plan
**Status: Addressed**

Implementation Phases expanded from 4 sparse phases to 5 detailed phases with:
- Specific test commands with copy-pasteable bash/lua snippets
- Expected outputs for each test
- Debugging steps for common failure modes
- Clear "Done Criteria" checklists for each phase

## Section-by-Section Findings

### BLUF and Objective
**Assessment: Good**

BLUF accurately summarizes the revised approach. Objective correctly lists on-demand discovery, Docker CLI, and zero configuration.

### Background
**Assessment: Good**

The new "Problem with Startup-Time Discovery" subsection provides clear rationale for the change. Bullet points are specific and actionable.

### Layer 3: Docker-Based Container Identity
**Assessment: Good**

Clear documentation of available Docker labels with example commands. The `docker ps` and `docker inspect` commands shown match actual Docker output formats (verified against real container in the task context).

**Non-blocking observation**: The port regex `0%.0%.0%.0:(%d+)%->2222/tcp` in Lua assumes the format `0.0.0.0:PORT->2222/tcp`. The actual Docker output shows both IPv4 and IPv6 bindings (`0.0.0.0:2222->2222/tcp, [::]:2222->2222/tcp`). The regex handles this correctly by only matching the IPv4 binding.

### Layer 4: On-Demand Discovery via Docker CLI
**Assessment: Good**

The Lua code correctly handles:
- Running Docker CLI via `wezterm.run_child_process`
- Parsing tab-separated output
- Extracting project name from path
- Port filtering for the 22425-22499 range
- Fallback to "node" for empty user

**Non-blocking observation**: The code makes a second `docker inspect` call for each container to get the user. This could be optimized to extract user from `devcontainer.metadata` label in a single call, but the impact is minimal (~10ms per container).

### Layer 6: Domain Registration Strategy
**Assessment: Good**

Pre-registering 75 domains at startup is the correct approach for WezTerm's architecture. The code correctly initializes `config.ssh_domains` if nil.

### Layer 7: CLI Command
**Assessment: Good with minor issue**

The bash script logic is sound. The `discover_projects` function correctly uses Docker CLI and extracts all needed info.

**Non-blocking**: The `grep -oP` uses Perl regex, which may not be available on all systems (e.g., macOS default grep). Consider using a more portable approach or noting this dependency.

### Implementation Phases
**Assessment: Excellent**

The expanded phases are exactly what was requested:
- Phase 1 includes `nc -l` testing for port availability
- Phase 2 has step-by-step Docker label verification commands
- Phase 3 includes Lua test snippets with `wezterm.log_info`
- Phase 4 covers both fzf and non-fzf scenarios
- Phase 5 provides end-to-end integration scenarios

Each phase has:
- Clear scope with specific files
- Numbered test steps with commands
- Expected outputs
- Debugging steps
- Done criteria checklist

### Edge Cases
**Assessment: Good**

E5 (same project name from different paths) correctly identifies this as a collision case and suggests prevention via unique folder names. This is the expected behavior given the design choice to use basename.

### Design Decisions
**Assessment: Good**

All six design decisions are well-documented with tradeoffs clearly stated. D1-D3 specifically address the feedback items.

## Minor Observations (Non-blocking)

1. **Title still says "Port-Scanning"**: The discovery mechanism is now Docker CLI-based, not port scanning. The title is slightly misleading but acceptable since ports are still the discovery target.

2. **Performance claims**: The proposal claims ~100ms for Docker discovery. This is reasonable but would benefit from actual measurement during implementation (covered in Phase 2 tests).

3. **IPv6-only hosts**: The port regex only matches IPv4 bindings. On an IPv6-only host, the regex would fail. This is an edge case unlikely to affect typical devcontainer usage.

## Verdict

**Accept**

All feedback has been integrated. The proposal is ready for implementation. The expanded test methodology provides excellent guidance for implementors.

## Action Items

1. [non-blocking] Consider renaming to "Docker-Based WezTerm Discovery" in a future revision to better reflect the mechanism.
2. [non-blocking] Note the `grep -oP` dependency in the CLI script, or use a more portable regex approach.
3. [non-blocking] During implementation, verify the 100ms performance claim and adjust if needed.

No blocking issues. Proposal is approved for implementation.
