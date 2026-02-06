---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:55:00-08:00
task_list: lace/wezterm-plugin
type: proposal
state: archived
status: accepted
tags: [wezterm, docker, ssh, plugin, username, devcontainer]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:58:00-08:00
  round: 1
revisions:
  - at: 2026-02-06T00:05:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "B1: Replaced ConnectToUri with domain re-registration approach; documented that ConnectToUri bypasses SSH domain config (identity file, multiplexing)"
      - "B2: Enumerated three candidate WezTerm API approaches with tradeoffs in implementation plan"
      - "NB1: Noted that wez-lace-into already handles username correctly"
      - "NB2: Acknowledged Docker prevents duplicate port bindings"
  - at: 2026-02-06T06:30:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Expanded Implementation Plan into 5 phased steps with specific code changes, verification steps, expected behavior, and fallback guidance"
      - "Expanded Test Plan with verification commands, 7 manual test scenarios with step-by-step procedures, log inspection guide, and plugin reload instructions"
      - "Added Implementation Constraints section: WezTerm Lua API notes, plugin loading/execution order, config loading issue, testing environment status"
      - "Added complete code path walkthrough from keypress to SSH connection (9 steps)"
      - "Added line-number reference table for all relevant functions in init.lua"
      - "Documented event handler re-registration caveat and dev workaround"
      - "Documented stale plugin path in deployed wezterm.lua and lace container port range mismatch"
related_to:
  - cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
  - cdocs/reports/2026-02-05-dotfiles-modernization-project-assessment.md
---

# Docker-Based SSH Username Lookup for lace.wezterm Plugin

> BLUF: The lace.wezterm plugin hardcodes `username = "node"` for all 75 pre-registered SSH domains. This breaks any devcontainer that uses a different user (e.g., `vscode` in the dotfiles container). The fix: query `docker inspect` at connection time via the project picker to resolve the correct username per container, with a configurable default fallback for when no container is running. This unblocks the launcher elimination proposal, which currently requires an awkward `remoteUser: "node"` override in the dotfiles devcontainer.

## Objective

Make the lace.wezterm plugin work correctly with devcontainers that use any SSH username, not just `node`. Specifically:

1. Resolve the correct SSH username per-container via Docker at discovery time
2. Provide a configurable default username for domains where no container is running
3. Require no changes to existing `apply_to_config` call sites beyond optionally setting `username`

## Background

### The Problem

The plugin's `setup_port_domains()` registers 75 SSH domains (ports 22425-22499), each with `username = opts.username` (default `"node"`). This username is baked into the SSH domain at WezTerm config load time. When connecting to a container whose SSH user is not `node` (e.g., `vscode` in `mcr.microsoft.com/devcontainers/base:ubuntu`), the SSH connection fails because the wrong user is specified.

The `discover_projects()` function already queries `docker inspect` for the container user and stores it in the project table. But this information is only used for display -- it cannot retroactively change the username baked into the SSH domain.

### What Docker Tells Us

For a running devcontainer, Docker provides:

- **`docker inspect --format '{{.Config.User}}'`**: Returns the container's configured user (e.g., `node`, `vscode`, or empty for root). This is the user the container runs as.
- **`devcontainer.local_folder` label**: Identifies which host project owns the container.
- **Port mappings**: Map host ports to container ports, letting us match a port in the lace range to a container.

The existing `discover_projects()` function already uses all three of these to build a project table with port, name, path, and user. The infrastructure for user lookup is already in place -- it just is not used when connecting.

Note: The devcontainer metadata label also contains a `remoteUser` field, but `Config.User` is preferred because it is authoritative -- it reflects what the container actually runs as, which is the user SSH needs. The `remoteUser` is a devcontainer CLI concept that may not match the SSH user in all configurations.

### Why This Matters Now

The [launcher elimination proposal](2026-02-05-dotfiles-eliminate-workspace-launcher.md) wants to migrate the dotfiles devcontainer to the lace port-range model. Currently, it includes a workaround (Design Decision 6) that overrides the dotfiles container user to `node`. This is wrong -- the dotfiles image has a `vscode` user, not `node`, and forcing a different user is fragile. Fixing the plugin removes this workaround and lets each container keep its natural user.

## Proposed Solution

### Approach: Override SSH Domain Username at Connection Time

WezTerm SSH domains have their username set at registration time. However, when connecting through the **project picker**, we have the discovered project's actual user from `docker inspect`. The picker's `SwitchToWorkspace` action can override the spawn command to use the correct user.

The solution has two parts:

**Part 1: Use discovered username in project picker connections**

When the project picker connects to a discovered container, it already knows the correct username (from `discover_projects()`). Instead of relying on the pre-registered domain's baked-in username, the picker updates the SSH domain's username before connecting.

The recommended approach is **domain re-registration**: before connecting, the picker modifies the existing `lace:PORT` domain entry in the config's `ssh_domains` table to use the discovered username, then connects via the domain as before. This preserves all SSH domain configuration (identity file, multiplexing mode, `StrictHostKeyChecking` option) while only overriding the username.

> **Why not `ConnectToUri`?** WezTerm's `ConnectToUri` with `ssh://user@localhost:port` bypasses the pre-registered SSH domain entirely. This loses the domain's configured `identityfile`, `multiplexing` mode, and other `ssh_option` settings. The connection would fail because no SSH key is specified. Domain re-registration avoids this by staying within the SSH domain model.

Three candidate approaches were evaluated (see Implementation Plan for details). Domain re-registration was chosen for its simplicity and correctness.

**Part 2: Configurable default username**

The `apply_to_config` options already accept a `username` field (default `"node"`). This remains as the fallback for:
- Pre-registered domains (used when connecting directly via `wezterm connect lace:PORT`)
- Cases where Docker is not available
- Cases where `docker inspect` returns an empty user

The default can be changed per-installation by passing `username = "vscode"` (or any other value) in `apply_to_config`.

### API Changes

No changes to the `apply_to_config` function signature. The only visible change:

```lua
-- Existing call sites continue to work unchanged:
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
})

-- Optionally change the default username (affects pre-registered domains):
lace.apply_to_config(config, {
  ssh_key = wezterm.home_dir .. "/.ssh/lace_devcontainer",
  username = "vscode",  -- changes the fallback default
})
```

### What Changes in the Plugin

1. **`discover_projects()`** -- already correct. It queries `docker inspect` for `Config.User` and falls back to `M.defaults.username`. No changes needed.

2. **`setup_project_picker()`** -- modified. When the user selects a project, the picker updates the SSH domain's username before connecting:
   ```lua
   -- Before connecting, update the domain's username to match the discovered user:
   local domain_name = "lace:" .. project.port
   for _, domain in ipairs(config.ssh_domains) do
     if domain.name == domain_name then
       domain.username = project.user
       break
     end
   end
   -- Then connect via the domain as before (preserves identity file, multiplexing, etc.):
   spawn = {
     domain = { DomainName = domain_name },
     cwd = opts.workspace_path,
   }
   ```
   Note: This requires `setup_project_picker` to have a reference to the config's `ssh_domains` table. The config object can be captured in the closure or passed as a parameter.

3. **`setup_port_domains()`** -- unchanged. Continues to register domains with `opts.username` as the default. These domains serve as the fallback for direct `wezterm connect lace:PORT` usage.

### Connection Paths and Username Resolution

| Connection Method | Username Source | Handles Multi-User? |
|---|---|---|
| Project picker (Ctrl+Shift+P) | `docker inspect` at discovery time | Yes |
| `wez-lace-into <project>` | `lace-discover` (already queries Docker) | Yes (already works) |
| Direct `wezterm connect lace:PORT` | Pre-registered domain default | No (uses configured default) |

The first two paths -- which are the primary ways to connect -- both resolve the correct username dynamically. Notably, `wez-lace-into` already handles this correctly today via `lace-discover`, which queries Docker for the container user. This proposal only fixes the WezTerm-native project picker path. The third path (direct connection) uses the static default, which is acceptable since it is a power-user escape hatch.

## Edge Cases

### No Container Running on Port

**Behavior:** `discover_projects()` returns nothing for that port. The pre-registered domain still works with the default username.

**Impact:** None. The pre-registered domain exists for exactly this case -- it lets `wezterm connect lace:PORT` work even when discovery has not run.

### `docker inspect` Returns Empty User

**Behavior:** Empty string means the container runs as root. The plugin falls back to `opts.username` (default `"node"`).

**Impact:** Correct behavior. Containers that run as root typically still have a non-root user for SSH; the configured default should match the expected user for the project ecosystem.

### Docker Not Available

**Behavior:** `discover_projects()` fails gracefully (already handled -- logs a warning, returns empty table). Project picker shows "No running devcontainers found."

**Impact:** None for project picker. Pre-registered domains still work with the default username, so direct `wezterm connect` is unaffected.

### Two Containers on the Same Port

**Behavior:** Cannot happen. Docker rejects duplicate host port bindings at container start time.

**Impact:** None. The port-to-container mapping is always 1:1.

### Container User Is a UID, Not a Name

**Behavior:** `docker inspect` may return a numeric UID (e.g., `1000`). The current code's `gsub("%s+", "")` would pass this through.

**Impact:** The existing `discover_projects()` already handles this by checking `extracted_user ~= "" and extracted_user ~= "root"`. A UID would be passed through as-is, which SSH accepts. No additional handling needed.

## Implementation Plan

### Prerequisites (Do These First)

Before starting any implementation phase, the implementing agent must set up a working test environment. These steps are needed because of two current-state issues documented in "Implementation Constraints" below.

1. **Fix the plugin load path.** The deployed `~/.config/wezterm/wezterm.lua` points to a stale path. Edit the `get_lace_plugin_path()` function in `~/.config/wezterm/wezterm.lua` to return `"file:///home/mjr/code/weft/lace.wezterm"` for the host case. (Or copy `lace.wezterm/_old_config_reference/wezterm/wezterm.lua` to `~/.config/wezterm/wezterm.lua` as a minimal test harness.) Also strip out calls to `connect_action` and `get_picker_event("lace")` which reference the old plugin API -- only `apply_to_config` is needed.

2. **Get a discoverable container running.** The current lace container uses port 2222 (outside the 22425-22499 range). Fastest option: temporarily set `M.PORT_MIN = 2222` and `M.PORT_MAX = 2222` in `plugin/init.lua` so the existing container is discovered. This also means only one SSH domain is registered (faster startup). Revert to the real range before committing.

3. **Verify the plugin loads.** Restart WezTerm. Check the log at `/run/user/1000/wezterm/wezterm-gui-log-*.txt` for `lace: registered ... SSH domains`. If you see `Failed to load lace plugin`, the path from step 1 is still wrong.

4. **Verify discovery works.** Open the project picker (Ctrl+Shift+P). You should see the lace container listed. If not, check Docker: `docker ps --filter label=devcontainer.local_folder --format '{{.Names}}\t{{.Ports}}'`.

Once all four checks pass, proceed to Phase 1.

### Phase 1: Modify `setup_project_picker` Signature to Accept Config

**What to change:** The function signature of `setup_project_picker()` (line 143 of `plugin/init.lua`) currently accepts only `opts`. It needs to also accept the `config` object so the picker closure can access `config.ssh_domains`.

Change the signature from:
```lua
local function setup_project_picker(opts)
```
to:
```lua
local function setup_project_picker(config, opts)
```

Also update the call site in `apply_to_config()` (line 266) from:
```lua
local picker_event = setup_project_picker(opts)
```
to:
```lua
local picker_event = setup_project_picker(config, opts)
```

**How to verify:** Restart WezTerm (close all windows, reopen). Open project picker (Ctrl+Shift+P). It should still show running devcontainers and connect normally -- this step is purely a plumbing change. If something broke, WezTerm logs will show a Lua error. Check logs at `/run/user/1000/wezterm/wezterm-gui-log-<PID>.txt` (find the active PID via `ls -lt /run/user/1000/wezterm/wezterm-gui-log-*.txt | head -1`).

**Expected behavior:** Identical to current behavior. No user-visible change.

**If it doesn't work:** Look for Lua errors in the WezTerm log. The most likely issue is a typo in the argument order. The `config` object is already available in `apply_to_config` -- it is the first argument.

### Phase 2: Add Domain Username Override in Picker Action

**What to change:** Inside `setup_project_picker()`, modify the `action_callback` closure (lines 174-189) to update the SSH domain's username before connecting. The current code at lines 179-189:

```lua
-- Connect via pre-registered port-based domain
win:perform_action(
  act.SwitchToWorkspace({
    name = id,
    spawn = {
      domain = { DomainName = "lace:" .. project.port },
      cwd = opts.workspace_path,
    },
  }),
  pane
)
```

Insert a domain username override before the `win:perform_action` call:

```lua
-- Override the SSH domain's username with the discovered container user
local domain_name = "lace:" .. project.port
for _, domain in ipairs(config.ssh_domains) do
  if domain.name == domain_name then
    domain.username = project.user
    break
  end
end

-- Connect via pre-registered port-based domain (now with correct username)
win:perform_action(
  act.SwitchToWorkspace({
    name = id,
    spawn = {
      domain = { DomainName = domain_name },
      cwd = opts.workspace_path,
    },
  }),
  pane
)
```

**Why this works:** Lua tables are reference types. `config.ssh_domains` is the same table that WezTerm reads when it establishes the SSH connection. Mutating `domain.username` in the picker's action callback changes the value WezTerm sees when it processes the `SwitchToWorkspace` action. The identity file, multiplexing mode, and `ssh_option` settings on the same domain entry are preserved because we only change the `username` field.

**How to verify:**
1. Confirm a discoverable container is running (see "Current Testing Environment" below for port-range caveats).
2. **Restart WezTerm entirely** (not just reload -- the `_registered_events` guard means picker handler changes require a full restart; see "How to Reload the Plugin" in the Test Plan).
3. Open project picker (Ctrl+Shift+P).
4. Select a project. It should connect as the discovered user (regression check).
5. Add a temporary `wezterm.log_info("lace: overriding domain " .. domain_name .. " username to " .. project.user)` line right after the `domain.username = project.user` assignment. Restart WezTerm, pick a project, and check the WezTerm log to confirm the override ran with the expected username.

**Expected behavior:** The picker connects using the discovered username. For the lace container, this is `node`. The log line should show `lace: overriding domain lace:<PORT> username to node`.

**If it doesn't work:** If the connection fails with an auth error, the domain mutation may not be taking effect before WezTerm processes the `SwitchToWorkspace`. Check whether:
- The `config.ssh_domains` reference is the same table WezTerm is using (it should be -- it was passed from `config_builder()`).
- The `for` loop is actually finding the domain (add a log if the loop completes without finding a match).
- The `project.user` value is what you expect (log it).

If domain mutation genuinely does not work (WezTerm snapshots the config before the callback runs), fall back to investigating Approach C (dynamic domain creation at discovery time rather than connection time). This is unlikely to be needed.

### Phase 3: Handle Edge Cases

**What to change:** Replace the Phase 2 domain override block with a version that adds defensive logging and fallback handling:

```lua
local domain_name = "lace:" .. project.port
local domain_found = false
for _, domain in ipairs(config.ssh_domains) do
  if domain.name == domain_name then
    wezterm.log_info("lace: connecting to " .. project.name .. " as " .. project.user .. " on port " .. project.port)
    domain.username = project.user
    domain_found = true
    break
  end
end
if not domain_found then
  wezterm.log_warn("lace: SSH domain " .. domain_name .. " not found in config.ssh_domains -- connecting with pre-registered default")
end
```

This handles:
- **Domain not found in table** (should never happen since `setup_port_domains` registers all 75, but defensive logging helps debugging).
- **Logging the username override** for every connection, making it easy to diagnose issues.

**How to verify:** Restart WezTerm, connect via picker, check log. The `lace: connecting to ...` line should appear for every successful connection.

**If it doesn't work:** If `domain_found` is false, something is wrong with how `config.ssh_domains` is being shared. Compare the table identity: add `wezterm.log_info("lace: ssh_domains table has " .. #config.ssh_domains .. " entries")` at the top of the callback.

### Phase 4: Remove Debug Logging and Clean Up

**What to change:** Remove any temporary `wezterm.log_info` lines added for debugging. Keep the `wezterm.log_info` that logs the connection username (it is useful for production diagnostics) and the `wezterm.log_warn` for the missing domain case.

**How to verify:** Final restart of WezTerm, connect to a project via picker, confirm clean log output with just the one info line per connection.

### Phase 5: Verify with Dotfiles Container (Post-Launcher-Elimination)

**Scope:** This phase depends on the launcher elimination proposal being complete (dotfiles on port 22426). It is a validation step, not a code change.

**Dependencies:** Phase 4 complete, launcher elimination Phase 1 complete.

**Success criteria:**
- `lace-discover` shows `dotfiles:22426:vscode:/home/mjr/code/personal/dotfiles`
- Project picker shows dotfiles and connects as `vscode`
- Lace project picker shows lace and connects as `node`
- Both work simultaneously

**Candidate WezTerm API approaches (reference):**

| Approach | Mechanism | Pros | Cons | Verdict |
|----------|-----------|------|------|---------|
| A. Domain re-registration | Update the `username` field on the existing `lace:PORT` SSH domain entry before connecting | Preserves all SSH config (identity file, multiplexing, ssh_option); minimal code change | Requires config reference in picker closure; mutates shared state | **Recommended** |
| B. `ConnectToUri` | Use `ssh://user@localhost:port` URI directly | Simple one-liner | Bypasses SSH domain entirely -- loses identity file, multiplexing mode, StrictHostKeyChecking. Connection will fail without the SSH key. | Rejected |
| C. Dynamic domain creation | Create a new temporary SSH domain (e.g., `lace:PORT:user`) with the correct username at discovery time | Clean separation; no mutation of existing domains | Creates up to 75 extra domains; WezTerm may not support adding domains after config load | Rejected |

## Test Plan

### Verification Commands Reference

**Find the active WezTerm log file:**
```bash
ls -lt /run/user/1000/wezterm/wezterm-gui-log-*.txt | head -1
```

**Tail the WezTerm log in real time (run this in a separate terminal before testing):**
```bash
tail -f "$(ls -t /run/user/1000/wezterm/wezterm-gui-log-*.txt | head -1)"
```

**Check which containers are running with their ports and users:**
```bash
docker ps --filter label=devcontainer.local_folder \
  --format '{{.Names}}\t{{.Label "devcontainer.local_folder"}}\t{{.Ports}}' | \
  while IFS=$'\t' read name folder ports; do
    user=$(docker inspect --format '{{.Config.User}}' "$name" 2>/dev/null)
    echo "$name  user=$user  ports=$ports  folder=$folder"
  done
```

**Verify plugin discovery matches Docker state (run from lace repo root):**
```bash
/var/home/mjr/code/weft/lace/bin/lace-discover
```
Expected output format: `project-name:PORT:USER:/path/to/project`

**Reload WezTerm config without restarting:**
Press Leader+R (Alt+Z then R) in WezTerm. Alternatively, `touch ~/.config/wezterm/wezterm.lua` triggers an auto-reload if WezTerm is watching the file.

**Check that SSH domains are registered (from wezterm debug console):**
The WezTerm debug overlay (Ctrl+Shift+L) can inspect the config. Alternatively, successful connection to any `lace:PORT` domain confirms domains are registered.

### Manual Test Scenarios

| # | Scenario | Steps | Expected Outcome | How to Confirm |
|---|----------|-------|------------------|----------------|
| 1 | Picker connects to `node`-user container (regression) | Start lace devcontainer (port in 22425-22499). Reload WezTerm. Open picker (Ctrl+Shift+P). Select lace. | Connection succeeds. Shell prompt shows `node@<container>`. | Run `whoami` in the connected pane -- should print `node`. WezTerm log shows `lace: connecting to lace as node on port <PORT>`. |
| 2 | Picker connects to `vscode`-user container | Start dotfiles devcontainer on port 22426 (post-launcher-elimination). Reload WezTerm. Open picker. Select dotfiles. | Connection succeeds. Shell prompt shows `vscode@<container>`. | Run `whoami` -- should print `vscode`. WezTerm log shows `lace: connecting to dotfiles as vscode on port 22426`. |
| 3 | Direct `wezterm connect lace:PORT` | From a terminal: `wezterm connect lace:22425` (with a container running on that port). | Connects using the pre-registered default username (`node`). | Run `whoami` in the connected pane. The domain override logic does NOT run for direct connections -- only the picker path is modified. |
| 4 | No containers running | Stop all devcontainers (`docker stop $(docker ps -q)`). Reload WezTerm. Open picker. | Toast notification: "No running devcontainers found". | Visual confirmation of the toast. No errors in WezTerm log. |
| 5 | Docker unavailable | Stop Docker daemon (`sudo systemctl stop docker`). Reload WezTerm. Open picker. | Toast notification: "No running devcontainers found". Pre-registered domains still exist (no crash). | Visual toast confirmation. `wezterm connect lace:22425` still attempts connection (will fail at SSH level since no container is running, but WezTerm itself does not crash). |
| 6 | Container with empty user (root) | Start a container with no USER directive (runs as root) on a lace-range port. Open picker. | Picker shows the project. On connection, uses `M.defaults.username` (`node`). | `discover_projects()` falls back to `opts.username` when `Config.User` is empty. Check WezTerm log for the username used. |
| 7 | Two projects running simultaneously | Start both lace (user `node`) and dotfiles (user `vscode`) containers. Reload WezTerm. Open picker. | Both projects appear in the picker. Selecting lace connects as `node`. Selecting dotfiles connects as `vscode`. | Run `whoami` in each connected workspace. Switch between workspaces (Leader+S) and verify both remain connected. |

### How to Inspect WezTerm Logs

WezTerm writes per-process log files to `/run/user/1000/wezterm/`. The active GUI process log is named `wezterm-gui-log-<PID>.txt`. Key things to look for:

- **`lace: registered 75 SSH domains`** -- confirms `setup_port_domains()` ran successfully at config load time.
- **`lace: connecting to <name> as <user> on port <port>`** -- confirms the picker ran the domain override (added in Phase 3).
- **`lace: SSH domain lace:<PORT> not found`** -- indicates a bug: the domain table is not shared correctly.
- **`lua: docker ps failed:`** -- Docker is not available or the command failed.
- **Lua stack traces** -- indicate a code error in the plugin. The trace will reference line numbers in `init.lua`.

Log verbosity is controlled by the `WEZTERM_LOG` environment variable. To get maximum Lua logging:
```bash
WEZTERM_LOG=info wezterm
```

### How to Reload the Plugin

WezTerm caches plugins in `~/.local/share/wezterm/plugins/`. The lace.wezterm plugin is cached at:
```
~/.local/share/wezterm/plugins/filesCssZssZssZshomesZsmjrsZscodesZsweftsZslacesDswezterm/
```

For **local development** (loading via `file://` URL), WezTerm reads the plugin source directly. Edits to `/home/mjr/code/weft/lace.wezterm/plugin/init.lua` take effect on the next config reload (Leader+R or Ctrl+Shift+R). There is no need to restart WezTerm -- a config reload re-executes the plugin's Lua code, including the `apply_to_config` call in `wezterm.lua`.

**Important caveat:** The plugin's `M._registered_events` guard (line 147) prevents re-registering the `lace.project-picker` event handler on reload. This means the picker always uses the **first-registered** handler. To pick up changes to the picker logic during development, you must **restart WezTerm entirely** (close all windows, then reopen). This is a known limitation of WezTerm's event system. Plan your edit-test cycle accordingly:

1. Edit `plugin/init.lua`.
2. Close WezTerm completely (`wezterm cli --no-auto-start list` should return nothing, or just close all windows).
3. Start WezTerm fresh.
4. Test the change.

Alternatively, during development, you can temporarily comment out the `if M._registered_events[event_name] then return event_name end` guard (lines 147-149) to allow re-registration on reload. **Remember to restore it before committing.**

## Implementation Constraints

### WezTerm Lua API Notes

- **`wezterm.run_child_process({...})`** runs a command synchronously and returns `(success, stdout, stderr)`. This is used by `discover_projects()` to call Docker CLI commands. It blocks the WezTerm event loop, so it should not be called in hot paths. The picker invocation (user presses Ctrl+Shift+P) is an acceptable place to block briefly.
- **`wezterm.on(event_name, callback)`** registers an event handler. Handlers persist for the process lifetime. There is no `wezterm.off()` to unregister. The `M._registered_events` guard prevents duplicate handlers.
- **`wezterm.action_callback(fn)`** wraps a Lua function as a WezTerm action. The callback receives `(window, pane)` or `(window, pane, id)` depending on context. In `InputSelector`, the callback receives `(window, pane, id)` where `id` is the selected choice's `id` field.
- **`act.SwitchToWorkspace({name, spawn})`** creates or switches to a named workspace. The `spawn` table's `domain` field references a registered SSH domain by name. The `cwd` field sets the working directory on the remote.
- **`config.ssh_domains`** is a plain Lua table of domain definition tables. Mutating entries in this table affects subsequent SSH connections that reference those domains. WezTerm reads the table at connection time, not at config load time, which is why domain re-registration works.

### Plugin Loading and Execution Order

The plugin is loaded in `~/.config/wezterm/wezterm.lua` via:
```lua
local ok, lace_plugin = pcall(wezterm.plugin.require, get_lace_plugin_path())
```

The `plugin.require` call executes `plugin/init.lua` and returns the module table `M`. Then `lace_plugin.apply_to_config(config, opts)` is called, which:
1. Merges default options (line 250).
2. Calls `setup_port_domains(config, opts)` -- registers 75 SSH domains in `config.ssh_domains` (lines 59-71). Runs once due to `M._domains_registered` guard.
3. Calls `setup_project_picker(opts)` -- registers the `lace.project-picker` event handler (lines 151-194). Runs once due to `M._registered_events` guard.
4. Calls `setup_keybindings(config, opts, picker_event)` -- adds the Ctrl+Shift+P key binding (lines 229-233).
5. Calls `setup_status_bar()` -- registers the workspace status bar handler (lines 207-210).

**Critical timing note:** The event handler registered in step 3 is a closure. It captures `opts` from its enclosing scope. After this proposal, it will also need to capture `config` (or `config.ssh_domains`). The closure executes **later**, when the user presses Ctrl+Shift+P. At that point:
- `discover_projects()` runs synchronously, querying Docker.
- The `InputSelector` shows the discovered projects.
- When the user selects a project, the `action_callback` runs, which is where the domain username override happens.

### Current Config Loading Issue

**Note for the implementing agent:** The deployed `~/.config/wezterm/wezterm.lua` currently loads the plugin from a **stale path** (`/home/mjr/code/weft/lace/config/wezterm/lace-plugin`). The plugin was migrated to the separate `lace.wezterm` repo but the config was not updated. The plugin is currently **not loading** -- WezTerm logs show:

```
Failed to load lace plugin: failed to resolve path '/home/mjr/code/weft/lace/config/wezterm/lace-plugin': No such file or directory
```

Before testing any plugin changes, the implementing agent must either:
1. Update `get_lace_plugin_path()` in `~/.config/wezterm/wezterm.lua` to point to the new repo path (`file:///home/mjr/code/weft/lace.wezterm`), OR
2. Use the `_old_config_reference/wezterm/wezterm.lua` in the `lace.wezterm` repo as a test harness (it already uses `file:///home/mjr/code/weft/lace.wezterm`).

This is a prerequisite for any manual testing. The config path fix is **not part of this proposal** -- it is a separate concern (the deployed config is managed by chezmoi in the dotfiles repo). But it must be addressed locally for testing.

Additionally, the deployed `wezterm.lua` calls API methods (`connect_action`, `get_picker_event("lace")`) from an older plugin version that do not exist in the current `lace.wezterm/plugin/init.lua`. The implementing agent should use the `_old_config_reference/wezterm/wezterm.lua` file or write a minimal test config that calls `apply_to_config` with just an `ssh_key` option -- this is the only API the current plugin exposes.

### Current Testing Environment

The lace devcontainer (`silly_beaver`) is running on port **2222**, which is **outside** the lace port range (22425-22499). This means `discover_projects()` will **not** find it -- the port matching logic at line 105 (`for port_str in ports:gmatch("(%d+)%->2222/tcp")`) only captures the host port and checks if it falls within `PORT_MIN`-`PORT_MAX`.

To test the picker with real containers, the implementing agent must either:
1. **Rebuild the lace devcontainer** with a port in the 22425-22499 range (requires updating `.devcontainer/devcontainer.json` to use a lace-range port for SSH), OR
2. **Start a second test container** with a lace-range port mapping (e.g., `docker run -d -p 22425:2222 ...`), OR
3. **Temporarily lower `M.PORT_MIN`** in `init.lua` for testing (e.g., set to `2222` to capture the legacy port). **Remember to revert before committing.**

Option 3 is the fastest for initial development. Option 1 is needed for production validation but is a separate migration step.

### Code Path: User Picks a Project to SSH Connection

Here is the exact call chain from "user presses Ctrl+Shift+P" to "SSH connection opens":

1. **Key press Ctrl+Shift+P** -- WezTerm matches the keybinding (registered at `init.lua` line 230) and emits `lace.project-picker`.
2. **Event handler** (`init.lua` line 151) -- The `wezterm.on("lace.project-picker", ...)` callback fires.
3. **`discover_projects()`** (`init.lua` line 81) -- Calls `docker ps` and `docker inspect` to build the project table. Each project has `{ port, name, path, user, container_id }`.
4. **Build choices** (`init.lua` lines 155-159) -- Creates the `InputSelector` choice list from discovered projects.
5. **Show selector** (`init.lua` line 170) -- `window:perform_action(act.InputSelector({...}))` shows the picker UI.
6. **User selects a project** -- The `action_callback` at line 174 fires with the selected project's `id`.
7. **[NEW] Domain username override** -- The new code iterates `config.ssh_domains`, finds the `lace:<PORT>` entry, and sets `domain.username = project.user`.
8. **`SwitchToWorkspace`** (`init.lua` lines 181-189) -- Creates or switches to a workspace named after the project. The `spawn.domain` references the (now-updated) SSH domain.
9. **WezTerm SSH connection** -- WezTerm reads the SSH domain definition, uses the `username`, `remote_address`, `ssh_option.identityfile`, and `multiplexing` settings to establish the connection.

### Reference: Line Numbers in init.lua (as of current HEAD)

| Line(s) | Function/Code | Relevance |
|---------|---------------|-----------|
| 25 | `local M = {}` | Module table |
| 28-30 | `M.PORT_MIN`, `M.PORT_MAX` | Port range constants (22425-22499) |
| 33-40 | `M.defaults` | Default options including `username = "node"` |
| 52-75 | `setup_port_domains(config, opts)` | Registers 75 SSH domains. **Not modified.** |
| 59-71 | `for port = M.PORT_MIN, M.PORT_MAX` loop | Creates each `lace:PORT` domain entry with `username = opts.username`. |
| 81-138 | `discover_projects()` | Docker discovery. **Not modified.** Already returns `user` per project. |
| 114-124 | User extraction in `discover_projects()` | `docker inspect` for `Config.User`, falls back to `M.defaults.username`. |
| 143-198 | `setup_project_picker(opts)` | **Primary modification target.** Signature changes to `(config, opts)`. |
| 147-149 | Event registration guard | Prevents duplicate handlers. May need temporary bypass during dev. |
| 151 | `wezterm.on(event_name, function(window, pane)` | Picker event handler registration. |
| 152 | `local projects = discover_projects()` | Discovery runs when picker opens. |
| 174-189 | `action_callback` closure | **Where the domain override is inserted** (before `SwitchToWorkspace`). |
| 181-189 | `SwitchToWorkspace` action | Connects to the SSH domain. No changes to this block. |
| 246-275 | `M.apply_to_config(config, opts)` | Entry point. **Call site for `setup_project_picker` changes** (line 266). |
| 266 | `local picker_event = setup_project_picker(opts)` | **Changes to** `setup_project_picker(config, opts)`. |
