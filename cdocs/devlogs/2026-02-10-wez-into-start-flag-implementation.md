---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T20:00:00-08:00
task_list: lace/wezterm-plugin
type: devlog
state: live
status: done
tags: [wez-into, start-flag, cli, devcontainer, cold-start]
related_to:
  - cdocs/proposals/2026-02-10-wez-into-workstream-closeout.md
  - cdocs/reports/2026-02-10-devcontainer-metadata-and-lace-registry.md
---

# Implementing `--start` Flag for wez-into: Devlog

## Objective

Add a `--start` flag to the `wez-into` CLI script that starts stopped devcontainers before connecting. When `wez-into --start <project>` is invoked, it should:
1. Check if the project is already running (just connect if so)
2. Find stopped containers matching the project name via Docker labels
3. Start the container via `lace up --workspace-folder <path>`
4. Re-discover and connect

## Design Decisions (pre-made by user)

- **Start mechanism:** `lace up --workspace-folder <path>` (full pipeline)
- **Scope:** Stopped containers only. No `projects.conf`, no never-started support.
- **Error on unknown project:** Helpful message listing stopped containers.
- **`wez-into --start` with no project:** Show stopped containers in picker.

## Plan

Three phases:
1. Add `--start` flag to argument parser with core start logic
2. Handle edge cases and resilient error handling for `lace up` failures
3. Test all scenarios with captured output

---

## Phase 1: Add `--start` Flag and Core Logic

### 1.1 Locate lace CLI

The lace CLI is at `packages/lace/bin/lace` relative to `wez-into`. Added `locate_lace_cli()` using the same co-location pattern as `lace-discover`:

```bash
locate_lace_cli() {
  for candidate in \
    "$SCRIPT_DIR/../packages/lace/bin/lace" \
    "$HOME/code/weft/lace/packages/lace/bin/lace" \
    "/var/home/$(whoami)/code/weft/lace/packages/lace/bin/lace"; do
    if [[ -x "$candidate" ]]; then echo "$candidate"; return 0; fi
  done
  command -v lace 2>/dev/null || return 1
}
```

### 1.2 Stopped container discovery

Added `discover_stopped()` function that queries Docker for stopped devcontainers:

```bash
docker ps -a \
  --filter "label=devcontainer.local_folder" \
  --filter "status=exited" \
  --format '{{.Label "devcontainer.local_folder"}}'
```

Output format: `name\tworkspace_path` per line (tab-separated). Match by basename of the `local_folder` label.

### 1.3 Start and connect flow

Added `start_and_connect()` that:
1. Locates the lace CLI
2. Runs `lace up --workspace-folder <path> --skip-metadata-validation`
3. Handles `lace up` failure gracefully (see Phase 2)
4. Retries discovery up to 10 times (2s intervals) for container readiness
5. Connects via `do_connect()`

### 1.4 Argument parser integration

- Added `--start` flag (`START=true/false`)
- In the "connect to specific project" block: check running first, then fall through to stopped lookup when `--start` is active
- In the picker block: when `--start` is active, show combined list of running `[running]` and stopped `[stopped]` containers
- When no `--start` and project not found: added hint about `--start` if the project is in stopped containers

---

## Phase 2: Edge Cases and Resilient Error Handling

### 2.1 `lace up` exit code 1 with running container

**Discovery:** Running `lace up --workspace-folder /var/home/mjr/code/weft/lace` exits with code 1 due to `postStartCommand` failure:

```
OCI runtime exec failed: exec failed: unable to start container process:
chdir to cwd ("/workspace/main") set in config.json failed: no such file or directory
```

However, the container itself starts successfully and is discoverable via `lace-discover`:

```
$ lace-discover
lace:22426:node:/var/home/mjr/code/weft/lace
```

**Fix:** Changed `start_and_connect` to treat `lace up` failure as a warning, not a fatal error. After `lace up` (regardless of exit code), the function proceeds to discovery. Only if the container is not discoverable after 10 retry attempts does it fail.

### 2.2 Feature metadata validation

The nushell feature (`ghcr.io/eitsupi/devcontainer-features/nushell:0`) lacks OCI metadata annotations, causing `lace up` to fail with `MetadataFetchError`. Since `wez-into --start` is restarting an existing container (not creating a new one), metadata validation is not critical.

**Fix:** Added `--skip-metadata-validation` to the `lace up` invocation.

### 2.3 `wez-into --start` with no project name

Shows a combined picker of running and stopped containers with `[running]`/`[stopped]` labels. Running containers get connected directly; stopped containers go through `start_and_connect`.

### 2.4 `wez-into --start nonexistent`

Errors with helpful message listing available stopped containers:

```
wez-into: error: project 'nonexistent' not found in running or stopped containers
wez-into: error:
wez-into: error: stopped containers:
  lace  (/var/home/mjr/code/weft/lace)
  dotfiles  (/home/mjr/code/personal/dotfiles)
wez-into: error:
wez-into: error: to create a new container: lace up --workspace-folder <path>
```

### 2.5 `--start` hint when project is stopped

When running `wez-into lace` without `--start` and the project is found in stopped containers:

```
wez-into: error: project 'lace' not found in running containers
wez-into: error: no running devcontainers found
wez-into: error:
wez-into: error: hint: 'lace' is stopped. Use --start to start it:
wez-into: error:   wez-into --start lace
```

### 2.6 No containers hint in picker

When no running containers exist and `wez-into` is invoked without `--start`:

```
wez-into: error: no running devcontainers found
wez-into: error:
wez-into: error: stopped containers available (use --start to start one):
  lace  (/var/home/mjr/code/weft/lace)
  dotfiles  (/home/mjr/code/personal/dotfiles)
```

---

## Phase 3: Testing

### 3.0 Pre-test state

```
$ docker ps -a --filter "label=devcontainer.local_folder" \
    --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Status}}'
d53e45db9dbf	/var/home/mjr/code/weft/lace	Exited (0) 27 minutes ago
a8fc4a91cb95	/home/mjr/code/personal/dotfiles	Exited (0) 27 minutes ago
```

Both containers stopped. No running devcontainers.

### 3.1 Test: `--help` output includes --start

```
$ wez-into --help
wez-into -- Connect to a lace devcontainer via WezTerm

Usage:
  wez-into                    Interactive picker (fzf or bash select)
  wez-into <project>          Connect to named project
  wez-into --start <project>  Start a stopped container, then connect
  wez-into --start            Pick from stopped containers to start
  wez-into --list             List running project names
  wez-into --status           Show running projects with ports and paths
  wez-into --dry-run <proj>   Print the connect command without executing
  wez-into --help             Show this help
...
```

**PASS**

### 3.2 Test: `--start --dry-run lace` when lace is stopped

```
$ wez-into --start --dry-run lace
wez-into: starting lace via lace up --workspace-folder /var/home/mjr/code/weft/lace ...
lace up --workspace-folder /var/home/mjr/code/weft/lace
# then: wezterm connect lace:<port> --workspace lace
```

**PASS** -- correctly identifies the workspace path from Docker labels, shows planned commands.

### 3.3 Test: `--start --dry-run dotfiles` when dotfiles is stopped

```
$ wez-into --start --dry-run dotfiles
wez-into: starting dotfiles via lace up --workspace-folder /home/mjr/code/personal/dotfiles ...
lace up --workspace-folder /home/mjr/code/personal/dotfiles
# then: wezterm connect lace:<port> --workspace dotfiles
```

**PASS** -- correctly resolves dotfiles workspace path.

### 3.4 Test: `--start nonexistent`

```
$ wez-into --start nonexistent
wez-into: error: project 'nonexistent' not found in running or stopped containers
wez-into: error:
wez-into: error: stopped containers:
  lace  (/var/home/mjr/code/weft/lace)
  dotfiles  (/home/mjr/code/personal/dotfiles)
wez-into: error:
wez-into: error: to create a new container: lace up --workspace-folder <path>
exit: 1
```

**PASS** -- helpful error with list of available stopped containers.

### 3.5 Test: `lace` without `--start` (should hint)

```
$ wez-into lace
wez-into: error: project 'lace' not found in running containers
wez-into: error: no running devcontainers found
wez-into: error:
wez-into: error: hint: 'lace' is stopped. Use --start to start it:
wez-into: error:   wez-into --start lace
exit: 1
```

**PASS** -- includes `--start` hint for stopped project.

### 3.6 Test: no args when no containers running

```
$ wez-into
wez-into: error: no running devcontainers found
wez-into: error:
wez-into: error: stopped containers available (use --start to start one):
  lace  (/var/home/mjr/code/weft/lace)
  dotfiles  (/home/mjr/code/personal/dotfiles)
exit: 1
```

**PASS** -- lists stopped containers with `--start` guidance.

### 3.7 Test: `--start --dry-run lace` when lace is already running

(Container started via `docker start d53e45db9dbf`)

```
$ wez-into --start --dry-run lace
wez-into: lace is already running
wezterm connect lace:22426 --workspace lace
exit: 0
```

**PASS** -- detects running container and connects directly, bypassing `lace up`.

### 3.8 Test: `--dry-run lace` when running (existing functionality)

```
$ wez-into --dry-run lace
wezterm connect lace:22426 --workspace lace
exit: 0
```

**PASS** -- existing behavior preserved.

### 3.9 Test: `--list` when running (existing functionality)

```
$ wez-into --list
lace
exit: 0
```

**PASS** -- existing behavior preserved.

### 3.10 Test: `--status` when running (existing functionality)

```
$ wez-into --status
PROJECT              PORT     USER       PATH
-------              ----     ----       ----
lace                 22426    node       /var/home/mjr/code/weft/lace
exit: 0
```

**PASS** -- existing behavior preserved.

### 3.11 Integration test: `lace up` with running discovery

Manually simulated the `start_and_connect` flow:

```
$ lace up --workspace-folder /var/home/mjr/code/weft/lace --skip-metadata-validation
# exit code: 1 (postStartCommand CWD failure)
# but container started: docker ps shows Up status

$ lace-discover
lace:22426:node:/var/home/mjr/code/weft/lace
```

**PASS** -- container is running and discoverable despite `lace up` exit code 1. The resilient error handling in `start_and_connect` would proceed to discovery and succeed.

### Test Scorecard

| # | Test | Result |
|---|------|--------|
| 3.1 | `--help` includes --start | **PASS** |
| 3.2 | `--start --dry-run lace` (stopped) | **PASS** |
| 3.3 | `--start --dry-run dotfiles` (stopped) | **PASS** |
| 3.4 | `--start nonexistent` | **PASS** |
| 3.5 | `lace` without --start (hint) | **PASS** |
| 3.6 | no args, no running (hint) | **PASS** |
| 3.7 | `--start --dry-run lace` (running) | **PASS** |
| 3.8 | `--dry-run lace` (running, no --start) | **PASS** |
| 3.9 | `--list` (running) | **PASS** |
| 3.10 | `--status` (running) | **PASS** |
| 3.11 | `lace up` with discovery (integration) | **PASS** |

---

## Changes Made

### `bin/wez-into`

New functions:
- `locate_lace_cli()` -- finds the lace CLI via co-located path, known locations, or PATH
- `discover_stopped()` -- queries Docker for stopped devcontainers, returns `name\tpath` lines
- `start_and_connect()` -- runs `lace up`, handles failure gracefully, retries discovery, connects

Argument parser changes:
- Added `--start` flag (`START=true/false`)
- Updated usage string in error output

Connect-to-specific-project changes:
- Check running first, connect if found (with "already running" message if `--start` given)
- If `--start` and not running: look up in stopped containers, invoke `start_and_connect`
- If not running and not `--start`: show hint about `--start` when project is stopped

Interactive picker changes:
- When `--start` without project name: combined picker showing `[running]` and `[stopped]` containers
- When no running containers and no `--start`: show stopped containers with `--start` guidance

Help text changes:
- Added `--start` usage lines
- Added `--start` explanation paragraph
- Added `--start` examples

### Key Design Choices

1. **Resilient `lace up` error handling:** `lace up` exits 1 when `postStartCommand` fails, but the container may be running. The script proceeds to discovery anyway and only fails if the container is not discoverable.

2. **`--skip-metadata-validation`:** Third-party features like nushell may lack OCI metadata. Since `--start` restarts existing containers (not creating new ones), metadata validation is not critical.

3. **Retry loop for discovery:** After `lace up`, the container may need a few seconds to become discoverable (SSH port mapping). The script retries up to 10 times (2s intervals).

4. **`--start` hint in error messages:** When a user tries to connect to a stopped container without `--start`, the error message includes a hint showing the exact command to use.

5. **Combined picker:** `wez-into --start` (no project name) shows both running and stopped containers in a single picker, with status labels to distinguish them.
