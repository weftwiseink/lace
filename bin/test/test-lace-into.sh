#!/bin/bash
# test-lace-into.sh: test tmux session management without a real container
# Uses tmux -L <socket> for isolation and PATH-shimmed mocks.
set -euo pipefail

SOCKET="lace-test-harness"
BINDIR=$(mktemp -d)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LACE_INTO="$SCRIPT_DIR/../lace-into"
KNOWN_HOSTS=$(mktemp /tmp/lace-test-known-hosts-XXXXXX)
PASS=0
FAIL=0
TESTS_RUN=0

cleanup() {
  tmux -f /dev/null -L "$SOCKET" kill-server 2>/dev/null || true
  rm -rf "$BINDIR" "$KNOWN_HOSTS"
}
trap cleanup EXIT

# --- Helpers ---
tmx() { tmux -f /dev/null -L "$SOCKET" "$@"; }

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected='$expected', actual='$actual')"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local desc="$1" expected="$2" actual="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected to contain '$expected', got: '$(echo "$actual" | head -3)')"
    FAIL=$((FAIL + 1))
  fi
}

# --- Mock setup ---
setup_mocks() {
  local project="${1:-test-proj}"
  local port="${2:-22426}"
  local user="${3:-node}"
  local path="${4:-/home/test}"
  local workspace="${5:-/workspaces/test}"

  # Use -f /dev/null to prevent tmux.conf loading (avoids continuum/resurrect interference)
  cat > "$BINDIR/tmux" << SHIM
#!/bin/bash
exec /usr/bin/tmux -f /dev/null -L $SOCKET "\$@"
SHIM
  chmod +x "$BINDIR/tmux"

  cat > "$BINDIR/lace-discover" << MOCK
#!/bin/bash
echo "${project}:${port}:${user}:${path}:${workspace}"
MOCK
  chmod +x "$BINDIR/lace-discover"

  # Mock ssh: run a local shell (simulates SSH connection)
  cat > "$BINDIR/ssh" << 'MOCK'
#!/bin/bash
exec bash --norc --noprofile
MOCK
  chmod +x "$BINDIR/ssh"

  # Mock ssh-keyscan: emit a fake host key line (must output a key for refresh_host_key)
  cat > "$BINDIR/ssh-keyscan" << 'MOCK'
#!/bin/bash
# $3 is the port (ssh-keyscan -p PORT HOST)
echo "[localhost]:${3:-22} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeTestKey"
MOCK
  chmod +x "$BINDIR/ssh-keyscan"

  # Mock ssh-keygen: silently succeed
  cat > "$BINDIR/ssh-keygen" << 'MOCK'
#!/bin/bash
exit 0
MOCK
  chmod +x "$BINDIR/ssh-keygen"
}

run_lace_into() {
  TMUX="" \
  PATH="$BINDIR:/usr/bin:/bin" \
  HOME="${HOME}" \
    timeout 5 "$LACE_INTO" "$@" 2>&1 || true
}

# run_lace_into_pane: like run_lace_into, but simulates being inside the test tmux.
# Uses the test socket's path for TMUX and a real pane ID from the given session.
run_lace_into_pane() {
  local session="$1"
  shift
  # Get the socket path and server pid for the TMUX env var
  local socket_path
  socket_path=$(tmx display-message -p '#{socket_path}' 2>/dev/null)
  local server_pid
  server_pid=$(tmx display-message -p '#{pid}' 2>/dev/null)
  # Get the first pane ID in the target session
  local pane_id
  pane_id=$(tmx list-panes -t "=$session" -F '#{pane_id}' | head -1)
  # TMUX format: socket_path,pid,session_index
  TMUX="${socket_path},${server_pid},0" \
  TMUX_PANE="$pane_id" \
  PATH="$BINDIR:/usr/bin:/bin" \
  HOME="${HOME}" \
    timeout 5 "$LACE_INTO" "$@" 2>&1 || true
}

kill_session() {
  tmx kill-session -t "=$1" 2>/dev/null || true
}

kill_pane_process() {
  local session="$1"
  local pane_idx="${2:-0}"  # 0 = first pane, -1 = last pane
  local pane_pid
  if [ "$pane_idx" = "-1" ]; then
    pane_pid=$(tmx list-panes -t "=$session" -F '#{pane_pid}' | tail -1)
  else
    pane_pid=$(tmx list-panes -t "=$session" -F '#{pane_pid}' | head -1)
  fi
  if [ -n "$pane_pid" ]; then
    kill -9 "$pane_pid" 2>/dev/null || true
    sleep 0.5
  fi
}

pane_dead_count() {
  tmx list-panes -t "=$1" -F '#{pane_dead}' 2>/dev/null | grep -c '^1$' || true
}

pane_alive_count() {
  tmx list-panes -t "=$1" -F '#{pane_dead}' 2>/dev/null | grep -c '^0$' || true
}

pane_total_count() {
  tmx list-panes -t "=$1" -F '#{pane_dead}' 2>/dev/null | wc -l
}

get_option() {
  # NOTE: show-option does NOT work with = prefix (tmux quirk).
  # has-session supports = for exact match, but show-option silently returns empty.
  tmx show-option -t "$1" -qv "$2" 2>/dev/null || true
}

get_pane_option() {
  # Read pane-level user option. $1 = pane_id (e.g. %5), $2 = option name.
  tmx show-option -p -t "$1" -qv "$2" 2>/dev/null || true
}

# =============================================================================
# Tests
# =============================================================================

echo "=== Test 1: Fresh session creation ==="
setup_mocks "test-proj" "22426"
kill_session "test-proj"
OUTPUT=$(run_lace_into test-proj)
sleep 0.3
assert_eq "session exists" "0" "$(tmx has-session -t '=test-proj' 2>/dev/null; echo $?)"
assert_eq "port option set" "22426" "$(get_option test-proj @lace_port)"
assert_eq "user option set" "node" "$(get_option test-proj @lace_user)"
assert_eq "workspace option set" "/workspaces/test" "$(get_option test-proj @lace_workspace)"
assert_eq "pane alive" "1" "$(pane_alive_count test-proj)"

# Pane-level options should also be set for lace-split context detection
INITIAL_PANE=$(tmx list-panes -t "=test-proj" -F '#{pane_id}' | head -1)
assert_eq "pane-level port set" "22426" "$(get_pane_option "$INITIAL_PANE" @lace_port)"
assert_eq "pane-level user set" "node" "$(get_pane_option "$INITIAL_PANE" @lace_user)"
assert_eq "pane-level workspace set" "/workspaces/test" "$(get_pane_option "$INITIAL_PANE" @lace_workspace)"

echo ""
echo "=== Test 2: Healthy reattach (all panes alive) ==="
OUTPUT=$(run_lace_into test-proj)
assert_contains "reattach message" "attaching to existing" "$OUTPUT"
assert_eq "pane still alive" "1" "$(pane_alive_count test-proj)"

echo ""
echo "=== Test 3: All-dead session handling ==="
# Set remain-on-exit so dead pane persists (simulating lace-into behavior)
# Use -t without = prefix for set-option (= causes "no such window" for window options)
tmx set-option -t test-proj remain-on-exit on
kill_pane_process "test-proj"
assert_eq "pane is dead" "1" "$(pane_dead_count test-proj)"
assert_eq "session still exists" "0" "$(tmx has-session -t '=test-proj' 2>/dev/null; echo $?)"

# Run lace-into again - should respawn in place (never kill lace sessions)
OUTPUT=$(run_lace_into test-proj)
sleep 0.3
assert_eq "session exists after reconnect" "0" "$(tmx has-session -t '=test-proj' 2>/dev/null; echo $?)"
assert_eq "pane alive after reconnect" "1" "$(pane_alive_count test-proj)"
assert_eq "port preserved" "22426" "$(get_option test-proj @lace_port)"
assert_contains "used respawn path" "respawning" "$OUTPUT"

echo ""
echo "=== Test 4: Mixed health (alive + dead) ==="
# Ensure we have a live session with options
assert_eq "session healthy" "1" "$(pane_alive_count test-proj)"
# Set remain-on-exit so dead pane persists
tmx set-option -t test-proj remain-on-exit on
# Create a second pane with a bash shell
tmx split-window -t test-proj bash --norc --noprofile
sleep 0.3
assert_eq "two panes" "2" "$(pane_total_count test-proj)"

# Kill second pane only
kill_pane_process "test-proj" "-1"
assert_eq "one dead" "1" "$(pane_dead_count test-proj)"
assert_eq "one alive" "1" "$(pane_alive_count test-proj)"

# Run lace-into - should respawn only the dead pane
OUTPUT=$(run_lace_into test-proj)
assert_contains "respawn message" "respawning" "$OUTPUT"
sleep 0.3
assert_eq "both panes alive" "2" "$(pane_alive_count test-proj)"
assert_eq "no dead panes" "0" "$(pane_dead_count test-proj)"

echo ""
echo "=== Test 5: remain-on-exit failed behavior ==="
# Don't kill test-proj yet - we need the server running.
# Create a fresh session with remain-on-exit failed set at session level
tmx new-session -d -s roe-test 'bash --norc --noprofile'
tmx set-option -t roe-test remain-on-exit failed
sleep 0.3

# Exit 0 should close the pane (and destroy the session if it's the only pane)
tmx send-keys -t roe-test 'exit 0' Enter
sleep 1.0
SESSION_EXISTS=$(tmx has-session -t "=roe-test" 2>/dev/null; echo $?)
assert_eq "exit-0 pane closes (session destroyed)" "1" "$SESSION_EXISTS"

# Exit 255 should keep the pane dead
tmx new-session -d -s roe-test2 'bash --norc --noprofile'
tmx set-option -t roe-test2 remain-on-exit failed
sleep 0.3
tmx send-keys -t roe-test2 'exit 255' Enter
sleep 0.5
assert_eq "exit-255 pane persists" "1" "$(pane_dead_count roe-test2)"

# =============================================================================
# --pane mode tests
# =============================================================================

echo ""
echo "=== Test 6: --pane outside tmux ==="
# With TMUX unset, --pane should error
OUTPUT=$(run_lace_into --pane test-proj)
assert_contains "error message" "pane requires running inside tmux" "$OUTPUT"

echo ""
echo "=== Test 7: --pane inside tmux (respawn pane with SSH) ==="
# Create a fresh session to serve as the "current session" for --pane
setup_mocks "pane-proj" "22427"
kill_session "pane-test-session"
tmx new-session -d -s pane-test-session 'bash --norc --noprofile'
sleep 0.3

# Get the pane's initial process (bash)
INITIAL_PID=$(tmx list-panes -t "=pane-test-session" -F '#{pane_pid}' | head -1)

# Run lace-into --pane targeting the pane in pane-test-session
OUTPUT=$(run_lace_into_pane "pane-test-session" --pane pane-proj)
sleep 0.3

# The pane should still be alive (respawned with mock ssh -> bash)
assert_eq "pane alive after --pane" "1" "$(pane_alive_count pane-test-session)"

# The pane PID should have changed (respawn-pane -k kills and restarts)
NEW_PID=$(tmx list-panes -t "=pane-test-session" -F '#{pane_pid}' | head -1)
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$INITIAL_PID" != "$NEW_PID" ]; then
  echo "  PASS: pane process was respawned (pid changed: $INITIAL_PID -> $NEW_PID)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: pane process was NOT respawned (pid unchanged: $INITIAL_PID)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "=== Test 8: --pane sets session and pane options ==="
# Session options should be set by --pane since this is a fresh session
assert_eq "session @lace_port set" "22427" "$(get_option pane-test-session @lace_port)"
assert_eq "session @lace_user set" "node" "$(get_option pane-test-session @lace_user)"
assert_eq "session @lace_workspace set" "/workspaces/test" "$(get_option pane-test-session @lace_workspace)"

# Pane-level options should be set on the connected pane
CONNECTED_PANE=$(tmx list-panes -t "=pane-test-session" -F '#{pane_id}' | head -1)
assert_eq "pane-level @lace_port set" "22427" "$(get_pane_option "$CONNECTED_PANE" @lace_port)"
assert_eq "pane-level @lace_user set" "node" "$(get_pane_option "$CONNECTED_PANE" @lace_user)"
assert_eq "pane-level @lace_workspace set" "/workspaces/test" "$(get_pane_option "$CONNECTED_PANE" @lace_workspace)"

# Pane title should be set to the project name
PANE_TITLE=$(tmx list-panes -t "=pane-test-session" -F '#{pane_title}' | head -1)
assert_eq "pane title set" "pane-proj" "$PANE_TITLE"

echo ""
echo "=== Test 9: --pane set-if-absent does not overwrite ==="
# Connect a second project to a new pane in the same session.
# Session options should NOT change (set-if-absent logic).
setup_mocks "other-proj" "22428"
tmx split-window -t pane-test-session bash --norc --noprofile
sleep 0.3

# Run --pane targeting pane-test-session (the new split pane).
# We need to get the new pane ID.
NEW_PANE_ID=$(tmx list-panes -t "=pane-test-session" -F '#{pane_id}' | tail -1)

# Override TMUX_PANE to target the new pane
socket_path=$(tmx display-message -p '#{socket_path}' 2>/dev/null)
server_pid=$(tmx display-message -p '#{pid}' 2>/dev/null)
OUTPUT=$(TMUX="${socket_path},${server_pid},0" \
  TMUX_PANE="$NEW_PANE_ID" \
  PATH="$BINDIR:/usr/bin:/bin" \
  HOME="${HOME}" \
  timeout 5 "$LACE_INTO" --pane other-proj 2>&1 || true)
sleep 0.3

# Session-level @lace_port should still be the FIRST project's port
assert_eq "session @lace_port unchanged" "22427" "$(get_option pane-test-session @lace_port)"
# Warning should be emitted about port mismatch
assert_contains "port mismatch warning" "differs from pane target" "$OUTPUT"

echo ""
echo "=== Test 10: disconnect-pane (respawn-pane -k drops to shell) ==="
# Create a clean session for disconnect testing (avoids pane state issues
# from prior tests). The pane starts running bash (simulates an SSH pane).
kill_session "disconnect-test"
tmx new-session -d -s disconnect-test 'bash --norc --noprofile'
sleep 0.3

BEFORE_PID=$(tmx list-panes -t "=disconnect-test" -F '#{pane_pid}' | head -1)

# Run disconnect-pane: respawn-pane -k without a command starts default shell.
# Use session:pane_index syntax for targeting.
tmx respawn-pane -k -t "disconnect-test:0.0"
sleep 0.3

AFTER_PID=$(tmx list-panes -t "=disconnect-test" -F '#{pane_pid}' | head -1)
PANE_DEAD=$(tmx list-panes -t "=disconnect-test" -F '#{pane_dead}' | head -1)
assert_eq "pane alive after disconnect" "0" "$PANE_DEAD"

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$BEFORE_PID" != "$AFTER_PID" ]; then
  echo "  PASS: pane process was respawned by disconnect (pid changed: $BEFORE_PID -> $AFTER_PID)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: pane process was NOT respawned by disconnect (pid unchanged: $BEFORE_PID)"
  FAIL=$((FAIL + 1))
fi

# =============================================================================
# lace-split context detection tests
# =============================================================================

echo ""
echo "=== Test 11: lace-split local pane does local split ==="
# Create a session with a local bash pane (no lace options, no SSH)
kill_session "split-local-test"
tmx new-session -d -s split-local-test 'bash --norc --noprofile'
sleep 0.3

# lace-split should detect pane_current_command != "ssh" and do a local split
LACE_SPLIT="$SCRIPT_DIR/../lace-split"
BEFORE_COUNT=$(tmx list-panes -t "=split-local-test" | wc -l)
# Run lace-split targeting the session (from inside the test tmux)
tmx send-keys -t split-local-test "PATH=$BINDIR:/usr/bin:/bin $LACE_SPLIT -h" Enter
sleep 0.5
AFTER_COUNT=$(tmx list-panes -t "=split-local-test" | wc -l)
assert_eq "local split created pane" "2" "$AFTER_COUNT"

# Neither new pane should have pane-level lace options
for pane in $(tmx list-panes -t "=split-local-test" -F '#{pane_id}'); do
  pane_port=$(get_pane_option "$pane" @lace_port)
  if [ -n "$pane_port" ]; then
    TESTS_RUN=$((TESTS_RUN + 1))
    echo "  FAIL: local pane $pane should not have @lace_port (got: $pane_port)"
    FAIL=$((FAIL + 1))
  fi
done
TESTS_RUN=$((TESTS_RUN + 1))
echo "  PASS: local panes have no lace options"
PASS=$((PASS + 1))

echo ""
echo "=== Test 12: disconnect-pane clears pane options and respawns ==="
LACE_DISCONNECT="$SCRIPT_DIR/../lace-disconnect-pane"
# Create a session, set pane-level lace options to simulate a connected pane
kill_session "disconnect-test2"
tmx new-session -d -s disconnect-test2 'bash --norc --noprofile'
sleep 0.3

PANE_ID=$(tmx list-panes -t "=disconnect-test2" -F '#{pane_id}' | head -1)
BEFORE_PID=$(tmx list-panes -t "=disconnect-test2" -F '#{pane_pid}' | head -1)

# Simulate lace-into --pane by setting pane-level options
tmx set-option -p -t "$PANE_ID" @lace_port "22427"
tmx set-option -p -t "$PANE_ID" @lace_user "node"
tmx set-option -p -t "$PANE_ID" @lace_workspace "/workspaces/test"

# Verify options are set
assert_eq "pre-disconnect port set" "22427" "$(get_pane_option "$PANE_ID" @lace_port)"

# Run lace-disconnect-pane (uses test tmux via PATH shim)
PATH="$BINDIR:/usr/bin:/bin" "$LACE_DISCONNECT" "$PANE_ID" 2>&1 || true
sleep 0.3

# Pane should be alive with a new PID
AFTER_PID=$(tmx list-panes -t "=disconnect-test2" -F '#{pane_pid}' | head -1)
PANE_DEAD=$(tmx list-panes -t "=disconnect-test2" -F '#{pane_dead}' | head -1)
assert_eq "pane alive after disconnect" "0" "$PANE_DEAD"

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$BEFORE_PID" != "$AFTER_PID" ]; then
  echo "  PASS: pane respawned (pid changed: $BEFORE_PID -> $AFTER_PID)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: pane NOT respawned (pid unchanged: $BEFORE_PID)"
  FAIL=$((FAIL + 1))
fi

# Pane-level lace options should be cleared
assert_eq "post-disconnect port cleared" "" "$(get_pane_option "$PANE_ID" @lace_port)"
assert_eq "post-disconnect user cleared" "" "$(get_pane_option "$PANE_ID" @lace_user)"
assert_eq "post-disconnect workspace cleared" "" "$(get_pane_option "$PANE_ID" @lace_workspace)"

echo ""
echo "=== Test 13: respawned dead panes get pane-level options ==="
# Create a session, kill a pane, reconnect, verify pane-level options on respawned pane
setup_mocks "respawn-opts-proj" "22429"
kill_session "respawn-opts-proj"
OUTPUT=$(run_lace_into respawn-opts-proj)
sleep 0.3

# Set remain-on-exit and kill the pane
tmx set-option -t respawn-opts-proj remain-on-exit on
kill_pane_process "respawn-opts-proj"
assert_eq "pane dead" "1" "$(pane_dead_count respawn-opts-proj)"

# Reconnect - should respawn in place
OUTPUT=$(run_lace_into respawn-opts-proj)
sleep 0.3

# Respawned pane should have pane-level options
RESPAWNED_PANE=$(tmx list-panes -t "=respawn-opts-proj" -F '#{pane_id}' | head -1)
assert_eq "respawned pane has port" "22429" "$(get_pane_option "$RESPAWNED_PANE" @lace_port)"
assert_eq "respawned pane has workspace" "/workspaces/test" "$(get_pane_option "$RESPAWNED_PANE" @lace_workspace)"

# =============================================================================
echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed (of $TESTS_RUN)"
echo "========================================="
[ "$FAIL" -eq 0 ] || exit 1
