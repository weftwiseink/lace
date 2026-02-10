---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T07:40:00-08:00
task_list: dotfiles/bugfix
type: proposal
state: archived
status: accepted
tags: [wezterm, nushell, starship, bugfix, config, gui-startup, custom-module]
related_to:
  - cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-08T07:55:00-08:00
  round: 1
revisions:
  - at: 2026-02-08T08:10:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "B1: Separated startup vs '+' button tab duplication analysis with distinct hypotheses"
      - "B2: Added diagnostic step to Phase 1 to verify handler accumulation vs replacement"
      - "NB: Added note about unguarded update-status fallback handler"
      - "NB: Added note about setup_keybindings safety (fresh config per evaluation)"
      - "NB: Reworded Objective 1 to cover both startup and + button scenarios"
---

# Fix WezTerm Tab Duplication and Nushell Shortpath Display Bugs

> BLUF: Two user-facing bugs: (1) clicking the "+" new-tab button in WezTerm creates 3-4 extra tabs instead of one, caused by the `gui-startup` event handler being registered multiple times across config evaluations; (2) the nushell prompt shows no shortpath (e.g., `~/cod/wef/lac`) because starship's `[custom.dir]` module runs a bash script through nushell, which fails silently. Fix 1: guard the `gui-startup` handler with `wezterm.GLOBAL` to prevent duplicate registration. Fix 2: add `shell = ["bash", "--noprofile", "--norc"]` to the `[custom.dir]` starship config.

## Objective

1. WezTerm should create exactly one tab on startup, and clicking "+" should create exactly one additional tab
2. The nushell prompt should display the shortpath (e.g., `~/cod/per/dot` instead of the full path)
3. Both fixes must be applied to deployed configs AND chezmoi source (keeping them in sync)

## Background

### Bug 1: Tab Duplication on New Tab Click

**Symptom:** Clicking the "+" button at the bottom of the WezTerm window creates 3-4 additional tabs instead of just one.

**Root Cause Analysis:**

WezTerm's config file is [evaluated multiple times](https://wezterm.org/config/files.html) per process -- both at startup and during reloads. The WezTerm docs explicitly warn: "The configuration file may be evaluated multiple times for each wezterm process both at startup and in response to the configuration file being reloaded."

Evidence from the WezTerm log (`/run/user/1000/wezterm/wezterm-gui-log-2031328.txt`):

```
19:51:19.035  lace: registered 75 SSH domains for ports 22425-22499
19:51:19.136  lace: registered 75 SSH domains for ports 22425-22499
19:51:19.418  lace: registered 75 SSH domains for ports 22425-22499
19:51:19.466  lace: registered 75 SSH domains for ports 22425-22499
19:51:19.516  lace: registered 75 SSH domains for ports 22425-22499
```

The config was evaluated 5 times during one startup. Each evaluation:
1. Calls `wezterm.on("gui-startup", ...)` -- registering a NEW handler each time (WezTerm has no `wezterm.off()` to unregister, and the Lua context is fresh each evaluation, so module-level guards like `M._domains_registered` are reset)
2. Each `gui-startup` handler calls `wezterm.mux.spawn_window(...)`, which creates a window with a tab

When WezTerm fires the `gui-startup` event once, ALL registered handlers execute. With 5 registrations, 5 `spawn_window` calls happen, creating 5 windows/tabs where only 1 was intended. The user sees 4 extra tabs.

The lace plugin's `M._domains_registered` guard does NOT protect against this because each config evaluation gets a fresh Lua module table. The guard was designed to prevent re-registration within a single evaluation, not across multiple evaluations.

**Two distinct symptom scenarios require investigation:**

1. **Extra tabs at startup:** If `gui-startup` handlers accumulate across config evaluations (WezTerm calls ALL registered handlers rather than just the last), then N evaluations produce N `spawn_window` calls, creating N-1 extra tabs/windows at startup. The `wezterm.GLOBAL` guard fixes this.

2. **Extra tabs on "+" click:** The "+" button fires the default `SpawnTab` action. If clicking "+" also triggers a config reload (re-evaluating the config and accumulating more handlers), subsequent startups or reloads would produce more extra tabs. Alternatively, the extra tabs may be caused by duplicate keybinding entries from unguarded `setup_keybindings` calls in the plugin (each evaluation appends another Ctrl+Shift+P entry to `config.keys`).

**Key assumption requiring verification:** The analysis above assumes WezTerm event handlers *accumulate* across re-registrations rather than using last-writer-wins replacement. The 5x domain registration log entries prove the config is evaluated 5 times, but each `wezterm.on("gui-startup", ...)` call might replace the prior handler rather than adding a new one. Phase 1 includes a diagnostic step to confirm this.

**Note:** The current WezTerm session log shows only 1 domain registration (compared to 5 in the previous session), suggesting the number of config evaluations varies between startups. The `wezterm.GLOBAL` guard is the correct fix regardless of whether handlers accumulate or replace, because it prevents redundant side effects in either case.

### Bug 2: Nushell Shortpath Not Displaying

**Symptom:** The nushell prompt shows no directory path where it should show a shortened path like `~/cod/wef/lac`.

**Root Cause Analysis:**

The `[custom.dir]` module in `starship.toml` runs a bash script:

```toml
[custom.dir]
when = true
command = '''
short_path() {
  if [[ $PWD == $HOME ]]; then
    echo "~"
  else
    _dir=$(echo "$PWD" | sed "s|$HOME|~|g")
    more_than_three_chars='/\([^/][^/][^/]\)[^/]\+'
    dir=$(echo "$_dir" | sed "s|$more_than_three_chars|/\1|g")
    echo "$dir"
  fi
};
short_path
'''
format = "[$output ]($style)"
```

The `[custom.dir]` section has **no `shell` option**. Starship defaults to using the shell identified by `STARSHIP_SHELL`. In nushell's `env.nu`, `$env.STARSHIP_SHELL = "nu"` is set explicitly (line 41). This means starship executes the bash script (`[[ ... ]]`, `$(...)`, `sed`, etc.) through nushell's parser, which immediately fails.

Confirmed via trace logging:

```
TRACE - (starship::utils): Creating Command for binary "nu"
TRACE - (starship::modules::custom): Non-zero exit code 'Some(1)'
TRACE - (starship::modules::custom): stderr: Error: nu::parser::error
```

When the command fails, `$output` is empty, so the module renders as just a space character -- effectively invisible.

The fix is trivial: add `shell = ["bash", "--noprofile", "--norc"]` to the `[custom.dir]` section, which forces starship to run the command through bash regardless of the current shell.

## Proposed Solution

### Fix 1: Guard `gui-startup` with `wezterm.GLOBAL`

`wezterm.GLOBAL` is a [global state table](https://wezterm.org/config/lua/wezterm/GLOBAL.html) that persists across config evaluations within the same WezTerm process. Use it to ensure `gui-startup` only registers once:

```lua
-- Startup
if not wezterm.GLOBAL.gui_startup_registered then
  wezterm.GLOBAL.gui_startup_registered = true
  wezterm.on("gui-startup", function(cmd)
    local tab, pane, window = wezterm.mux.spawn_window({
      workspace = "main",
      cwd = wezterm.home_dir,
    })
  end)
end
```

This is the [documented pattern](https://wezterm.org/config/lua/wezterm/GLOBAL.html) for preventing duplicate side effects across config re-evaluations.

**File:** `~/.config/wezterm/wezterm.lua` (deployed) and `dotfiles/dot_config/wezterm/wezterm.lua` (chezmoi source)

**Note:** The `update-status` handler in the plugin-failure fallback path (line 148 of wezterm.lua) also lacks a GLOBAL guard. Since the plugin currently always loads successfully, this is not actively causing issues, but should be guarded for correctness if the fallback path is ever exercised.

### Fix 2: Add `shell` to `[custom.dir]` in starship.toml

```toml
[custom.dir]
when = true
shell = ["bash", "--noprofile", "--norc"]
style = "bg:black fg:purple"
command = '''
...unchanged...
'''
format = "[$output ]($style)"
```

**File:** `~/.config/starship.toml` (deployed) and `dotfiles/dot_config/starship.toml` (chezmoi source)

### Secondary Fix: Guard lace plugin domain registration with `wezterm.GLOBAL`

The lace plugin's `M._domains_registered` flag is reset on each config evaluation. While this does not directly cause the tab duplication bug (the domains are appended to config, not spawning windows), it causes 75 duplicate SSH domain entries to be added to the config table on each evaluation. Over 5 evaluations, that is 375 domain entries instead of 75.

In `lace.wezterm/plugin/init.lua`, replace the module-level guard with a `wezterm.GLOBAL` guard:

```lua
local function setup_port_domains(config, opts)
  if wezterm.GLOBAL.lace_domains_registered then
    return
  end

  config.ssh_domains = config.ssh_domains or {}

  for port = M.PORT_MIN, M.PORT_MAX do
    table.insert(config.ssh_domains, {
      -- ...existing domain config...
    })
  end

  wezterm.GLOBAL.lace_domains_registered = true
  wezterm.log_info("lace: registered " .. (M.PORT_MAX - M.PORT_MIN + 1) .. " SSH domains")
end
```

**Note on `setup_keybindings`:** This function (line 239 of init.lua) is NOT guarded and appends a keybinding entry on each evaluation via `table.insert(config.keys, ...)`. However, since `config_builder()` creates a fresh `config` object on each evaluation, each evaluation starts with a fresh `config.keys` table. The keybindings are rebuilt from scratch each time, so no guard is needed for `setup_keybindings`.

Similarly for the status bar and picker event registration:

```lua
local function setup_status_bar()
  if wezterm.GLOBAL.lace_status_registered then
    return
  end
  -- ...existing code...
  wezterm.GLOBAL.lace_status_registered = true
end
```

```lua
local function setup_project_picker(config, opts)
  local event_name = "lace.project-picker"
  if wezterm.GLOBAL.lace_picker_registered then
    return event_name
  end
  -- ...existing code...
  wezterm.GLOBAL.lace_picker_registered = true
  return event_name
end
```

## Design Decisions

### D1: `wezterm.GLOBAL` Over Module-Level Guards

**Decision:** Use `wezterm.GLOBAL` for all cross-evaluation guards.

**Rationale:** Module-level variables (`M._registered`, local flags) are reset when the Lua context is recreated on config re-evaluation. `wezterm.GLOBAL` persists across evaluations within the same WezTerm process, making it the correct mechanism for "run once per process" semantics.

### D2: Explicit `shell` in `[custom.dir]` Over Removing `STARSHIP_SHELL`

**Decision:** Add `shell = ["bash", "--noprofile", "--norc"]` to the custom module rather than removing the `$env.STARSHIP_SHELL = "nu"` line from `env.nu`.

**Rationale:** `STARSHIP_SHELL` is needed for starship to properly handle other nushell-specific behaviors (prompt integration, escape sequences). The custom module is the one that needs bash -- it should declare that explicitly rather than relying on a global default.

### D3: Fix Both Deployed and Chezmoi Source

**Decision:** Apply each fix to both the deployed config and the chezmoi source file.

**Rationale:** They are currently identical. If we only fix deployed, the next `chezmoi apply` will revert the fix. If we only fix chezmoi source, the user needs to run `chezmoi apply` before seeing the fix. Fixing both ensures immediate effect and persistence.

## Edge Cases

### E1: WezTerm Process Restart Clears `wezterm.GLOBAL`

**Behavior:** `wezterm.GLOBAL` is per-process. Restarting WezTerm clears all flags, which is correct -- the new process should register handlers once.

### E2: Plugin Update Resets Module but Not GLOBAL

**Behavior:** If the plugin code changes and the module reloads, `wezterm.GLOBAL.lace_picker_registered` is still `true`, preventing the new handler from registering. This is acceptable because event handlers cannot be unregistered anyway -- the old handler persists regardless. A full WezTerm restart is needed to pick up handler changes, which clears GLOBAL.

### E3: Starship `shell` Override Affects Only `[custom.dir]`

**Behavior:** The `shell` option is per-module. Other starship modules (time, git_branch, etc.) are unaffected. Other custom modules would need their own `shell` declaration if they use bash syntax.

## Implementation Phases

### Phase 1: Reproduce Both Bugs and Diagnose Root Causes

**Step 1 -- Verify shortpath is missing (Bug 2):**
- Open a nushell prompt
- Navigate to a deep directory (e.g., `cd ~/code/weft/lace`)
- Observe the prompt -- the directory segment should be empty or show just a space
- Run `STARSHIP_SHELL=nu starship module custom.dir` -- should produce empty/space output
- Run `STARSHIP_SHELL=bash starship module custom.dir` -- should produce the shortpath
- Run `STARSHIP_LOG=trace STARSHIP_SHELL=nu starship module custom.dir 2>&1 | grep -i "custom\|error\|shell\|binary"` -- should show `Creating Command for binary "nu"` and `Non-zero exit code`

**Step 2 -- Diagnose tab duplication (Bug 1):**

a. Check WezTerm log for multiple config evaluations:
   ```bash
   grep "registered.*SSH domains" /run/user/1000/wezterm/wezterm-gui-log-*.txt
   ```

b. **Determine if event handlers accumulate or replace:** Temporarily add a log line inside the `gui-startup` handler in `~/.config/wezterm/wezterm.lua`:
   ```lua
   wezterm.on("gui-startup", function(cmd)
     wezterm.log_info("gui-startup handler FIRING")
     local tab, pane, window = wezterm.mux.spawn_window({
       workspace = "main",
       cwd = wezterm.home_dir,
     })
   end)
   ```
   Restart WezTerm. Check the log for how many times "gui-startup handler FIRING" appears:
   - If it appears N times (matching the number of config evaluations), handlers **accumulate** and this confirms the root cause.
   - If it appears exactly once, handlers are **replaced** (last-writer-wins) and the extra tabs have a different cause.

c. **Distinguish startup vs "+" button symptoms:**
   - Count tabs immediately after a fresh WezTerm launch. If more than 1, the startup handler is the cause.
   - If exactly 1 at startup, try clicking "+" and count resulting tabs. If clicking "+" creates extras, the cause is different from gui-startup (possibly duplicate keybinding entries or a WezTerm bug).
   - Also test `Alt+Shift+N` (the keybinding for new tab) -- if it creates the same extra tabs, the issue is not specific to the "+" button.

d. **Remove the diagnostic log line** after testing (before proceeding to Phase 3).

### Phase 2: Fix Shortpath (Starship Config)

**What to change:** Add `shell = ["bash", "--noprofile", "--norc"]` to `[custom.dir]` in both:
- `/home/mjr/.config/starship.toml`
- `/home/mjr/code/personal/dotfiles/dot_config/starship.toml`

**Verification:**
```bash
# After saving the change:
STARSHIP_SHELL=nu starship module custom.dir
# Should now show the shortpath (e.g., ~/cod/wef/lac)
```

### Phase 3: Fix Tab Duplication (WezTerm Config)

**What to change:** Wrap the `gui-startup` handler with a `wezterm.GLOBAL` guard in both:
- `/home/mjr/.config/wezterm/wezterm.lua`
- `/home/mjr/code/personal/dotfiles/dot_config/wezterm/wezterm.lua`

Replace:
```lua
wezterm.on("gui-startup", function(cmd)
  local tab, pane, window = wezterm.mux.spawn_window({
    workspace = "main",
    cwd = wezterm.home_dir,
  })
end)
```

With:
```lua
if not wezterm.GLOBAL.gui_startup_registered then
  wezterm.GLOBAL.gui_startup_registered = true
  wezterm.on("gui-startup", function(cmd)
    local tab, pane, window = wezterm.mux.spawn_window({
      workspace = "main",
      cwd = wezterm.home_dir,
    })
  end)
end
```

**Verification:**
- Restart WezTerm completely
- Check log: should see `lace: registered 75 SSH domains` only ONCE
- Click "+" button: should create exactly one new tab

### Phase 4: Fix Lace Plugin Guards (Optional, Correctness)

**What to change:** In `/home/mjr/code/weft/lace.wezterm/plugin/init.lua`, replace module-level guards with `wezterm.GLOBAL` guards for:
- `setup_port_domains()` -- use `wezterm.GLOBAL.lace_domains_registered`
- `setup_status_bar()` -- use `wezterm.GLOBAL.lace_status_registered`
- `setup_project_picker()` -- use `wezterm.GLOBAL.lace_picker_registered`

**Verification:**
- Restart WezTerm
- Check log: should see domain registration message exactly once
- Project picker should still work (if containers are running)

### Phase 5: Verify Fixes End-to-End

1. Restart WezTerm
2. Confirm exactly 1 tab on startup
3. Confirm shortpath displays in prompt
4. Click "+" -- confirm exactly 1 new tab
5. Navigate to different directories -- confirm shortpath updates
6. Reload config (Leader+R) -- confirm no extra tabs appear
7. Check WezTerm log -- confirm no duplicate registrations

## Test Plan

| # | Test | Expected | How to Verify |
|---|------|----------|---------------|
| 1 | Fresh WezTerm startup | Exactly 1 tab in 1 window | Visual count of tabs |
| 2 | Click "+" button | Exactly 1 new tab | Visual count of tabs |
| 3 | Config reload (Leader+R) | No new tabs, no errors | Tab count unchanged, check log |
| 4 | Shortpath at `~/code/weft/lace` | Prompt shows `~/cod/wef/lac` | Visual inspection of prompt |
| 5 | Shortpath at `~` | Prompt shows `~` | Visual inspection |
| 6 | Shortpath in deep nested dir | All dirs >3 chars truncated to 3 | Visual inspection |
| 7 | WezTerm log after startup | `registered 75 SSH domains` appears once | `grep` log file |
| 8 | `starship module custom.dir` with `STARSHIP_SHELL=nu` | Shows shortpath output | Terminal command |
| 9 | Deployed and chezmoi source in sync | `diff` shows no differences | `diff ~/.config/wezterm/wezterm.lua ~/code/personal/dotfiles/dot_config/wezterm/wezterm.lua` |
