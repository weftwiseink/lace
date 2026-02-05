---
review_of: cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T23:45:00-08:00
type: review
state: archived
status: done
tags: [fresh_agent, architecture, port-allocation, registry-design, lua, wezterm]
---

# Review of Multi-Project WezTerm Plugin Proposal

## Summary Assessment

This proposal addresses a real and well-documented problem: the current WezTerm plugin cannot support multiple parallel lace projects due to hardcoded ports and domain names. The solution is comprehensive, covering port allocation, project registry, domain naming, and UI integration. The layered approach and phased implementation are well-structured. However, the proposal has several underspecified areas regarding registry file access from Lua, collision probability claims, and the interaction between the new multi-project API and the existing per-project API.

**Verdict: Revise** - The core architecture is sound, but blocking issues around Lua file I/O validation, collision probability math, and API transition need resolution before implementation.

## Section-by-Section Findings

### BLUF and Objective

The BLUF clearly articulates the five-part solution and the benefit. The objective section is well-structured with the four goals.

**Non-blocking**: The BLUF could mention backward compatibility as a fifth point, since the objective lists it.

### Background

Accurately describes the current implementation and its limitations. Good use of concrete examples showing the port binding failure scenario.

**Non-blocking**: The domain name overwrite scenario could be more precisely explained. When multiple projects "load the plugin," they're calling `apply_to_config` which appends to `config.ssh_domains`, so domains don't actually overwrite. The issue is that event handlers and keybindings conflict, not the domain registration itself. Consider clarifying.

### Layer 1: Dynamic Port Allocation

#### Port Allocation Algorithm

**Blocking**: The collision probability claim is incorrect. The proposal states "~0.5% for 10 projects" but then in Edge Case E1 states "~18%". For the birthday problem with 10 projects and 1000 slots, the collision probability is approximately `1 - (1000!/((1000-10)! * 1000^10))` which is about 4.4%, not 0.5% or 18%. The discrepancy undermines confidence in the analysis.

**Recommendation**: Run the actual calculation and state it consistently. For reference:
- 5 projects: ~1% collision probability
- 10 projects: ~4.4% collision probability
- 20 projects: ~17% collision probability

**Non-blocking**: The proposal shows Lua code for port derivation but the actual implementation will be in TypeScript (lace CLI). Consider showing the TypeScript version or noting this explicitly.

#### DevContainer Port Configuration

**Blocking**: The proposal states `lace up` will "configure Docker to map the derived host port to container port 2222." However, the mechanism isn't specified. Currently, `appPort` in devcontainer.json is static. Either:
1. `lace up` needs to rewrite devcontainer.json (or an extended version) with the computed port
2. The sshd feature needs to be configured to listen on a dynamic port
3. A different port forwarding mechanism is needed

This gap affects implementability.

**Recommendation**: Specify the exact mechanism. The lace plugins system already uses `.lace/devcontainer.json` for extended configs; this could include the computed `appPort`.

### Layer 2: Project Registry

**Blocking**: The proposal doesn't address how the WezTerm Lua plugin will read the registry file. WezTerm's Lua environment has limited file I/O capabilities (as noted in the WezTerm Sidecar proposal's Phase 0 spike items). The worktree picker already uses `wezterm.run_child_process` to run ssh commands, so a similar approach could work for reading the registry (`cat ~/.config/lace/settings.json | jq .projects`), but this adds latency to every picker invocation.

**Recommendation**: Add a feasibility note or specify the file reading approach:
- Option A: Use `io.open()` if available (validate in Phase 3)
- Option B: Use `run_child_process` with a shell command
- Option C: Cache registry in memory, refresh periodically or on config reload

**Non-blocking**: The `status` field in the registry will inevitably drift from reality (container crashed, machine rebooted, etc.). Consider documenting this as a known limitation or specifying a staleness tolerance.

### Layer 3: Domain Naming Convention

Sound design. The `lace:project` format is clear and namespaced.

**Non-blocking**: Potential edge case: what if the project name itself contains a colon after sanitization? The sanitization function replaces colons with dashes, so `foo:bar` becomes `lace:foo-bar`, which is fine. But this should be validated in the sanitization tests.

### Layer 4: Unified Project Picker

**Non-blocking**: The project picker calls `M.load_projects_from_registry()` but this function isn't defined. The proposal should either include its implementation or note it as an implementation detail.

**Non-blocking**: The picker shows status icons (running/stopped), but status may be stale. Consider adding a visual indicator for "status unknown" or "last updated X ago."

### Layer 5: Per-Project Worktree Picker

**Blocking**: The worktree picker context detection relies on `window:active_workspace()` matching a project name. But the workspace name is set to the project name when connecting via the project picker. What happens if:
1. User creates a workspace manually with an arbitrary name?
2. User is in a workspace created by the old single-project plugin?

The fallback to project picker is reasonable, but the design assumes a 1:1 mapping between workspace names and project names that isn't enforced.

**Recommendation**: Add clarity on workspace naming assumptions, or consider using a different mechanism (like a user variable or pane domain) to determine the active project.

### Design Decisions

All five decisions are well-reasoned with alternatives considered. D5 (CLI-only writes) is particularly important for avoiding race conditions.

**Non-blocking**: D2 (shared SSH key) could note the security implication more explicitly: a compromised container could use the key to access other containers. This is acceptable for personal development but worth documenting.

### Edge Cases

Good coverage of common scenarios. E1 (port collision) and E5 (migration) are particularly important.

**Non-blocking**: Missing edge case: What happens if two projects have the same name after sanitization? E.g., `My-App` and `my_app` might both become `my-app`. This could cause both registry and port collisions.

**Recommendation**: Add a unique suffix if the sanitized name already exists in the registry, or error with guidance.

### Test Plan

Good tabular format. Coverage of port allocation, registry parsing, and domain naming is appropriate.

**Non-blocking**: The integration tests don't cover the error cases (port collision detected, registry parse failure, domain name conflict). Consider adding negative test scenarios.

### Implementation Phases

Well-structured with clear scope and verification criteria for each phase.

**Blocking**: Phase 3 lists `plugin/registry.lua` and `plugin/picker.lua` as new files, but WezTerm plugins require a specific structure. The main entry point must be `plugin/init.lua`. Additional modules need `package.path` manipulation to be loadable (as documented in the WezTerm Plugin Research report). This should be noted or the file structure reconsidered.

**Recommendation**: Either:
1. Keep all code in `init.lua` (simpler for a plugin of this size)
2. Document the `package.path` setup required for multi-file plugins

### Open Questions

All five questions are relevant. Q2 (auto-registration vs. explicit) is particularly important for user experience.

**Non-blocking**: Consider adding a sixth question: "Should the project picker show projects from the registry that have never been started (no container exists)?" This affects whether the registry is purely a cache of started projects or a config of intended projects.

## API Transition Concern

**Blocking**: The proposal doesn't specify how to handle the transition from the current single-project API:

```lua
-- Current API
lace.apply_to_config(config, {
  domain_name = "lace",
  ssh_port = "localhost:2222",
  ...
})
```

to the new multi-project API. Questions:
1. Is `apply_to_config` still called per-project, or once with registry-based discovery?
2. If registry-based, how does the plugin know which ssh_key to use for each project?
3. What happens if a user has both old-style explicit config and new-style registry?

**Recommendation**: Add a "Migration and API Changes" section specifying:
- New API shape (e.g., `lace.apply_to_config(config, { registryPath: "~/.config/lace/settings.json" })`)
- Backward compatibility approach (old options still work for single-project)
- Deprecation timeline for old API

## Verdict

**Revise** - The proposal addresses a real need with a sound architecture. The five-layer approach is logical and well-structured. However, several blocking issues must be resolved:

1. Collision probability claims are inconsistent
2. Port mapping mechanism (how `lace up` configures Docker) is underspecified
3. Lua file I/O for reading registry needs validation or alternative approach
4. Workspace-to-project mapping assumptions need clarification
5. Multi-file plugin structure needs `package.path` consideration
6. API transition from current single-project usage is missing

## Action Items

1. **[blocking]** Recalculate and consistently state the port collision probabilities (birthday problem math)
2. **[blocking]** Specify how `lace up` will configure Docker to use the derived port (rewrite appPort in extended config?)
3. **[blocking]** Add feasibility note or specify approach for WezTerm Lua plugin to read the registry file
4. **[blocking]** Clarify workspace naming assumptions and how the plugin determines the active project
5. **[blocking]** Address multi-file plugin structure (`package.path`) or consolidate into single file
6. **[blocking]** Add "API Transition" section specifying new API shape and backward compatibility
7. **[non-blocking]** Correct the domain overwrite explanation in Background section
8. **[non-blocking]** Add edge case for projects with same sanitized name
9. **[non-blocking]** Consider "status unknown" indicator in project picker
10. **[non-blocking]** Add negative test scenarios to Test Plan
