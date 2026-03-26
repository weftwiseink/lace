---
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-25T17:00:00-07:00
task_list: terminal-management/sprack-git-context
type: proposal
state: live
status: request_for_proposal
tags: [sprack, git, future_work, ux_design]
---

# Sprack Git Context Iteration: Container Support and Worktree Redesign

> BLUF(sonnet/sprack-git-context): The implemented git context feature has two design issues that require revision before rendering is enabled.
> Motivated By: `cdocs/proposals/2026-03-25-sprack-git-context-integration.md`, `cdocs/proposals/2026-03-25-rfp-sprack-lace-decoupling.md`

## Objective

The [sprack git context proposal](2026-03-25-sprack-git-context-integration.md) was implemented (Phases 1 and 2), but two issues emerged during rollout that require design revision before the git context line is rendered in the widget.

The first issue is that container panes produce no git context.
Git resolution is PID-keyed and only works for local panes.
Container panes use `CacheKey::ContainerSession` and are skipped by the git resolver entirely.
The container-internal workspace path (e.g., `/workspaces/lace` from `@lace_workspace`) cannot be used directly because sprack-claude runs on the host and needs the host-side bind-mount source path.
Routing through `docker inspect` or `@lace_host_workspace` is fragile: the terminal can `cd` anywhere within the container, and multi-worktree repos have multiple bind-mount roots.

The second issue is that worktree enumeration is misapplied.
Phase 2 enumerates all worktrees of the repository and lists them in the widget.
The intended signal was narrower: which other sprack-monitored sessions are active in sibling worktrees of the same repo.
Showing all worktrees regardless of session activity is noise that obscures the actual intent.

## Scope

The full proposal should address:

- **Disable git rendering for now**: suppress the git context line in the widget while the design issues are resolved.
  Keep the data collection code (branch, commit, worktree enumeration) intact since it works for local panes.
  This is a rendering gate, not a feature removal.

- **Redesign worktree enumeration**: replace "enumerate all worktrees of this repo" with "find sibling sprack sessions in other worktrees of this repo."
  The redesigned signal answers: "which other Claude sessions (tracked by sprack) are working in a different worktree of the same repository?"
  This requires cross-referencing the resolved git root across all active sessions in the session cache.

- **Container git context as a follow-on**: unblock container git context by waiting for a container state-sharing mechanism to emerge from the [lace decoupling RFP](2026-03-25-rfp-sprack-lace-decoupling.md).
  Once a generic integration bridge exists that exposes the container's working directory on the host side, git resolution can piggyback on it.
  No container-specific git heuristics should be added in the interim.

- **Rendering re-enablement criteria**: define what conditions must be met (local pane git context working, sibling session logic implemented, container path not regressed) before the git line is re-enabled.

## Open Questions

1. How should "same repository" be determined across sessions?
   Comparing resolved git roots (absolute `PathBuf`) is cheap but assumes all worktrees share a visible common ancestor path on the host.
   Is this reliable for bare-repo layouts where worktrees are siblings of the bare repo root?

2. Should the sibling session display show session names, branch names, or both?
   Branch names alone may not distinguish two sessions in the same worktree.
   Session names alone may not be meaningful to the user without branch context.

3. Does the "disable rendering" gate belong in the TUI renderer (omit the field from the widget) or in sprack-claude (skip populating the git fields on `ClaudeSummary`)?
   The former preserves data flow for debugging; the latter reduces IPC noise.

4. When container state-sharing lands, will the host-side workspace path be stable enough for git root walking, or will additional normalization be needed (e.g., symlink resolution, trailing-slash stripping)?

5. Should dirty state (Phase 3) be deferred indefinitely until container git context is resolved, or developed in parallel for local panes only?

## Known Requirements

- The git data collection code (Phases 1 and 2) must remain intact and tested even while rendering is suppressed.
  Regressing the underlying logic would complicate re-enablement.
- Sibling session detection must operate within the existing poll cycle budget (1-2 seconds total).
  A cross-session join on git roots must not require additional I/O beyond what is already cached.
- The container git context design must remain consistent with whatever integration bridge emerges from `2026-03-25-rfp-sprack-lace-decoupling.md`.
  No lace-specific git heuristics should be introduced.

## Prior Art

- [Sprack Git Context Integration](2026-03-25-sprack-git-context-integration.md): the original proposal and implementation plan.
  Phase 1 and Phase 2 were implemented; this RFP addresses the post-implementation design issues.
- [RFP: Decouple Sprack from Lace-Specific Details](2026-03-25-rfp-sprack-lace-decoupling.md): the container state-sharing prerequisite.
  Container git context is a downstream consumer of whatever mechanism this produces.
