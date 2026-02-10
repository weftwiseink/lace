---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:00:00-08:00
task_list: lace/wezterm-plugin
type: report
state: live
status: done
tags: [status, wezterm, cli, devcontainer, wez-lace-into, open-lace-workspace, discovery]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:15:00-08:00
  round: 1
related_to:
  - cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
  - cdocs/proposals/2026-02-01-deeper-wezterm-devcontainer-integration.md
  - cdocs/proposals/2026-02-04-wezterm-project-picker.md
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
  - cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
---

# Status Report: CLI Commands for WezTerm Devcontainer Connection

> BLUF: The lace ecosystem has two generations of CLI tooling for connecting WezTerm to devcontainers. The first generation -- per-project launcher scripts (`open-lace-workspace`, `open-dotfiles-workspace`) -- handles the full lifecycle but is hardcoded to a single project. The second generation -- `wez-lace-into` backed by `lace-discover` and the lace.wezterm plugin -- provides generic multi-project discovery and connection via Docker labels and a port-range convention. However, the two generations are not yet reconciled: the lace devcontainer itself still uses legacy port 2222 (outside the discovery range), `wez-lace-into` is not on PATH, and there is no single command accessible from any terminal that handles the user's mental model of "type a short command to get into a specific devcontainer."

## Context / Background

This report traces the evolution of CLI tooling for connecting WezTerm to lace-managed devcontainers, from the initial `open-lace-workspace` PoC through the current `wez-lace-into` command. The user recalls a prior "wez-into-something" command and wants to understand what was discussed, what was built, what was proposed but not done, and what gaps remain.

The timeline spans roughly one week (2026-02-01 through 2026-02-08), during which the architecture evolved from single-project hardcoded scripts to a generic port-range discovery system.

## Key Findings

### What Was Implemented

**1. `bin/open-lace-workspace` (Generation 1, lace-specific)**

- **Location:** `/var/home/mjr/code/weft/lace/bin/open-lace-workspace` (379 lines)
- **Proposed:** `cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md` (status: implementation_accepted)
- **Implemented:** `cdocs/devlogs/2026-02-01-open-lace-workspace-implementation.md` (status: completed)
- **What it does:** Full lifecycle orchestration -- runs `devcontainer up`, polls SSH on port 2222, checks/starts wezterm-mux-server, manages known_hosts, opens WezTerm via `wezterm connect lace`. Supports piped mode (`devcontainer up | bin/open-lace-workspace`) and standalone mode. Interactive prompts for reconnect vs rebuild when container is already running.
- **Limitations:** Hardcoded to the lace project (port 2222, user `node`, SSH domain `lace`). Not reusable for other projects. Port 2222 is outside the lace discovery range (22425-22499).

**2. `bin/open-dotfiles-workspace` (Generation 1, dotfiles-specific)**

- **Location:** `dotfiles/bin/open-dotfiles-workspace` (374 lines, in the dotfiles repo)
- **What it does:** Near-identical to `open-lace-workspace` but for the dotfiles devcontainer (port 2223, user `vscode`, SSH domain `dotfiles`).
- **Current status:** The launcher elimination proposal (`cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md`, status: accepted) recommends deleting it entirely. Not yet executed.

**3. `bin/wez-lace-into` (Generation 2, multi-project)**

- **Location:** `/var/home/mjr/code/weft/lace/bin/wez-lace-into` (141 lines)
- **Proposed:** `cdocs/proposals/2026-02-04-wezterm-project-picker.md` (status: accepted)
- **What it does:** Generic multi-project CLI. Discovers running devcontainers via `lace-discover`. Supports interactive picker (fzf or bash `select`), direct connection (`wez-lace-into <project>`), `--list`, `--status`. Connects via `wezterm connect lace:PORT --workspace PROJECT`.
- **Limitations:** Only discovers containers in port range 22425-22499. Not on PATH (lives inside the lace repo). Does not handle container startup.

**4. `bin/lace-discover` (Generation 2 infrastructure)**

- **Location:** `/var/home/mjr/code/weft/lace/bin/lace-discover` (127 lines)
- **What it does:** Queries Docker for running containers with `devcontainer.local_folder` label and port mappings in 22425-22499. Outputs `name:port:user:path` text or JSON. Looks up container user via `docker inspect`.

**5. lace.wezterm plugin project picker (Generation 2, WezTerm-native)**

- **Location:** `/home/mjr/code/weft/lace.wezterm/plugin/init.lua` (307 lines)
- **What it does:** Pre-registers 75 SSH domains (ports 22425-22499). Provides a project picker (Ctrl+Shift+P by default) that discovers running containers via Docker CLI. Overrides SSH domain username at connection time based on `docker inspect` results.

### What Was Proposed But Not Implemented

**6. "Deeper WezTerm-Devcontainer Integration" RFP**

- **Location:** `cdocs/proposals/2026-02-01-deeper-wezterm-devcontainer-integration.md` (status: request_for_proposal)
- **What it proposed:**
  - Absorb `open-lace-workspace` into the lace CLI as `lace connect` or `lace workspace`
  - Window reuse (detect existing WezTerm window connected to a domain, focus it instead of opening a new one)
  - Auto-connect on WezTerm launch via `gui-startup` event
  - Worktree selection (`lace connect feature-auth` landing at `/workspace/feature-auth`)
- **Status:** Never progressed beyond RFP. The port-scanning discovery architecture superseded the registry-based approach this RFP assumed.

**7. Lace port migration to 22425**

- **Mentioned in:** `cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md` (Phase 4, optional)
- **What it proposed:** Change lace's own `devcontainer.json` from `appPort: "2222:2222"` to `appPort: "22425:2222"`, making it discoverable by `wez-lace-into` and the project picker. This would allow `open-lace-workspace` to be slimmed down or deleted, following the same pattern as the dotfiles launcher elimination.
- **Status:** Not started. Listed as a separate effort.

## Analysis

### Two Architectural Generations

The tooling splits cleanly into two generations:

| Aspect | Gen 1 (Launchers) | Gen 2 (Discovery) |
|--------|-------------------|-------------------|
| Scripts | `open-lace-workspace`, `open-dotfiles-workspace` | `wez-lace-into`, `lace-discover` |
| Discovery | None (hardcoded port/user/domain) | Docker labels + port-range scanning |
| Scope | One project per script | Any project in port range |
| Container startup | Yes (`devcontainer up` built-in) | No (discovery-only) |
| SSH polling | Yes (retry loop) | No (delegates to wezterm connect) |
| Mux server checks | Yes (docker exec pgrep) | No (relies on postStartCommand) |
| Known hosts | Yes (ssh-keygen -R + ssh-keyscan) | Plugin handles via StrictHostKeyChecking=accept-new |
| Lines of code | 374-379 per project | 141 + 127 shared across all projects |

Gen 1 provides a seamless single-command experience but requires per-project scripts. Gen 2 provides generic multi-project support but lacks the lifecycle orchestration that makes Gen 1 "just work."

### The Discovery Gap

The lace devcontainer (port 2222) is invisible to Gen 2 tools. This is the single largest practical gap: the user's primary project cannot be reached by the newer, better tooling. Until lace migrates to port 22425, `open-lace-workspace` remains necessary.

### The PATH Gap

`wez-lace-into` lives at `/var/home/mjr/code/weft/lace/bin/wez-lace-into`. It is not on PATH. The user cannot type `wez-lace-into lace` from an arbitrary terminal. This is what the user means by "wez-into" -- a command that works from anywhere, not just from within the lace repo.

### The Naming Gap

"wez-lace-into" couples the command name to the lace project. The tool is generic -- it connects to any devcontainer in the port range. A name like `wez-into` or `lace-connect` would better reflect its scope.

### The Startup Gap

Gen 1 launchers handle "cold start" (container not running) by running `devcontainer up`. Gen 2 `wez-lace-into` only works with running containers. If the container is stopped, the user must start it separately, then run `wez-lace-into`. The launcher elimination proposal explicitly acknowledged this as "a deliberate tradeoff" but listed a `--start` flag as a potential enhancement.

## Recommendations

### 1. Migrate lace to port 22425 (highest priority)

Change `appPort` from `"2222:2222"` to `"22425:2222"` in lace's `.devcontainer/devcontainer.json`. This single change makes lace discoverable by `wez-lace-into`, `lace-discover`, and the WezTerm project picker. This is the prerequisite for everything else.

### 2. Make the CLI command accessible from any terminal

Either:
- Deploy `wez-lace-into` (and `lace-discover`) to a PATH location via chezmoi (the dotfiles repo manages shell setup)
- Create a shell function/alias in nushell and bash configs that delegates to the script
- Install the scripts as part of a global `lace` CLI package

The chezmoi approach is most consistent with the existing dotfiles architecture.

### 3. Settle on a command name

Consider `wez-into` (shorter, decoupled from lace branding) as the user-facing command. Alternatively, `lace connect` if the lace CLI absorbs this functionality. The current `wez-lace-into` name is functional but verbose.

### 4. Consider adding container startup capability

A `--start` or `--up` flag on the CLI command would handle the cold-start case: discover via Docker, if not found try `devcontainer up --workspace-folder <path>`, then connect. This bridges the Gen 1 convenience with the Gen 2 architecture. The project path could come from a simple config file or be derived from known project locations.

### 5. Retire open-lace-workspace after port migration

Once lace is on port 22425, `open-lace-workspace` becomes redundant with `wez-lace-into lace`. Follow the same elimination pattern as the dotfiles launcher: delete the script, rely on the ecosystem tools.

## Related Documents

### Proposals
- `cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md` -- open-lace-workspace proposal
- `cdocs/proposals/2026-02-01-deeper-wezterm-devcontainer-integration.md` -- RFP for lace connect/workspace
- `cdocs/proposals/2026-02-04-wezterm-project-picker.md` -- wez-lace-into and picker proposal
- `cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md` -- port-range discovery architecture
- `cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md` -- launcher elimination pattern

### Devlogs
- `cdocs/devlogs/2026-02-01-open-lace-workspace-implementation.md` -- open-lace-workspace implementation
- `cdocs/devlogs/2026-02-04-wezterm-project-picker-cli.md` -- wez-lace-into CLI research

### Reports
- `cdocs/reports/2026-02-04-wezterm-workstream-status.md` -- broader workstream status
- `cdocs/reports/2026-02-04-wezterm-workstream-executive-summary.md` -- executive summary
