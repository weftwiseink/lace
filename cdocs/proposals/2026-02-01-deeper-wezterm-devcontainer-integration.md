---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T18:00:00-08:00
task_list: lace/devcontainer-workflow
type: proposal
state: live
status: request_for_proposal
tags: [wezterm, devcontainer, lace-cli, workflow-automation, developer-experience]
---

# Deeper WezTerm-Devcontainer Integration

> BLUF: Extend the auto-attach PoC (`bin/open-lace-workspace`) with window reuse, auto-connect on WezTerm launch, lace CLI absorption, and worktree selection to eliminate remaining manual steps in the devcontainer entry workflow.
>
> - **Motivated by:** [Auto-Attach WezTerm Workspace After Devcontainer Setup](cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md) (Phase 3 future work)

## Objective

The auto-attach PoC solves the "start container then connect terminal" workflow but leaves several gaps: running the script twice opens duplicate windows, there is no way to connect to a specific worktree, WezTerm does not auto-connect on launch, and the script exists outside the lace CLI where devcontainer orchestration is converging.
This proposal should design solutions for these gaps as natural extensions of the PoC.

## Scope

The full proposal should explore:

- **Window reuse**: Detect if a WezTerm window is already connected to the `lace` SSH domain and focus it rather than opening a new one. Investigate `wezterm cli list` on the host side (not over SSH) to discover existing mux client connections, window IDs, and workspace names.
- **`gui-startup` auto-connect**: Integration with the `gui-startup` event in `wezterm.lua` to optionally auto-connect to the devcontainer when WezTerm launches. Consider whether this should be conditional (only if the container is running) or trigger a container start.
- **Lace CLI absorption**: Absorb `bin/open-lace-workspace` functionality into the [lace CLI](cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md) as `lace connect` or `lace workspace`. The lace CLI already defines `lace up` wrapping `devcontainer up`; the connect step is a natural companion. Define the subcommand interface and how it composes with `lace up`.
- **Worktree selection**: Support connecting to a specific worktree (e.g., `lace connect feature-auth` landing at `/workspace/feature-auth`) rather than always defaulting to `/workspace/main`. Investigate whether `wezterm connect` supports specifying a cwd, or whether this requires `wezterm cli spawn` with a domain and cwd.

## Open Questions

1. Can `wezterm cli list` (run on the host) reliably identify windows connected to the `lace` SSH domain? What fields does it expose (workspace name, domain, pane count)?
2. Does `wezterm connect <domain>` accept a `--cwd` flag or equivalent? If not, what is the mechanism for landing in a specific worktree directory?
3. Should `gui-startup` auto-connect be opt-in (config flag) or always-on? What happens if the container is not running -- should it start it, skip silently, or show a notification?
4. How should `lace connect` interact with `lace up`? Should `lace connect` imply `lace up` (start if needed), or should they remain separate (`lace up | lace connect`)?
5. Is there a WezTerm API to focus an existing window programmatically from the CLI, or does the OS window manager need to be involved?
