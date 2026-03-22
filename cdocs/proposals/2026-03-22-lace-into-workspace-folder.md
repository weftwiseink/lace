---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-22T16:57:00-07:00
task_list: session-management/workspace-folder
type: proposal
state: live
status: request_for_proposal
tags: [lace-into, tmux, workspace, session-management]
---

# Ensure lace-into Always Connects to Workspace Folder

> BLUF(opus/tmux-pane-splits): lace-into and lace-split SSH connections land in the container's home directory instead of the workspace folder, despite `@lace_workspace` being set correctly.
> - Motivated By: `cdocs/proposals/2026-03-22-pane-connect-disconnect.md`, `cdocs/proposals/2026-03-22-in-container-splits.md`

## Objective

When connecting to a lace devcontainer via `lace-into` (session mode, `--pane` mode, or lace-split), the shell should land in the workspace folder (e.g., `/workspaces/lace`), not the container user's home directory.
The `@lace_workspace` option is set correctly at both session and pane level, and lace-split constructs the SSH command with `cd $ws && exec $SHELL -l`, but connections still land in `~`.

## Scope

- Investigate why `cd $workspace && exec $SHELL -l` as an SSH remote command does not land in the workspace folder.
  Possible causes: shell profile overriding `cd`, quoting/escaping issues in the remote command, `$SHELL` not resolving correctly on the remote side.
- Verify that `lace-discover` returns the correct workspace path for each container.
- Test the SSH command in isolation (`ssh -t -p PORT user@localhost "cd /workspaces/lace && exec $SHELL -l"`) to isolate whether it's a lace-into issue or an SSH/remote-shell issue.
- Ensure `lace-into` session mode, `--pane` mode, and `lace-split` all behave consistently.

## Open Questions

- Does the remote shell's profile (`.bashrc`, `.profile`) override the working directory set by `cd` in the SSH command?
- Is the remote `$SHELL` variable set correctly in the container, or does it resolve to a different shell that resets the directory?
- Should lace-into use `ssh -t ... "cd /path && exec bash -l"` (hardcoded shell) instead of relying on `$SHELL`?
- Would `ssh ... -o RemoteCommand="cd /path && exec $SHELL -l"` behave differently than passing it as a positional arg?
