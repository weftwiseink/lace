---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-10T17:25:00-08:00
task_list: lace/wez-into
type: devlog
state: live
status: review_ready
related_to:
  - cdocs/proposals/2026-03-10-wez-into-ssh-workspace-cwd.md
---

# Devlog: Fix wez-into SSH Sessions Landing in /home/node

## Objective

Implement the accepted proposal at
`cdocs/proposals/2026-03-10-wez-into-ssh-workspace-cwd.md` to fix SSH sessions
started by `wez-into` landing in `/home/node` instead of the workspace directory.

## Task List

- [x] Phase 1: Fix the SSH remote command in `do_connect()`
- [x] Phase 1b: Update the dry-run output
- [x] Verification: bash syntax check and manual SSH test

## Session Log

### Phase 1: Fix SSH remote command in do_connect()

Modified `bin/wez-into` `do_connect()` function to add `-t` flag and a remote
command that `cd`s to `$CONTAINER_WORKSPACE_FOLDER` before starting an interactive
login shell. Placed `-t` before the host argument for canonical SSH argument ordering
(per review feedback). The remote command uses single quotes so the env var is
expanded on the remote side.

### Phase 1b: Update dry-run output

Updated the dry-run echo on line 437 to reflect the new SSH command format including
the `-t` flag and remote command.

### Verification

- `bash -n bin/wez-into` passes (no syntax errors)
- `ssh -p 22426 node@localhost 'cd "${CONTAINER_WORKSPACE_FOLDER:-$HOME}" 2>/dev/null || cd; pwd'`
  returns `/workspace/lace/main` (confirmed fix works)
