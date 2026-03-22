---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-22T00:00:00-07:00
task_list: session-management/troubleshooting
type: report
state: live
status: wip
tags: [tmux, testing, troubleshooting, lace-into]
---

# Rapid Tmux Troubleshooting from Claude Code Sessions

> BLUF: Tmux's `-L <socket>` flag enables fully isolated test servers that do not interfere with the user's sessions.
> Combined with PATH-shimmed `tmux`, `ssh`, and `lace-discover` binaries, we can run `lace-into` end-to-end in a test harness without a real container.
> All tmux pane state (`pane_dead`, `pane_dead_status`, `pane_dead_signal`) is queryable programmatically.
> Pane death can be simulated by `kill -9 <pane_pid>`, and `capture-pane -p` reads pane output for assertions.
> This report documents every technique with runnable examples validated on tmux 3.5a.

## Core Technique: Isolated Test Server

Tmux accepts `-L <name>` to use a named socket instead of the default.
All commands targeting this socket are isolated from the user's running tmux sessions.

```bash
# Create a test server (socket at /tmp/tmux-$UID/lace-test)
tmux -L lace-test new-session -d -s my-project 'bash --norc --noprofile'

# Query it
tmux -L lace-test list-sessions
tmux -L lace-test list-panes -t my-project -F '#{pane_id} #{pane_dead}'

# Tear it down (no effect on user's tmux)
tmux -L lace-test kill-server
```

The test server lives as long as it has at least one session with at least one pane.
With `remain-on-exit on`, dead panes keep the server alive.
Without it, a pane that exits immediately (common in non-PTY environments like Claude Code's Bash tool) destroys the session and the server.

> NOTE(opus/session-management/troubleshooting): In Claude Code's Bash tool, each command runs in a fresh shell without a terminal.
> Commands like `sleep 3600` may exit immediately because the pane cannot allocate a PTY.
> Use `bash -c "trap exit TERM; while true; do sleep 1; done"` for panes that need to stay alive, or set `remain-on-exit on` before creating panes that will exit immediately.

## Pane State Queries

Tmux exposes pane state through format variables in `list-panes -F`:

| Variable | Type | Description |
|---|---|---|
| `pane_dead` | 0 or 1 | 1 if the pane's process has exited |
| `pane_dead_status` | integer | Exit code of the dead process |
| `pane_dead_signal` | integer | Signal number that killed the process |
| `pane_dead_time` | timestamp | When the process exited |
| `pane_pid` | integer | PID of the pane's child process |
| `pane_current_command` | string | Name of the currently running command |
| `pane_start_command` | string | The full command used to create the pane |
| `pane_title` | string | Pane title (set via `select-pane -T`) |
| `pane_id` | string | Unique pane identifier (e.g., `%0`, `%5`) |

### Health Check Pattern

This is the pattern `lace-into` uses (and tests should assert against):

```bash
TOTAL=$(tmux -L lace-test list-panes -t "$session" -F '#{pane_dead}' | wc -l)
ALIVE=$(tmux -L lace-test list-panes -t "$session" -F '#{pane_dead}' | grep -c '^0$' || true)
DEAD=$((TOTAL - ALIVE))

if [ "$ALIVE" -eq "$TOTAL" ]; then
  echo "all alive"
elif [ "$ALIVE" -eq 0 ]; then
  echo "all dead"
else
  echo "mixed: $ALIVE alive, $DEAD dead"
fi
```

### Querying User Options

`lace-into` stores connection metadata as session-level user options (`@lace_port`, `@lace_user`, `@lace_workspace`).
These are queryable and settable:

```bash
tmux -L lace-test set-option -t "$session" @lace_port "22426"
tmux -L lace-test show-option -t "$session" -qv @lace_port
# Output: 22426
```

## Simulating Pane Death

### Method 1: Kill the Pane Process

Query `pane_pid` and send a signal.
SIGKILL (`-9`) is the most reliable simulation of an abrupt SSH disconnect:

```bash
PANE_PID=$(tmux -L lace-test list-panes -t "$session" -F '#{pane_pid}')
kill -9 "$PANE_PID"
sleep 0.5
tmux -L lace-test list-panes -t "$session" -F '#{pane_id} dead=#{pane_dead} signal=#{pane_dead_signal}'
# Output: %0 dead=1 signal=9
```

SIGTERM (`kill $PID` without `-9`) also works and produces `signal=15`.
The pane must have `remain-on-exit on` (or `failed`) set, otherwise it closes immediately and the session may be destroyed.

### Method 2: Send Exit Command

For panes running an interactive shell, `send-keys` can trigger a controlled exit:

```bash
tmux -L lace-test send-keys -t "$session" 'exit 255' Enter
sleep 0.5
tmux -L lace-test list-panes -t "$session" -F '#{pane_dead} status=#{pane_dead_status}'
# Output: 1 status=255
```

This simulates the SSH exit code that `lace-into` checks.
It requires the pane to be running an interactive shell that reads stdin.
Panes running `bash -c "while true; do sleep 1; done"` do not read stdin, so `send-keys` has no effect.

### Method 3: Create Pre-Dead Panes

Create a pane with a command that exits immediately.
With `remain-on-exit on`, the pane stays visible in the dead state:

```bash
tmux -L lace-test set-option -g remain-on-exit on
tmux -L lace-test new-session -d -s test-dead 'exit 255'
sleep 0.3
tmux -L lace-test list-panes -t test-dead -F '#{pane_dead} status=#{pane_dead_status}'
# Output: 1 status=255
```

> NOTE(opus/session-management/troubleshooting): The global option must be set before creating the session.
> Setting `remain-on-exit on` after session creation races with the pane command.
> In Claude Code's non-PTY environment, commands execute and exit faster than a subsequent `set-option` call.

## Testing `remain-on-exit failed`

The `failed` value is what `lace-into` currently uses (line 555).
Panes close automatically on exit 0 and stay dead on non-zero exit.

Verified behavior on tmux 3.5a:

| Exit condition | `remain-on-exit on` | `remain-on-exit failed` |
|---|---|---|
| `exit 0` via send-keys | Pane stays dead | Pane closes, session destroyed |
| `exit 1` via send-keys | Pane stays dead | Pane stays dead (status=1) |
| SIGTERM (kill PID) | Pane stays dead (signal=15) | Pane stays dead (signal=15) |
| SIGKILL (kill -9 PID) | Pane stays dead (signal=9) | Pane stays dead (signal=9) |

Signal deaths are always treated as failures by `remain-on-exit failed`.
This is correct for the `lace-into` use case: SSH dying from a container stop/rebuild exits non-zero or is killed by signal, so the pane persists for inspection.

## Testing `pane-died` Hooks

The `pane-died` hook fires when a pane's process exits and `remain-on-exit` keeps the pane alive.

### Basic Hook (Logging)

```bash
tmux -L lace-test set-hook -t "$session" pane-died \
  'run-shell "echo HOOK_FIRED >> /tmp/lace-test-hook.log"'
```

Kill a pane, then check `/tmp/lace-test-hook.log`.
Verified: the log file is written within 0.5s of the kill.

### Auto-Respawn Hook

```bash
tmux -L lace-test set-hook -t "$session" pane-died \
  'run-shell "tmux -L lace-test respawn-pane -t #{pane_id}"'
```

The `run-shell` wrapper is required.
Bare `respawn-pane` in the hook did not fire reliably in testing.
The `run-shell` form explicitly calls tmux with the correct socket name.

### Respawn-Pane Behavior

`respawn-pane` without a command argument re-runs `pane_start_command`: the exact command that created the pane.
For `lace-into` panes, this is the full SSH command string:

```
ssh -o IdentityFile=... -o IdentitiesOnly=yes ... -p 99999 testuser@localhost "cd /workspaces/mock && exec $SHELL -l"
```

`respawn-pane` with a command argument replaces the pane's command entirely.

## Reading Pane Output

`capture-pane -p` prints the pane's visible content to stdout:

```bash
tmux -L lace-test capture-pane -t "$session" -p
```

Combined with `send-keys`, this enables assert-style testing:

```bash
tmux -L lace-test send-keys -t "$session" 'echo MARKER_STRING' Enter
sleep 0.3
OUTPUT=$(tmux -L lace-test capture-pane -t "$session" -p)
if echo "$OUTPUT" | grep -q 'MARKER_STRING'; then
  echo "PASS: marker found in pane output"
fi
```

## Running `lace-into` Against a Test Server

The key challenge: `lace-into` calls bare `tmux`, `ssh`, `ssh-keyscan`, and `lace-discover` without accepting socket or mock overrides.
The solution is PATH injection: place shim scripts first in `$PATH` that redirect these commands.

### PATH Shim Setup

```bash
mkdir -p /tmp/lace-test-bin

# Tmux shim: redirect all tmux calls to the test socket
cat > /tmp/lace-test-bin/tmux << 'SHIM'
#!/bin/bash
exec /usr/bin/tmux -L lace-test-harness "$@"
SHIM
chmod +x /tmp/lace-test-bin/tmux

# Mock lace-discover: emit fixed project data
cat > /tmp/lace-test-bin/lace-discover << 'MOCK'
#!/bin/bash
echo "test-proj:22426:node:/home/mjr/code/test:/workspaces/test"
MOCK
chmod +x /tmp/lace-test-bin/lace-discover

# Mock ssh: run a local shell instead of connecting
cat > /tmp/lace-test-bin/ssh << 'MOCK'
#!/bin/bash
echo "MOCK SSH: $@"
exec bash --norc --noprofile
MOCK
chmod +x /tmp/lace-test-bin/ssh

# Mock ssh-keyscan: emit a fake host key
cat > /tmp/lace-test-bin/ssh-keyscan << 'MOCK'
#!/bin/bash
echo "[localhost]:$3 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKey"
MOCK
chmod +x /tmp/lace-test-bin/ssh-keyscan

# Mock ssh-keygen: silently succeed
cat > /tmp/lace-test-bin/ssh-keygen << 'MOCK'
#!/bin/bash
exit 0
MOCK
chmod +x /tmp/lace-test-bin/ssh-keygen
```

### Running lace-into with Mocks

```bash
TMUX="" \
PATH="/tmp/lace-test-bin:/usr/bin:/bin" \
LACE_KNOWN_HOSTS="/tmp/lace-test-known-hosts" \
  timeout 3 /path/to/bin/lace-into test-proj 2>&1 || true
```

The `TMUX=""` is required because `lace-into` uses `set -u` and checks `$TMUX` to decide between `attach-session` and `switch-client`.
Setting it empty (not unset) avoids the "unbound variable" error.

The `timeout 3` prevents the `exec tmux attach-session` from hanging (it fails with "not a terminal" in Claude Code's Bash tool, but the session creation succeeds before that point).

### Verifying Session State After lace-into

```bash
# Check on the test socket (not the default socket)
tmux -L lace-test-harness list-sessions
tmux -L lace-test-harness list-panes -t test-proj \
  -F '#{pane_id} dead=#{pane_dead} pid=#{pane_pid}'
tmux -L lace-test-harness show-option -t test-proj -qv @lace_port
tmux -L lace-test-harness show-option -t test-proj -qv @lace_user
tmux -L lace-test-harness show-option -t test-proj -qv @lace_workspace
```

Verified results from actual test run:
- Session `mock-proj` created on `lace-test-harness` socket
- `@lace_port` = `99999`, `@lace_user` = `testuser`, `@lace_workspace` = `/workspaces/mock`
- `pane_start_command` contains the full mock SSH invocation
- Pane alive, running mock ssh (which execs bash)

### Testing Dead-Pane Recovery

```bash
# 1. Kill the pane process
PANE_PID=$(tmux -L lace-test-harness list-panes -t test-proj -F '#{pane_pid}')
kill -9 "$PANE_PID"
sleep 0.5

# 2. Verify pane is dead
tmux -L lace-test-harness list-panes -t test-proj \
  -F '#{pane_id} dead=#{pane_dead} signal=#{pane_dead_signal}'
# Expected: %0 dead=1 signal=9

# 3. Re-run lace-into
TMUX="" PATH="/tmp/lace-test-bin:/usr/bin:/bin" \
  timeout 3 /path/to/bin/lace-into test-proj 2>&1

# 4. Verify lace-into detected and handled the dead pane
# Expected stderr: "session test-proj has no live panes, recreating"
# Expected: new session created, pane alive
```

Verified: `lace-into` outputs "session mock-proj has no live panes, recreating" and creates a fresh session.

## Complete Test Harness Script

```bash
#!/bin/bash
# lace-into-test-harness.sh: test tmux session management without a real container
set -euo pipefail

SOCKET="lace-test-$$"
BINDIR=$(mktemp -d)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LACE_INTO="$SCRIPT_DIR/../bin/lace-into"
PASS=0
FAIL=0

cleanup() {
  tmux -L "$SOCKET" kill-server 2>/dev/null || true
  rm -rf "$BINDIR"
}
trap cleanup EXIT

# --- Setup mocks ---
setup_mocks() {
  cat > "$BINDIR/tmux" << SHIM
#!/bin/bash
exec /usr/bin/tmux -L $SOCKET "\$@"
SHIM
  chmod +x "$BINDIR/tmux"

  cat > "$BINDIR/lace-discover" << 'MOCK'
#!/bin/bash
echo "test-proj:22426:node:/home/test:/workspaces/test"
MOCK
  chmod +x "$BINDIR/lace-discover"

  cat > "$BINDIR/ssh" << 'MOCK'
#!/bin/bash
exec bash --norc --noprofile
MOCK
  chmod +x "$BINDIR/ssh"

  for cmd in ssh-keyscan ssh-keygen; do
    cat > "$BINDIR/$cmd" << 'MOCK'
#!/bin/bash
exit 0
MOCK
    chmod +x "$BINDIR/$cmd"
  done
}

run_lace_into() {
  TMUX="" PATH="$BINDIR:/usr/bin:/bin" \
    timeout 3 "$LACE_INTO" "$@" 2>&1 || true
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected='$expected', actual='$actual')"
    FAIL=$((FAIL + 1))
  fi
}

tmx() { tmux -L "$SOCKET" "$@"; }

# --- Tests ---
setup_mocks

echo "=== Test: Session creation ==="
run_lace_into test-proj > /dev/null
assert_eq "session exists" "0" "$(tmx has-session -t test-proj 2>/dev/null; echo $?)"
assert_eq "port option" "22426" "$(tmx show-option -t test-proj -qv @lace_port)"
assert_eq "pane alive" "0" "$(tmx list-panes -t test-proj -F '#{pane_dead}')"

echo "=== Test: Dead pane detection ==="
PANE_PID=$(tmx list-panes -t test-proj -F '#{pane_pid}')
kill -9 "$PANE_PID"
sleep 0.5
assert_eq "pane dead" "1" "$(tmx list-panes -t test-proj -F '#{pane_dead}')"

OUTPUT=$(run_lace_into test-proj)
echo "$OUTPUT" | grep -q "no live panes" && \
  assert_eq "dead pane message" "found" "found" || \
  assert_eq "dead pane message" "found" "not found"

assert_eq "session recreated" "0" "$(tmx list-panes -t test-proj -F '#{pane_dead}')"

echo "=== Test: Healthy reattach ==="
OUTPUT=$(run_lace_into test-proj)
echo "$OUTPUT" | grep -q "attaching to existing" && \
  assert_eq "reattach message" "found" "found" || \
  assert_eq "reattach message" "found" "not found"

tmx kill-server 2>/dev/null || true

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
```

## Limitations and Workarounds

### Terminal Requirement

`tmux attach-session` and `switch-client` require a terminal.
In Claude Code's Bash tool, these fail with "open terminal failed: not a terminal".
Session creation and all state queries work fine.
Use `timeout` to prevent the attach from hanging and check session state after.

### Pane Command Lifetime

In a non-PTY environment, some pane commands exit immediately.
Interactive shells (`bash --norc --noprofile`) survive because tmux allocates a PTY for the pane internally.
Commands that explicitly check for a terminal (like some SSH configurations) may not.

### No Real SSH Testing

The mock `ssh` runs a local shell, not a real SSH connection.
This is sufficient for testing `lace-into`'s tmux session management logic, but not for testing actual SSH behavior (host key verification, connection timeouts, multiplexing).
For SSH-layer testing, a running devcontainer is required.

### `exec tmux attach` Complicates Exit Codes

`lace-into` uses `exec tmux attach-session` (line 519, 536, 568), which replaces the shell process.
In a test harness, this means `lace-into` never returns: the process becomes `tmux attach-session`, which fails with "not a terminal".
The `timeout` wrapper handles this, but the exit code from `lace-into` is not meaningful.
Assertions should check tmux state, not `lace-into`'s exit code.

### Cleaning Up Test Servers

Always kill the test server after tests:

```bash
tmux -L "$SOCKET" kill-server 2>/dev/null || true
```

Use a unique socket name per test run (e.g., `lace-test-$$`) to avoid conflicts with other Claude Code sessions or parallel test runs.
