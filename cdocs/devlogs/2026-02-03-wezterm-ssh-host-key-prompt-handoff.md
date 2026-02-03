---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-03T08:00:00-08:00
task_list: lace/devcontainer-workflow
type: devlog
state: live
status: handoff
tags: [wezterm, ssh, host-key, devcontainer, troubleshooting]
---

# WezTerm SSH Host Key Trust Prompt: Troubleshooting Handoff

## Problem Statement

When running `bin/open-lace-workspace`, WezTerm displays an interactive host key trust prompt that blocks automated connection:

```
Connecting to localhost using SSH
Using libssh-rs to connect to node@localhost:2222
SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u7
SSH host localhost:2222 is not yet trusted.
Fingerprint: 5c:75:ab:5e:aa:d4:eb:e5:f8:f9:44:74:6e:27:f2:89:fe:53:5f:ae:ef:7e:e2:55:32:65:d0:04:a2:e8:3b:57.
Trust and continue connecting?
Enter [y/n]>
```

This prompt appears **every time** the user connects, even after accepting. The goal is to eliminate this prompt while maintaining security.

## What Has Been Tried (All Failed)

### 1. OpenSSH-style ssh_option in wezterm.lua
```lua
ssh_option = {
  identityfile = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  stricthostkeychecking = "no",
  userknownhostsfile = "/dev/null",
},
```
**Result**: No effect. WezTerm's libssh-rs backend does NOT honor OpenSSH config options.

### 2. Pre-emptive ssh-keygen -R in script
```bash
ssh-keygen -R "[localhost]:$SSH_PORT" 2>/dev/null || true
```
**Result**: No effect. This removes entries from `~/.ssh/known_hosts`, but WezTerm/libssh-rs apparently uses a different known_hosts file or mechanism.

## Key Technical Details

- **SSH backend**: WezTerm uses `libssh-rs` (not OpenSSH) for its built-in SSH
- **The prompt comes from**: WezTerm's GUI, not the terminal/script
- **Container host key**: Changes on every rebuild (expected behavior)
- **Connection target**: `localhost:2222` (container's sshd)
- **Authentication**: Works fine via dedicated key `~/.ssh/lace_devcontainer`

## Files Reference

| File | Role |
|------|------|
| `bin/open-lace-workspace` | Script that invokes `wezterm connect lace` |
| `config/wezterm/wezterm.lua` | Host-side wezterm config defining `lace` SSH domain |
| `.devcontainer/wezterm.lua` | Container-side wezterm config (mux server settings) |

## Critical Requirement for Next Agent

**USE A TEST-DRIVEN, VERIFIABLE METHODOLOGY**

The previous attempts modified config and assumed they would work. They did not. The next agent MUST:

1. **Identify where libssh-rs stores its known_hosts** - It may NOT be `~/.ssh/known_hosts`. Search for:
   - `~/.local/share/wezterm/`
   - `~/.config/wezterm/`
   - WezTerm's data directory
   - Environment variables that control this

2. **Test each hypothesis empirically** before declaring it fixed:
   - Make a change
   - Run `bin/open-lace-workspace` (or `wezterm connect lace` directly)
   - **Observe** whether the prompt appears
   - Document the result

3. **Verify the fix works across scenarios**:
   - Fresh connection (no prior trust)
   - After container rebuild (host key changes)
   - After wezterm restart

4. **Possible approaches to investigate**:
   - Find and modify/delete WezTerm's actual known_hosts file
   - Check if there's a WezTerm-specific config option (not OpenSSH-style)
   - Check if `ssh_backend = "Ssh2"` behaves differently than `"LibSsh"`
   - Check WezTerm source code or issues for host key bypass options
   - Pre-populate the known_hosts with the container's current host key

5. **Do NOT claim success until you have personally observed** that running the command produces no prompt.

## Reproduction Steps

```bash
# From the repo root:
cd /var/home/mjr/code/weft/lace

# Ensure container is running
docker ps | grep devcontainer

# Run the script - observe if prompt appears
bin/open-lace-workspace

# Or test wezterm directly:
WEZTERM_CONFIG_FILE=$PWD/config/wezterm/wezterm.lua wezterm connect lace
```

## Success Criteria

Running `bin/open-lace-workspace` connects to the container **without any interactive prompt**, while still using SSH key authentication for security.
