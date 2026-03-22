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

# Run lace-into again - current behavior: kills session and recreates
# Desired behavior: respawn in place
OUTPUT=$(run_lace_into test-proj)
sleep 0.3
assert_eq "session exists after reconnect" "0" "$(tmx has-session -t '=test-proj' 2>/dev/null; echo $?)"
assert_eq "pane alive after reconnect" "1" "$(pane_alive_count test-proj)"
assert_eq "port preserved" "22426" "$(get_option test-proj @lace_port)"
# Check which message was output (documents current behavior)
if echo "$OUTPUT" | grep -q "no live panes"; then
  echo "  INFO: used kill-and-recreate path"
elif echo "$OUTPUT" | grep -q "respawning"; then
  echo "  INFO: used respawn-in-place path"
fi

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
echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed (of $TESTS_RUN)"
echo "========================================="
[ "$FAIL" -eq 0 ] || exit 1
