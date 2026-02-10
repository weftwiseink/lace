---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:30:00-08:00
task_list: lace/wezterm-plugin
type: proposal
state: live
status: implementation_accepted
tags: [wezterm, cli, devcontainer, nushell, bash, discovery, developer-experience]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T14:00:00-08:00
  round: 3
revision_notes:
  R2: |
    Fixed chezmoi path from dot_local/private_bin/wez-into to dot_local/bin/executable_wez-into (private_ sets directory perms, not file execute bit).
    Added export keyword to all public nushell def commands for use module loading.
    Changed devcontainer up to show stderr instead of suppressing all output.
    Noted nushell behavioral divergence (blocking child process, no exec) in Decision 6.
    Resolved Open Questions 1 and 3.
    Added permission verification to test plan.
  R3: |
    Scope change: script now lives in lace repo (bin/wez-into) rather than dotfiles. Updated Decision 2, Phases 1-2, File Locations, and Architecture diagram.
    Added Implementation Status section documenting Phase 1 partial completion and known issues from initial testing.
    Added --dry-run flag to command interface (implemented but not in original proposal).
    Removed chezmoi packaging and run_once symlink steps (no longer needed).
    Added Testing Methodology, Troubleshooting Checklist, and Review Requirements sections.
    Updated nushell module location from dotfiles to lace repo.
supersedes:
  - cdocs/proposals/2026-02-04-wezterm-project-picker.md  # CLI portion only; picker UI remains
related_to:
  - cdocs/reports/2026-02-08-wez-into-cli-command-status.md
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
  - cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
  - cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
---

# `wez-into`: Universal CLI for WezTerm Devcontainer Connection

> BLUF: Add a `wez-into` command that lets the user type `wez-into lace` or `wez-into dotfiles` from any terminal to open a WezTerm window connected to that project's devcontainer. The command delegates to `lace-discover` for Docker-based container discovery and `wezterm connect lace:PORT` for the connection. It provides an interactive picker when invoked without arguments, supports `--start` for launching stopped containers, and ships as both a bash script (primary) and a nushell custom command with tab completions. This supersedes the `wez-lace-into` script in the lace repo, which serves the same purpose but is not on PATH and is coupled to the lace project namespace. The key prerequisite is migrating the lace devcontainer from port 2222 to port 22425 (tracked separately).
>
> NOTE (R3): The script now lives in the lace repo at `bin/wez-into` rather than in dotfiles deployed via chezmoi. The dotfiles nushell `env.nu` adds `lace/bin` to PATH directly. This is intentional -- `wez-into` will eventually grow into a larger tool within the lace project itself. Chezmoi packaging has been removed from scope.

## Objective

Provide a single, short, memorable command that works from any terminal to connect WezTerm to a lace-managed devcontainer. The user's mental model is: "type `wez-into lace` to get into the lace devcontainer." This command should be:

1. **Accessible from any terminal** -- on PATH, not buried inside a project repo
2. **Short and memorable** -- `wez-into`, not `wez-lace-into` or `bin/open-lace-workspace`
3. **Multi-project** -- discovers and connects to any devcontainer in the lace port range
4. **Shell-native** -- proper nushell command with completions, plus a bash fallback

## Implementation Status

> NOTE (R3): This section documents the current state of implementation against this proposal.

**Completed (Phase 1 partial):**

- Bash script implemented at `lace/bin/wez-into` (224 lines)
- Core connect, interactive picker (fzf + bash select fallback), `--list`, `--status`, `--dry-run`, `--help`
- Auto-connect when only one project is running
- `lace-discover` fallback path resolution: co-located (same directory as `wez-into`), then known absolute paths
- `--dry-run` flag for validation (not in original proposal, added during implementation)
- Formatted table output for `--status` (header row with column alignment)
- `do_connect()` helper that centralizes connect vs dry-run logic

**Changed from original plan:**

- Script lives in the **lace repo** (`bin/wez-into`) rather than dotfiles (`dot_local/bin/executable_wez-into`). This is intentional -- `wez-into` will eventually grow into a larger tool within the lace project itself.
- No chezmoi packaging -- the dotfiles nushell `env.nu` adds `/var/home/mjr/code/weft/lace/bin` to PATH directly (temporary for testing).
- `--start` flag was **removed** from Phase 1 scope (deferred to Phase 3 as originally planned). The implementation rejects `--start` as an unknown option.
- `--dry-run` flag was **added** (not in original proposal) for command validation without execution.

**Not yet implemented:**

- Phase 2: Nushell module (still planned, now in lace repo scope)
- Phase 3: `--start` support
- Phase 4-5: Deprecation of old scripts

**Known issues from initial testing:**

- Discovery returns nothing when no containers have port mappings in the 22425-22499 range
- The dotfiles container is running but has no visible port mapping (has not been migrated to the lace port range)
- `--start` is not implemented, so there is no recovery when containers are down or outside the port range
- Error messages could be more helpful (e.g., suggest checking `docker ps` and `lace-discover` independently, suggest specific next steps)

## Background

### Evolution of CLI Connection Tooling

The [status report](../reports/2026-02-08-wez-into-cli-command-status.md) documents two generations of connection tooling:

**Generation 1 (per-project launchers):** `bin/open-lace-workspace` and `bin/open-dotfiles-workspace` -- 374-379 line scripts that handle the full lifecycle (devcontainer up, SSH polling, mux-server checks, known_hosts, wezterm connect). Each is hardcoded to one project.

**Generation 2 (generic discovery):** `bin/wez-lace-into` backed by `bin/lace-discover` and the lace.wezterm plugin -- generic multi-project tools that discover running containers via Docker and connect via port-range SSH domains. The plugin provides a WezTerm-native picker (Ctrl+Shift+P); `wez-lace-into` provides a CLI equivalent.

### Why `wez-lace-into` Is Not Enough

`wez-lace-into` does the right thing architecturally but has three practical problems:

1. **Not on PATH.** It lives at `/var/home/mjr/code/weft/lace/bin/wez-lace-into`. The user must either be in the lace repo or know the full path.
2. **Name couples to "lace."** The tool is generic (any devcontainer in the port range), but the name implies it is lace-specific.
3. **No container startup.** If the container is not running, `wez-lace-into` fails. The Gen 1 launchers handled this with built-in `devcontainer up`.

### Existing Infrastructure

The following components are already implemented and working:

- **`lace-discover`** (`/var/home/mjr/code/weft/lace/bin/lace-discover`): Queries Docker for devcontainers in port range 22425-22499. Outputs `name:port:user:path` or JSON.
- **lace.wezterm plugin** (`/home/mjr/code/weft/lace.wezterm/plugin/init.lua`): Pre-registers 75 SSH domains, provides project picker, handles username override via docker inspect.
- **`wez-lace-into`** (`/var/home/mjr/code/weft/lace/bin/wez-lace-into`): The predecessor this proposal supersedes.
- **Nushell config** (`dotfiles/dot_config/nushell/`): The user's primary shell. `~/.local/bin` is already on PATH via `env.nu`.
- **Chezmoi** (`/home/mjr/code/personal/dotfiles/`): Manages dotfile deployment. Files at `dot_local/bin/` deploy to `~/.local/bin/`.

### Prerequisite: Lace Port Migration

The lace devcontainer currently uses port 2222, which is outside the discovery range (22425-22499). Before `wez-into` can replace `open-lace-workspace`, lace must migrate to port 22425. This is tracked separately (referenced in the [launcher elimination proposal](2026-02-05-dotfiles-eliminate-workspace-launcher.md), Phase 4). This proposal assumes the migration will happen but does not depend on it -- `wez-into` works for any project already in the port range (e.g., dotfiles on 22426).

## Proposed Solution

### Architecture

```
User types:  wez-into lace
                |
                v
    lace/bin/wez-into (bash)
    or nushell custom command
                |
                v
    lace-discover (Docker query)
        |
        v
    name:port:user:path
        |
        v
    wezterm connect lace:PORT --workspace NAME
```

> NOTE (R3): The script lives at `lace/bin/wez-into` (on PATH via nushell `env.nu`) rather than `~/.local/bin/wez-into` deployed via chezmoi.

The command is a thin orchestration layer. Discovery is delegated to `lace-discover`. Connection is delegated to `wezterm connect`. The command's job is:

1. Find `lace-discover` (on PATH or at a known location)
2. Parse the discovery output to find the requested project
3. Invoke `wezterm connect lace:PORT --workspace PROJECT`
4. Optionally start a stopped container with `devcontainer up`

### Command Interface

```
wez-into                    # Interactive picker (fzf or select)
wez-into <project>          # Connect to specific project
wez-into <project> --start  # Start container if not running, then connect
wez-into --list             # List running project names
wez-into --status           # Show projects with ports and status
wez-into --dry-run <project> # Print wezterm connect command without executing
wez-into --help             # Show help
```

> NOTE (R3): `--dry-run` was added during implementation for command validation and debugging. It prints the `wezterm connect` command that would be executed without running it.

### File Locations

| File | Repo | On PATH via | Purpose |
|------|------|-------------|---------|
| `bin/wez-into` | lace | nushell `env.nu` adds `lace/bin` to PATH | Bash implementation |
| `bin/wez-into.nu` | lace | co-located with bash script | Nushell custom command (Phase 2) |
| `bin/lace-discover` | lace | co-located with `wez-into` | Discovery script |

> NOTE (R3): Both scripts now live in the lace repo, co-located. The dotfiles nushell `env.nu` adds `/var/home/mjr/code/weft/lace/bin` to PATH. No chezmoi deployment or symlinks needed.

### Bash Implementation

The bash script is the primary implementation. It lives at `lace/bin/wez-into` and is on PATH via nushell `env.nu`. It works in any POSIX-compatible shell.

> NOTE (R3): Originally specified as `dot_local/bin/executable_wez-into` deployed via chezmoi. Now lives directly in the lace repo at `bin/wez-into`. The source of truth is the actual file; the structural overview below is illustrative.

**Source of truth:** `bin/wez-into` (224 lines)

**Key structural elements:**

```bash
# --- Locate lace-discover ---
# Checks: (1) PATH, (2) co-located via BASH_SOURCE dirname, (3) known absolute paths
for candidate in \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lace-discover" \
  "$HOME/code/weft/lace/bin/lace-discover" \
  "/var/home/$(whoami)/code/weft/lace/bin/lace-discover"; do
  ...
done

# --- do_connect() helper ---
# Centralizes connect vs dry-run logic.
# Defers wezterm prerequisite check to connection time (not startup).
do_connect() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "wezterm connect lace:$port --workspace $project"
    exit 0
  fi
  exec wezterm connect "lace:$port" --workspace "$project"
}

# --- Argument parsing ---
# Supports: --list, --status, --dry-run, --help, positional PROJECT
# Rejects --start as unknown (Phase 3)

# --- Action dispatch ---
# --list: discover | cut -d: -f1
# --status: formatted table with header (PROJECT, PORT, USER, PATH columns)
# --help: detailed usage with examples

# --- Connect to specific project ---
# Inline discovery lookup, error with list of running projects if not found

# --- Interactive picker ---
# Auto-connect for single project
# fzf with formatted output if available, bash select fallback otherwise
```

### Nushell Implementation

The nushell version is a custom command module that will live at `lace/bin/wez-into.nu` (Phase 2). It is loaded via `use` in `config.nu`. All public commands use `export def` for proper module export semantics. The non-exported `resolve-workspace-path` helper is only accessible within the module. It provides structured output and tab completion.

> NOTE (R3): The nushell code below is illustrative of the target design. It includes Phase 3 features (`--start`, `resolve-workspace-path`) that will not be implemented until Phase 3. The Phase 2 implementation should omit these.

```nu
# wez-into.nu -- Connect to a lace devcontainer via WezTerm.
# Load in config.nu: use /path/to/lace/bin/wez-into.nu *

# Discover running lace devcontainers
export def "wez-into discover" []: nothing -> table {
  let lace_discover = (which lace-discover | get 0?.path? | default "")
  if ($lace_discover | is-empty) {
    error make { msg: "lace-discover not found on PATH" }
  }

  ^$lace_discover --json | from json
}

# List running project names
export def "wez-into list" []: nothing -> list<string> {
  wez-into discover | get name
}

# Show running projects with status
export def "wez-into status" []: nothing -> table {
  wez-into discover | select name port user path
}

# Connect to a lace devcontainer via WezTerm
export def "wez-into" [
  project?: string  # Project name (omit for interactive picker)
  --start (-s)      # Start container if not running
  --list (-l)       # List running project names
  --status          # Show running projects with status
]: nothing -> nothing {
  if $list {
    wez-into list | each { print $in }
    return
  }
  if $status {
    wez-into status | print
    return
  }

  let projects = (wez-into discover)

  let target = if ($project | is-not-empty) {
    let found = ($projects | where name == $project)
    if ($found | is-empty) {
      if $start {
        # Try to start the container
        let ws_path = (resolve-workspace-path $project)
        if ($ws_path | is-not-empty) {
          print $"(ansi yellow)Starting container for ($project)...(ansi reset)"
          ^devcontainer up --workspace-folder $ws_path out> /dev/null
          sleep 2sec
          let refreshed = (wez-into discover)
          let found2 = ($refreshed | where name == $project)
          if ($found2 | is-empty) {
            error make { msg: $"Container for '($project)' still not found after starting" }
          }
          $found2 | first
        } else {
          error make { msg: $"Project '($project)' not found. Add to ~/.config/lace/projects.conf" }
        }
      } else {
        let names = ($projects | get name | str join ", ")
        error make { msg: $"Project '($project)' not found. Running: ($names). Use --start to start a stopped container." }
      }
    } else {
      $found | first
    }
  } else if ($projects | length) == 0 {
    error make { msg: "No running devcontainers found" }
  } else if ($projects | length) == 1 {
    $projects | first
  } else {
    # Interactive picker using input list
    let choice = ($projects
      | each {|p| $"($p.name) (:($p.port)) - ($p.path)" }
      | input list "wez-into>")
    if ($choice | is-empty) { return }
    let name = ($choice | split row " " | first)
    $projects | where name == $name | first
  }

  print $"Connecting to ($target.name) on port ($target.port)..."
  ^wezterm connect $"lace:($target.port)" --workspace $target.name
}

# Helper: resolve workspace path for a stopped project
def resolve-workspace-path [project: string]: nothing -> string {
  let conf_path = ($env.XDG_CONFIG_HOME?
    | default ($env.HOME | path join ".config")
    | path join "lace/projects.conf")

  # Check projects.conf
  if ($conf_path | path exists) {
    let lines = (open $conf_path | lines | where { $in | str starts-with $"($project)=" })
    if ($lines | is-not-empty) {
      return ($lines | first | split row "=" | skip 1 | str join "="
        | str replace "~" $env.HOME)
    }
  }

  # Check Docker stopped containers
  let folders = (^docker ps -a
    --filter "label=devcontainer.local_folder"
    --format '{{.Label "devcontainer.local_folder"}}'
    | lines
    | where { ($in | path basename) == $project })

  if ($folders | is-not-empty) {
    return ($folders | first)
  }

  ""
}
```

### Projects Configuration File

For `--start` to work with projects that have no running or stopped containers, the user can create a simple mapping file:

```
# ~/.config/lace/projects.conf
# Format: project_name=/absolute/path/to/workspace
lace=/home/mjr/code/weft/lace
dotfiles=/home/mjr/code/personal/dotfiles
```

This file is optional. Discovery from Docker (both running and stopped containers) works without it. The file is only needed when:
- The container has never been started on this machine, OR
- Docker is not available

### `lace-discover` Availability

`lace-discover` lives in the lace repo at `bin/lace-discover`, co-located with `wez-into`. Since both scripts are in the same directory and `lace/bin` is on PATH, no symlinks or copies are needed.

> NOTE (R3): The original proposal discussed symlinks, chezmoi scripts, and copies to get `lace-discover` on PATH. With both scripts co-located in `lace/bin` and that directory on PATH, this complexity is eliminated. The `wez-into` script also resolves `lace-discover` via `$(dirname "${BASH_SOURCE[0]}")/lace-discover` as a co-location fallback.

## Important Design Decisions

### Decision 1: `wez-into` as the command name

**Decision:** Name the command `wez-into` rather than `wez-lace-into`, `lace connect`, or `lace wez`.

**Why:** The user's own recollection was "wez-into-something," indicating the `wez-` prefix has strong mnemonic value. `wez-into` is 8 characters (short enough to type quickly), preserves the WezTerm association, and does not couple the command name to the lace project. The command is generic -- it connects to any devcontainer in the port range, regardless of whether the project uses lace's other features. `lace connect` would be a reasonable alternative if the lace CLI absorbs this functionality in the future, but for now a standalone script deployed via dotfiles is simpler than extending the lace npm package.

### Decision 2: Lives in the lace repo

**Decision:** `wez-into` lives at `lace/bin/wez-into`, on PATH via nushell `env.nu` adding `lace/bin` to PATH.

**Why:** `wez-into` is tightly coupled to lace infrastructure (`lace-discover`, the lace.wezterm plugin, the lace port range). Co-locating it with `lace-discover` in the lace repo eliminates the symlink/copy complexity for `lace-discover` availability and keeps related tooling together. The dotfiles nushell `env.nu` adds `/var/home/mjr/code/weft/lace/bin` to PATH, which is sufficient for the single-machine use case. If `wez-into` needs to work on machines without the lace repo cloned, it can be moved to dotfiles later.

> NOTE (R3): This reverses the original Decision 2, which placed `wez-into` in dotfiles deployed via chezmoi. The rationale changed because: (a) co-location with `lace-discover` is simpler than managing symlinks, (b) `wez-into` will likely grow into a larger lace CLI tool, and (c) the single-machine use case does not need chezmoi deployment.

### Decision 3: Bash primary, nushell companion

**Decision:** Provide both a bash script at `lace/bin/wez-into` and a nushell custom command module at `lace/bin/wez-into.nu`.

**Why:** Nushell is the primary shell, but `lace/bin/wez-into` must be a bash script because: (a) `lace/bin` is on PATH for all shells via nushell `env.nu`, and commands there should work from any shell (bash session, non-nushell terminal, other scripts), (b) nushell scripts cannot be directly invoked as shebang scripts in all contexts, and (c) the bash version serves as a fallback when nushell is not available. The nushell module provides a shell-native experience with structured output, tab completion, and `input list` for the picker. Users in nushell get the better experience; users in bash get the same functionality.

> NOTE (R3): Updated paths from `~/.local/bin` and `~/.config/nushell/scripts/` to `lace/bin/` to match the new repo location.

### Decision 4: Delegates to lace-discover rather than reimplementing discovery

**Decision:** `wez-into` calls `lace-discover` as an external process rather than embedding Docker query logic.

**Why:** `lace-discover` already handles Docker API details (label filtering, port-range matching, user lookup). Duplicating this logic in `wez-into` would create two implementations to maintain. The `--json` flag on `lace-discover` provides structured output that both bash (via jq or line parsing) and nushell (via `from json`) can consume. If discovery logic evolves (e.g., new Docker label, different port range), it changes in one place.

### Decision 5: Optional `--start` with projects.conf fallback

**Decision:** Support starting stopped containers via `--start`, with workspace paths resolved from (1) `~/.config/lace/projects.conf`, (2) Docker stopped-container labels, or (3) failure with a helpful message.

**Why:** The Gen 1 launchers' biggest convenience was handling cold start. Removing that entirely (as the launcher elimination proposal acknowledged) is a deliberate tradeoff, but offering `--start` as an opt-in restores it for users who want it. The resolution order (projects.conf, Docker labels, error) handles the common cases: projects.conf covers known projects on fresh machines without Docker history; Docker labels cover projects that were previously started; the error message tells the user how to fix it.

### Decision 6: `exec wezterm connect` (foreground, replacing the shell process)

**Decision:** Use `exec wezterm connect` rather than backgrounding the process.

**Why:** `wez-lace-into` already uses `exec`, which replaces the shell process with the wezterm connect process. This is the right behavior for a CLI command: the user typed a command, the result is a WezTerm window, and the originating terminal is consumed. This differs from `open-lace-workspace`, which backgrounds wezterm connect and returns to the shell. The `exec` approach is simpler, avoids orphan process management, and matches user expectations (the command "becomes" the connection).

**Nushell divergence:** The nushell version uses `^wezterm connect ...` which runs wezterm as a blocking child process rather than replacing the shell via `exec`. Nushell does not have a built-in `exec` equivalent. The practical effect is the same -- the nushell session blocks until `wezterm connect` exits -- but the nushell process remains as a parent. This is acceptable and does not need to be fixed.

## Stories

### Developer opens a project from a nushell prompt

Developer has nushell open. Types `wez-into lace`. The nushell custom command calls `lace-discover`, finds the lace container on port 22425, and runs `wezterm connect lace:22425 --workspace lace`. A new WezTerm window opens connected to the devcontainer. The nushell session blocks until wezterm connect exits (nushell runs it as a child process, not via `exec`).

### Developer picks from multiple projects

Developer types `wez-into` with no arguments. Three projects are running: lace (22425), dotfiles (22426), myapp (22427). Nushell shows `input list` with the three options. Developer selects dotfiles. WezTerm window opens.

### Developer starts a stopped project

Developer types `wez-into dotfiles --start`. No dotfiles container is running. `wez-into` checks `projects.conf`, finds `dotfiles=/home/mjr/code/personal/dotfiles`, runs `devcontainer up --workspace-folder /home/mjr/code/personal/dotfiles`, waits briefly, re-discovers, and connects.

### Developer on a fresh machine

Developer clones dotfiles and the lace repo, applies nushell config (which adds `lace/bin` to PATH). `wez-into` and `lace-discover` are both available immediately without symlinks or chezmoi deployment. Developer starts a devcontainer, types `wez-into` -- it works.

> NOTE (R3): Original story assumed chezmoi deployment. With the lace repo location, the setup is: clone lace repo, ensure `lace/bin` is on PATH.

## Edge Cases / Challenging Scenarios

### `lace-discover` not on PATH

**Trigger:** `lace-discover` not on PATH (e.g., `lace/bin` not in PATH, or running `wez-into` from an unexpected location).

**Behavior:** `wez-into` checks co-located path first (`$(dirname "${BASH_SOURCE[0]}")/lace-discover`), then known absolute paths (`~/code/weft/lace/bin/lace-discover`, `/var/home/$(whoami)/code/weft/lace/bin/lace-discover`) before failing. If none found, prints an error with instructions.

**Mitigation:** Since `wez-into` and `lace-discover` are co-located in `lace/bin`, the co-location fallback should always work as long as `wez-into` itself is found.

### No running containers

**Trigger:** User runs `wez-into lace` but no containers are running.

**Behavior:** Prints "project 'lace' not found in running containers" with a list of running projects (which is empty) and a hint to use `--start`.

### Port 2222 (pre-migration lace)

**Trigger:** Lace is still on port 2222, not yet migrated to 22425.

**Behavior:** `lace-discover` does not find lace (port 2222 is outside 22425-22499). `wez-into lace` fails with "project not found." The user must use `open-lace-workspace` until the migration is complete.

**Mitigation:** This is a known prerequisite. The proposal explicitly states that `wez-into` for lace requires the port migration.

### Project name ambiguity

**Trigger:** Two containers have the same basename (e.g., `~/code/work/app` and `~/code/personal/app`).

**Behavior:** `lace-discover` uses `basename` of the `devcontainer.local_folder` label. If two containers have the same basename, only the first one found by Docker is returned. This is a pre-existing limitation in `lace-discover`.

**Mitigation:** Document that project names (derived from directory basenames) must be unique across all lace-managed projects. If this becomes a problem, `lace-discover` could be enhanced to use the full path or a configurable display name.

### `devcontainer up` fails during --start

**Trigger:** User runs `wez-into myproject --start`, but devcontainer up fails (Docker not running, build error, etc.).

**Behavior:** `wez-into` captures the failure and prints "devcontainer up failed for /path/to/workspace." The user sees the error and can debug manually.

### wezterm not installed

**Trigger:** User runs `wez-into` on a machine without WezTerm.

**Behavior:** Fails immediately with "wezterm not found on PATH." This is the correct behavior -- the command is meaningless without WezTerm.

### Nushell `use` vs bash PATH dispatch

**Trigger:** User types `wez-into` in nushell. Both the nushell custom command and the `lace/bin/wez-into` bash script are available.

**Behavior:** If the nushell module is `use`d in config.nu, the nushell custom command takes precedence over the external command on PATH. This is the desired behavior -- nushell users get the native experience. If the module is not loaded, nushell falls through to the bash script on PATH, which also works.

## Test Plan

### Prerequisites

- Docker running with at least one devcontainer in the 22425-22499 port range
- WezTerm installed
- `lace-discover` accessible (on PATH or at known location)

### Bash Script Tests

| # | Scenario | Command | Expected |
|---|----------|---------|----------|
| 1 | Direct connect | `wez-into <project>` | WezTerm window opens, connected to project |
| 2 | Project not found | `wez-into nonexistent` | Error with list of running projects |
| 3 | List mode | `wez-into --list` | Prints project names, one per line |
| 4 | Status mode | `wez-into --status` | Formatted table: PROJECT, PORT, USER, PATH columns |
| 5 | Interactive picker (fzf) | `wez-into` (multiple projects) | fzf picker appears; selection connects |
| 6 | Interactive picker (no fzf) | `wez-into` (fzf not installed) | Bash `select` menu appears |
| 7 | Single project auto-connect | `wez-into` (one project) | Connects without picker |
| 8 | --start with running container (Phase 3) | `wez-into <project> --start` | Connects normally (--start is no-op) |
| 9 | --start with stopped container (Phase 3) | `wez-into <project> --start` | Starts container, then connects |
| 10 | lace-discover not found | Remove from PATH | Error with instructions |
| 11 | Help | `wez-into --help` | Prints usage |
| 12 | Dry run | `wez-into --dry-run <project>` | Prints `wezterm connect lace:PORT --workspace PROJECT` without executing |
| 13 | No containers running | `wez-into` | Error: "no running devcontainers found" with `devcontainer up` hint |

### Nushell Command Tests

| # | Scenario | Command | Expected |
|---|----------|---------|----------|
| 1 | Direct connect | `wez-into lace` | WezTerm window opens |
| 2 | Structured list | `wez-into list` | Returns list of strings |
| 3 | Structured status | `wez-into status` | Returns table with name, port, user, path columns |
| 4 | Tab completion | `wez-into <TAB>` | Shows available subcommands and flags |
| 5 | Error on not found | `wez-into nonexistent` | Nushell error with message |

### Integration Tests

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Bash and nushell produce same connection | Both open WezTerm to same project |
| 2 | Permission verification | `ls -la lace/bin/wez-into` shows execute permission (e.g., `-rwxr-xr-x`) |
| 3 | Nushell module loads | `use bin/wez-into.nu *` succeeds without errors |
| 4 | PATH verification | `which wez-into` resolves to `lace/bin/wez-into` |
| 5 | Discovery consistency | `lace-discover` output format matches `wez-into`'s parsing (colon-delimited `name:port:user:path`) |

### Testing Methodology

> NOTE (R3): Added based on initial testing experience. These steps should be followed before declaring any phase complete.

1. **Verify discovery independently first.** Run `lace-discover` by itself before testing `wez-into`. If `lace-discover` returns nothing, `wez-into` cannot work -- debug the discovery layer first.
2. **Use `--dry-run` before actual connect.** Run `wez-into --dry-run <project>` to verify the `wezterm connect` command is constructed correctly before executing it.
3. **Test all code paths systematically:**
   - No containers running (empty discovery)
   - One container running (auto-connect path)
   - Multiple containers running (picker path)
   - Unknown project name (error path)
4. **Test picker UX both ways:** With `fzf` installed (nice picker) and with fzf temporarily removed from PATH (bash `select` fallback).
5. **Test `--list` and `--status` output formatting.** Verify column alignment and that output matches `lace-discover`'s colon-delimited format.
6. **Validate discovery output format.** Run `lace-discover` and confirm output is `name:port:user:path` per line. Run `lace-discover --json` and confirm valid JSON. Verify `wez-into`'s `IFS=:` parsing handles all fields correctly (especially paths containing spaces, if any).

### Troubleshooting Checklist

> NOTE (R3): Added based on known issues encountered during initial testing.

**If `wez-into` finds nothing:**

1. Run `docker ps` to check if containers are actually running
2. Check if running containers have port mappings in the 22425-22499 range (e.g., `docker ps --format '{{.Ports}}'`)
3. Run `lace-discover` directly to see if it finds anything
4. If containers are running but `lace-discover` finds nothing: the container's SSH port is probably outside the 22425-22499 range (e.g., the lace container on port 2222)

**If `wez-into` finds the project but connect fails:**

1. Try `wezterm connect lace:<port>` directly to isolate whether the issue is in `wez-into` or in `wezterm connect`
2. Verify the lace.wezterm plugin is loaded: check `~/.config/wezterm/wezterm.lua` for the `require` line
3. Check SSH key: `ssh -p <port> user@localhost` should connect without password prompt
4. Check that the wezterm-mux-server is running inside the container

**If picker does not show:**

1. Check if `fzf` is installed (`which fzf`). If not, the bash `select` fallback should appear instead.
2. If neither picker works, check that `discover` returned more than one project (single-project auto-connects without a picker)

### Review Requirements for Implementation Agents

> NOTE (R3): Added to ensure consistent quality across implementation phases.

- Every implementation agent MUST use `/review` subagent iteration before declaring work complete
- Every implementation agent MUST write a `/devlog` documenting what was done
- Changes must be validated against this proposal's acceptance criteria before reporting completion
- Test plan steps must be explicitly run and results documented in the devlog
- Known issues and deviations from the proposal must be documented

## Implementation Phases

### Phase 1: Bash Script in Lace Repo

**Scope:**
- Create `lace/bin/wez-into` (bash script, chmod +x)
- Implement all subcommands: direct connect, picker, --list, --status, --dry-run, --help
- Do NOT implement --start yet (Phase 3)
- Ensure `lace/bin` is on PATH via nushell `env.nu`

**Files created (in lace repo):**
- `bin/wez-into`

**Files modified (in dotfiles repo):**
- `dot_config/nushell/env.nu` (add `lace/bin` to PATH)

**Constraints:**
- Must work without nushell (bash script)
- Must find `lace-discover` via co-location fallback if not on PATH
- Must not require chezmoi or symlinks

**Success criteria:**
- `wez-into --list` shows running projects from any terminal where `lace/bin` is on PATH
- `wez-into <project>` opens a WezTerm window
- `wez-into --dry-run <project>` prints the connect command without executing
- `wez-into --status` shows formatted table output

> NOTE (R3): Original Phase 1 created files in the dotfiles repo with chezmoi deployment. Updated to reflect the lace repo location. The chezmoi `run_once` symlink script is no longer needed since both scripts are co-located.

### Phase 2: Nushell Module

**Scope:**
- Create `lace/bin/wez-into.nu` (co-located with the bash script)
- Add `use` to nushell config to load the module (note: `use`, not `source` -- this is a module with `export def` commands, not a plain script)
- Implement all subcommands with structured output using `export def`
- Tab completion via nushell's custom command system
- The `resolve-workspace-path` helper remains non-exported (bare `def`) as an internal module function

**Files created (in lace repo):**
- `bin/wez-into.nu`

**Files modified (in dotfiles repo):**
- `dot_config/nushell/config.nu` (add `use` line -- distinct from existing `source` lines for other scripts)

**Dependencies:** Phase 1 (bash fallback must exist first)

**Success criteria:**
- `wez-into status` returns a nushell table in nushell
- `wez-into <TAB>` shows completions
- `wez-into` picker uses `input list` in nushell

> NOTE (R3): Original Phase 2 created the nushell module in the dotfiles repo. Updated to co-locate with the bash script in `lace/bin/`.

### Phase 3: `--start` Support

**Scope:**
- Add `--start` flag to both bash and nushell implementations
- Create `~/.config/lace/projects.conf` with initial entries
- Implement workspace path resolution (projects.conf, Docker labels)
- Implement container startup via `devcontainer up`

**Files modified (in lace repo):**
- `bin/wez-into` (add --start logic)
- `bin/wez-into.nu` (add --start logic)

**Files created:**
- `~/.config/lace/projects.conf` (initial entries, can be managed by chezmoi)

**Dependencies:** Phase 1

**Success criteria:**
- `wez-into dotfiles --start` starts a stopped container and connects
- `wez-into lace --start` starts a stopped container using projects.conf path
- Correct error when workspace path cannot be resolved

### Phase 4: Deprecate `wez-lace-into`

**Scope:**
- After verifying `wez-into` works for all projects, mark `bin/wez-lace-into` in the lace repo as deprecated
- Add a deprecation notice to the script header pointing to `wez-into`
- Schedule removal in a future cleanup pass

**Files modified (in lace repo):**
- `bin/wez-lace-into` (add deprecation notice)

**Dependencies:** Phases 1-3 verified, lace port migration to 22425 complete

**Success criteria:**
- `wez-lace-into` prints a deprecation warning
- `wez-into` handles all use cases that `wez-lace-into` handled

### Phase 5 (Deferred): Retire `open-lace-workspace`

**Scope:**
- After lace migrates to port 22425, `wez-into lace` replaces `open-lace-workspace`
- Follow the same elimination pattern as the dotfiles launcher
- Tracked in the launcher elimination proposal, not here

**Dependencies:** Lace port migration to 22425 (separate effort)

## Open Questions

1. ~~**chezmoi `private_bin` vs `executable_` prefix:**~~ **Resolved (R2).** Use `dot_local/bin/executable_wez-into`. The `executable_` prefix sets file mode 0755. The `private_` prefix is for directory-level permissions (0700) and does not set the execute bit on files. ~~**Superseded (R3):** Script now lives in lace repo, chezmoi deployment no longer applies.~~

2. ~~**`lace-discover` symlink durability:**~~ **Resolved (R3).** No longer relevant. Both `wez-into` and `lace-discover` are co-located in `lace/bin`. No symlinks needed.

3. ~~**Nushell `input list` availability:**~~ **Resolved (R2).** The installed nushell version is 0.110.0. `input list` has been available since nushell 0.86.0. Not a concern.

4. **Multi-machine portability (R3):** With `wez-into` in the lace repo rather than dotfiles, it is only available on machines where the lace repo is cloned. If `wez-into` needs to work on machines without the lace repo, it would need to move back to dotfiles or be packaged differently. For now, the single-machine use case is sufficient.
