---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T10:00:00-07:00
task_list: lace/screenshot-sharing
type: proposal
state: live
status: request_for_proposal
tags: [lace, mounts, user_experience, screenshots]
---

# Lace Screenshot Sharing

> NOTE(opus/usefun-real): Screenshots are now handled by `user.json` mounts + `lace-fundamentals` mount declaration.
> The `lace-fundamentals` feature declares a `screenshots` mount with target `/mnt/lace/screenshots` and recommended source `~/Pictures/Screenshots`.
> Users configure the source path in `user.json` mounts or settings overrides.
> See `cdocs/proposals/2026-03-24-lace-user-level-config.md` and `cdocs/proposals/2026-03-24-lace-fundamentals-feature.md`.

> BLUF(opus/lace-screenshot-sharing): Screenshots taken on the host cannot be referenced from inside lace devcontainers without manual copying.
> A lace mount or shared directory convention would let host-side screenshots be immediately visible inside containers, enabling workflows like pasting a screenshot path into a Claude Code conversation.
>
> - **Motivated By:** practical friction during sprack development: screenshots taken on the host had to be manually placed in the repo for Claude to read them.

## Objective

Enable seamless access to host-side screenshots from inside lace devcontainers.

The immediate use case: a user takes a screenshot on the host (e.g., via a system screenshot tool), and wants to reference it in a Claude Code session running inside a container.
The screenshot file lives on the host filesystem; the container cannot see it without a mount or copy step.

This is a general user-level concern: screenshots are a common artifact in development workflows (bug reports, UI feedback, documentation), and the host-to-container boundary makes them invisible by default.

## Scope

The full proposal should explore:

- A lace mount declaration for a shared screenshots directory (e.g., host `~/Screenshots` or `~/Pictures/Screenshots` mapped to a predictable container path).
- Whether this should be a general "shared directory" mount pattern or screenshot-specific.
- Platform differences: macOS uses `~/Desktop` or `~/Screenshots` (depending on config), Linux varies by desktop environment (`~/Pictures/Screenshots` for GNOME, `~/Screenshots` for some others), and the path may be configurable.
- Whether a symlink from a well-known container path (e.g., `~/screenshots`) to the mounted directory is sufficient.
- Read-only vs read-write: containers probably only need read access to host screenshots.
- Whether this overlaps with a broader "host home directory partial mount" pattern (mounting select host directories rather than individual files).
- Integration with clipboard: some workflows paste images directly rather than referencing files; this is a different problem but related.

## Open Questions

- Is a dedicated screenshot mount worth the complexity, or should this be part of a more general "host shared directories" feature?
- What is the conventional screenshot path across macOS, GNOME, KDE, and other environments?
- Should lace auto-detect the host's screenshot directory, or require explicit configuration?
- Does this interact with the existing mount validation and `sourceMustBe` constraints?
- Are there security concerns with mounting host directories read-only into containers (information leakage from screenshot content)?
