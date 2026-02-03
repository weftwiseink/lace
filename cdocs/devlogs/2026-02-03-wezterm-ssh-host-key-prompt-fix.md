---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-03T08:35:00-08:00
task_list: lace/devcontainer-workflow
type: devlog
state: live
status: complete
tags: [wezterm, ssh, host-key, devcontainer, fix]
---

# WezTerm SSH Host Key Trust Prompt: Fix Implemented

## Problem

WezTerm displayed an interactive host key trust prompt every time connecting to the devcontainer:

```
SSH host localhost:2222 is not yet trusted.
Fingerprint: 5c:75:ab:5e:aa:d4:eb:e5:f8:f9:44:74:6e:27:f2:89:fe:53:5f:ae:ef:7e:e2:55:32:65:d0:04:a2:e8:3b:57.
Trust and continue connecting?
Enter [y/n]>
```

## Root Cause Analysis

1. **WezTerm's libssh-rs backend does NOT honor OpenSSH options** like `StrictHostKeyChecking=no`
2. **Setting `userknownhostsfile = "/dev/null"` was counterproductive** - it meant the host could NEVER be known, so WezTerm always prompted for trust
3. **The previous approach (ssh-keygen -R) only removed keys** but didn't add new ones

From the WezTerm source code (`wezterm-ssh/src/host.rs`), the libssh backend:
1. Calls `sess.is_known_server()` 
2. If result is `NotFound` or `Unknown`, prompts for trust
3. Uses `~/.ssh/known_hosts` to check host keys (respects `userknownhostsfile` config)

## Solution

**Two-part fix:**

### 1. Update `config/wezterm/wezterm.lua`

Removed the broken options and added explanatory comments:

```lua
ssh_option = {
  identityfile = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  -- Host key verification is handled by pre-populating ~/.ssh/known_hosts
  -- in bin/open-lace-workspace before connecting.
  -- Do NOT use userknownhostsfile = "/dev/null" - that makes every
  -- connection prompt for trust since the host can never be "known".
},
```

### 2. Update `bin/open-lace-workspace`

Pre-populate `~/.ssh/known_hosts` with the container's current host keys before connecting:

```bash
# Pre-populate known_hosts with the container's current SSH host keys.
if [[ -f "$HOME/.ssh/known_hosts" ]]; then
  ssh-keygen -R "[localhost]:$SSH_PORT" 2>/dev/null || true
fi
info "updating known_hosts with container's current host keys..."
if ! ssh-keyscan -p "$SSH_PORT" "$SSH_HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null; then
  info "warning: could not fetch container host keys (will prompt for trust on first connect)"
fi
```

## Verification

Tested with debug logging:

**Without host keys pre-populated:**
```
perform PrintString("SSH host localhost:2222 is not yet trusted.")
perform PrintString("Trust and continue connecting?")
```

**With host keys pre-populated:**
```
going to run /usr/local/bin/wezterm cli --prefer-mux proxy
perform PrintString("Running: /usr/local/bin/wezterm cli --prefer-mux proxy")
```

No trust prompt - connection proceeds directly.

## Files Changed

| File | Change |
|------|--------|
| `config/wezterm/wezterm.lua` | Removed broken `stricthostkeychecking` and `userknownhostsfile=/dev/null` options |
| `bin/open-lace-workspace` | Added `ssh-keyscan` to pre-populate known_hosts before connecting |

## Key Insight

The fundamental misunderstanding was thinking OpenSSH-style options would work with WezTerm's built-in SSH. They don't - WezTerm's libssh/libssh2 backends have their own host key verification logic that reads from `~/.ssh/known_hosts` (or the file specified by `userknownhostsfile`).

The solution is to work WITH this system by pre-populating the known_hosts file, not trying to bypass it.
