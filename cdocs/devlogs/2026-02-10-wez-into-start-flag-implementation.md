---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T20:00:00-08:00
task_list: lace/wezterm-plugin
type: devlog
state: live
status: in_progress
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
2. Handle edge cases (no project name, nonexistent project, `lace up` failure)
3. Update help text and test all scenarios

---

## Phase 1: Add `--start` Flag and Core Logic

### 1.1 Locate lace CLI

The lace CLI is at `packages/lace/bin/lace` relative to `wez-into`. Using the same co-location pattern as `lace-discover`:

```bash
LACE_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../packages/lace/bin/lace"
```

### 1.2 Stopped container discovery

Query Docker for stopped containers with the `devcontainer.local_folder` label:

```bash
docker ps -a --filter "label=devcontainer.local_folder" --filter "status=exited" \
  --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}'
```

Match by basename of the `local_folder` label against the requested project name.

### 1.3 Implementation

Added the following to `wez-into`:
- `--start` flag in argument parser
- `locate_lace_cli()` function to find the lace CLI
- `discover_stopped()` function to query Docker for stopped containers
- `start_and_connect()` function that runs `lace up` then re-discovers and connects
- Integration into the main flow: `--start <project>` checks running first, then stopped

### 1.4 Verification: Argument parsing

```
$ bin/wez-into --help
(captured below after implementation)
```

---

## Phase 2: Edge Cases

### 2.1 `wez-into --start` with no project name

Shows a picker of stopped containers (same picker UX as running containers).

### 2.2 `wez-into --start nonexistent`

Errors with helpful message listing available stopped containers.

### 2.3 Port shift after restart

Re-runs `lace-discover` after `lace up` completes to get the current port. This handles the case where the port allocator assigns a different port on restart.

### 2.4 `lace up` failure

Captures and displays the error from `lace up`. Exits with error code.

---

## Phase 3: Testing

### 3.1 Pre-test state

```
$ docker ps -a --filter "label=devcontainer.local_folder" --format '{{.ID}}\t{{.Label "devcontainer.local_folder"}}\t{{.Status}}'
d53e45db9dbf	/var/home/mjr/code/weft/lace	Exited (0) 27 minutes ago
a8fc4a91cb95	/home/mjr/code/personal/dotfiles	Exited (0) 27 minutes ago
```

Both containers stopped. No running devcontainers.

### 3.2 Test: `--start lace` when lace is stopped

```
(to be captured)
```

### 3.3 Test: `--start lace` when lace is already running

```
(to be captured)
```

### 3.4 Test: `--start nonexistent`

```
(to be captured)
```

### 3.5 Test: `--start` with no args (picker)

```
(to be captured)
```

### 3.6 Test: `--dry-run --start lace`

```
(to be captured)
```

---

## Changes Made

### `bin/wez-into`
- Added `--start` flag to argument parser
- Added `locate_lace_cli()` function
- Added `discover_stopped()` function
- Added `start_and_connect()` function
- Modified connect-to-specific-project flow to support `--start`
- Modified interactive picker to include stopped containers when `--start` is active
- Updated help text with `--start` examples
