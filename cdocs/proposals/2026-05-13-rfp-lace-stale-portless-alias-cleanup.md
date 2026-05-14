---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T16:30:00-07:00
task_list: weftwise/parallel-feature-development/follow-up/alias-cleanup
type: proposal
state: live
status: request_for_proposal
tags: [portless, lace-core, cleanup, future_work]
---

# RFP: Cleanup of Stale Host-Side `portless alias` Entries

> BLUF(opus/parallel-dev/follow-up/alias-cleanup): The parallel-dev proposal (`cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md`) registers a host-side `portless alias <project> <port>` on every `lace up`, but lace has no `lace down` and no alias-removal path.
> Over time, the host portless state directory accumulates entries for destroyed or renamed containers.
> Manual cleanup (`portless alias --remove <name>`) always works; this RFP requests a proposal for an automatic or assisted cleanup mechanism.

## Problem statement

`portless alias <name> <port>` registers a persistent host-side route.
Lace's parallel-dev integration calls it after each successful `lace up`, with the project name and the lace-allocated container portless port.

Three failure modes accumulate stale entries:

1. **Container destroyed and not recreated.** User runs `podman rm weftwise` and never `lace up`s again.
   Host alias `weftwise -> 22435` persists, pointing at a port nothing listens on.
2. **Project renamed.** User changes the bare-repo directory name.
   `deriveProjectName` returns the new name; lace registers an alias under the new name; the old alias is never cleaned up.
3. **Port reallocation across projects.** Project A had port 22435, gets destroyed; Project B gets 22435 fresh.
   Project A's stale alias now resolves to Project B's container, silently routing traffic to the wrong place.

Failure mode 3 is the most material: it is a correctness issue, not just clutter.
Failure modes 1 and 2 are clutter that gradually erodes `portless list` readability.

## Goals

The eventual proposal must address:

- Detect stale aliases (entries pointing at containers that no longer exist or no longer have the named alias).
- Provide a path to remove them, either automatically (on `lace up` for OTHER projects, on a scheduled cleanup, or via a new `lace clean` subcommand) or interactively.
- Avoid removing aliases for containers that are temporarily down (e.g., `podman stop weftwise` should not nuke the alias).
- Coexist with manual user actions (`portless alias --remove` should always work and not be undone by lace).

## Non-goals

- A new lace daemon. Cleanup must happen at known invocation points.
- Cross-machine cleanup. Single-host scope.
- Replacing `portless` upstream behaviours (e.g., `portless prune` if it exists).

## Open questions for the proposal author

- Does `portless` upstream already ship a `prune` or `cleanup` subcommand that detects unreachable aliases? If yes, the lace surface area shrinks to "call `portless prune` at a known cadence."
- Where should cleanup run? Options: at the start of `lace up` for any project; in a new `lace clean` subcommand; as a `systemd --user` timer.
- Should lace persist its own alias-ownership ledger (e.g., `~/.config/lace/portless-aliases.json` keyed by project name → container ID) so it can distinguish "alias I created and should manage" from "alias the user created manually"?
- Container-ID tracking: when a project's container is destroyed and recreated, the container ID changes. Should lace key its ownership ledger by container ID or by project name?

## References

- Source proposal: `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md` (Phase 3 introduces the alias registration; this RFP covers cleanup).
- Fresh-eyes URL routing survey: `cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md`.
