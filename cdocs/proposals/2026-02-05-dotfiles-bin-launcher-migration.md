---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T14:00:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: archived
status: superseded
superseded_by: cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
evolved_into: cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
tags: [dotfiles, devcontainer, wezterm, launcher, bin, parameterization, migration, deduplication]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-05T17:30:00-08:00
  round: 2
revisions:
  - at: 2026-02-05T14:45:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Added WEZTERM_LOG_FILE and extra troubleshooting line to differences table"
      - "Added complete REPO_ROOT resolution logic to Configuration Resolution code block"
      - "Added LACE_WORKSPACE_ROOT override and CONF_DIR derivation"
      - "Added forward-compatibility edge case"
      - "Fixed config loading test plan to use runtime observation instead of --help"
      - "Clarified Phase 1 scope wording"
  - at: 2026-02-05T17:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Expanded all three implementation phases with exact code changes (pseudocode/diffs)"
      - "Added concrete workspace.conf examples for both lace and dotfiles with side-by-side table"
      - "Added REPO_ROOT resolution walkthrough table for each invocation path"
      - "Added pre-conditions and post-conditions for each phase"
      - "Added 12 Phase 1 tests, 11 Phase 2 tests, and 2 Phase 3 tests with exact commands"
      - "Added error path test coverage for all exit codes (0-4)"
      - "Added regression tests for WEZTERM_LOG_FILE derivation and troubleshooting messages"
      - "Restructured Test Plan as summary checklist cross-referencing per-phase tests"
      - "Added Forward Compatibility section with port-range discovery alignment analysis"
      - "Added migration path table (static -> port-range -> dynamic discovery)"
      - "Added third-project adoption pattern with concrete steps and code"
      - "Added DISCOVERY_MODE pseudocode for future port-range integration"
  - at: 2026-02-05T17:45:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "R2 review fix: LACE_WORKSPACE_CONF set to missing file now fails fast with exit 1 instead of silently falling through to lace defaults"
      - "Updated config loading block in both Proposed Solution and Phase 1 code"
      - "Updated Test 2.7 to expect fail-fast error"
      - "Updated Error Path Coverage table entry 7"
      - "Added edge case: LACE_WORKSPACE_CONF Set But Config File Missing"
  - at: 2026-02-05T20:00:00-08:00
    by: "@claude-opus-4-6"
    changes:
      - "Marked as superseded by dotfiles-eliminate-workspace-launcher proposal"
      - "The parameterization approach was superseded by a proposal to eliminate the launcher script entirely by leveraging the existing lace ecosystem (port-range discovery, lace.wezterm plugin, wez-lace-into)"
related_to:
  - cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md
  - cdocs/proposals/2026-02-01-devcontainer-auto-attach-wezterm-workspace.md
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
  - cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md
---

# Dotfiles bin/ Launcher Migration to Lace

> **SUPERSEDED**: This proposal has been superseded by [Eliminate Dotfiles Workspace Launcher](2026-02-05-dotfiles-eliminate-workspace-launcher.md), which takes a more aggressive approach: rather than parameterizing the launcher script to work for both projects, it eliminates the need for a launching script entirely by leveraging the existing lace ecosystem (port-range discovery, lace.wezterm plugin, `wez-lace-into`).

> BLUF: The dotfiles project's `bin/open-dotfiles-workspace` is a near-verbatim fork of lace's `bin/open-lace-workspace` (374 lines, ~95% identical code), differing only in a handful of configuration constants (SSH key, port, user, domain name, CWD prefix, WEZTERM_CONFIG_FILE) plus two derived values (log file path, an extra troubleshooting message). This proposal eliminates the fork by parameterizing `open-lace-workspace` into a generic `open-workspace` script that reads project-specific configuration from a small manifest file (`.lace/workspace.conf`), then providing a thin wrapper in dotfiles that invokes lace's script. This is a tactical improvement that can be completed in two phases, independent of the longer-term port-range migration tracked in [port-scanning discovery](2026-02-04-port-scanning-wezterm-discovery.md). The approach preserves all existing behavior for both projects while eliminating the maintenance burden of keeping two copies in sync.
>
> **Key dependency:** [Dotfiles Migration and Config Extraction](2026-02-04-dotfiles-migration-and-config-extraction.md) (accepted) created the fork; this proposal addresses the resulting maintenance debt.

## Objective

Eliminate the duplicated workspace launcher script between the lace and dotfiles projects by:

1. **Deduplicating the launcher logic** so that a single maintained script handles all devcontainer-to-WezTerm workspace connections
2. **Preserving project-specific behavior** through a configuration mechanism rather than code duplication
3. **Avoiding coupling to unfinished infrastructure** (the port-range discovery system is not yet implemented; this proposal works with the current fixed-port architecture)

## Background

### How the Fork Was Created

The [dotfiles migration proposal](2026-02-04-dotfiles-migration-and-config-extraction.md) (Phase 3) created `dotfiles/bin/open-dotfiles-workspace` by adapting `lace/bin/open-lace-workspace`. The commit message explicitly notes this: "feat(devcontainer): add minimal devcontainer with wezterm-server ... bin/open-dotfiles-workspace: WezTerm workspace connection script."

### Current State: Two Scripts, One Logic

Both scripts follow an identical five-phase structure:

| Phase | Purpose | Identical? |
|-------|---------|------------|
| A | Prerequisite checks (wezterm, SSH key) | Yes (parameterized by SSH_KEY) |
| B | Obtain devcontainer up JSON (piped/standalone) | Yes |
| C | Parse JSON and validate outcome | Yes |
| D | SSH readiness polling | Yes (parameterized by SSH_PORT, SSH_USER) |
| E | WezTerm connect (mux check, pane detection, known_hosts, connect) | Mostly (see differences below) |

### Configuration Differences

A line-by-line diff reveals that all differences reduce to configuration values. The six primary configuration constants are:

| Parameter | `open-lace-workspace` | `open-dotfiles-workspace` |
|-----------|----------------------|--------------------------|
| `SSH_KEY` | `~/.ssh/lace_devcontainer` | `~/.ssh/dotfiles_devcontainer` |
| `SSH_PORT` | `2222` | `2223` |
| `SSH_USER` | `node` | `vscode` |
| `DOMAIN_NAME` | `lace` (hardcoded in string literals) | `dotfiles` (stored in variable) |
| `WEZTERM_CONFIG_FILE` | Exported to repo's config | Not set |
| Existing pane CWD prefix | `file:///workspace/` | `file:///workspaces/` |

Two additional differences are derivable from the above:

| Derived value | `open-lace-workspace` | `open-dotfiles-workspace` |
|---------------|----------------------|--------------------------|
| `WEZTERM_LOG_FILE` | `/tmp/open-lace-workspace-wezterm.log` | `/tmp/open-dotfiles-workspace-wezterm.log` |
| Extra troubleshooting line | Not present | `"ensure WezTerm config has '$DOMAIN_NAME' SSH domain configured"` |

The log file path is derivable from `DOMAIN_NAME` (e.g., `/tmp/open-${DOMAIN_NAME}-workspace-wezterm.log`). The extra troubleshooting line in the dotfiles script is a useful addition that the generic script should include for all projects.

Every other line -- the helper functions, argument parsing, stdin detection, JSON extraction, jq/fallback parsing, SSH polling loop, container detection, interactive prompts, mux server verification, known_hosts management, wezterm connect backgrounding, and failure diagnostics -- is identical or differs only in these substituted values.

### The Dotfiles Script Is Slightly Ahead

The dotfiles version introduced two improvements over the lace version:

1. **`DOMAIN_NAME` variable**: The dotfiles script stores the WezTerm domain name in a variable and references it throughout, while lace hardcodes the string `"lace"` in several places.
2. **No forced `WEZTERM_CONFIG_FILE`**: The dotfiles script does not export `WEZTERM_CONFIG_FILE`, instead relying on the user's WezTerm config to define the SSH domain. This is more portable.

### Relationship to Port-Range Discovery

The [port-scanning discovery proposal](2026-02-04-port-scanning-wezterm-discovery.md) (status: `implementation_ready`) and the [lace.wezterm plugin](/home/mjr/code/weft/lace.wezterm/plugin/init.lua) represent the strategic direction: projects use ports in the 22425-22499 range, Docker label-based discovery finds them, and `wez-lace-into` or the WezTerm project picker connects to them.

However, both `open-lace-workspace` and `open-dotfiles-workspace` use the older fixed-port model (2222 and 2223 respectively). This proposal works within the current fixed-port model and does not require adopting the port-range system. When the port-range system is ready, the generic launcher can be updated once to support it, rather than updating two separate scripts.

## Proposed Solution

### Architecture: Generic Script + Project Manifest

Transform `bin/open-lace-workspace` into a generic `bin/open-workspace` script that reads configuration from a manifest file, with thin project-specific wrappers for backward compatibility.

```
lace/
  bin/
    open-workspace           # Generic launcher (new, the real logic)
    open-lace-workspace      # Thin wrapper that calls open-workspace (backward compat)

dotfiles/
  bin/
    open-dotfiles-workspace  # Thin wrapper that calls lace's open-workspace
  .lace/
    workspace.conf           # Project-specific configuration
```

### The Manifest File: `.lace/workspace.conf`

Each project that uses the lace workspace launcher provides a small shell-sourceable config file:

```bash
# .lace/workspace.conf - Project workspace configuration for lace open-workspace
#
# This file is sourced by lace's bin/open-workspace to configure
# devcontainer-to-WezTerm workspace connections.

# SSH key for container access
SSH_KEY="$HOME/.ssh/dotfiles_devcontainer"

# Host port mapped to container's sshd (port 2222 inside container)
SSH_PORT=2223

# Container user
SSH_USER="vscode"

# WezTerm SSH domain name (must match WezTerm config)
DOMAIN_NAME="dotfiles"

# CWD prefix for detecting existing WezTerm panes connected to this container
PANE_CWD_PREFIX="file:///workspaces/"

# Optional: WezTerm config file override (leave unset to use user's default)
# WEZTERM_CONFIG_FILE=""
```

**Why shell-sourceable?** The launcher is a bash script. Sourcing a config file is zero-dependency, requires no parsing library, and is the standard pattern for bash configuration. The variables are the same ones already defined at the top of both scripts.

### The Generic Script: `bin/open-workspace`

The generic script is structurally identical to the current `open-lace-workspace` with three changes:

1. **Configuration loading**: After resolving `REPO_ROOT`, the script looks for a workspace config in this priority order:
   - `$LACE_WORKSPACE_CONF` environment variable (explicit override)
   - `$REPO_ROOT/.lace/workspace.conf` (project manifest)
   - Built-in defaults (current lace values, for backward compatibility)

2. **`DOMAIN_NAME` variable**: All string literals referencing the domain name use the `$DOMAIN_NAME` variable (adopting the dotfiles improvement).

3. **Optional `WEZTERM_CONFIG_FILE`**: The export is conditional on the variable being set in config, defaulting to unset (adopting the dotfiles improvement).

### The Lace Wrapper: `bin/open-lace-workspace`

Reduced to a thin wrapper:

```bash
#!/bin/bash
# Open a WezTerm workspace connected to the lace devcontainer.
# This is a convenience wrapper around bin/open-workspace.
# See bin/open-workspace for full documentation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/open-workspace" "$@"
```

Lace's configuration is provided either via `.lace/workspace.conf` in the lace repo (explicit) or via the built-in defaults in `open-workspace` (implicit, for zero-config backward compatibility).

### The Dotfiles Wrapper: `bin/open-dotfiles-workspace`

Reduced to a thin wrapper that invokes lace's generic script:

```bash
#!/bin/bash
# Open a WezTerm workspace connected to the dotfiles devcontainer.
# Delegates to lace's generic workspace launcher.
#
# Requires lace checkout at ~/code/weft/lace (or set LACE_ROOT).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LACE_ROOT="${LACE_ROOT:-$HOME/code/weft/lace}"

if [[ ! -x "$LACE_ROOT/bin/open-workspace" ]]; then
  echo "$(basename "$0"): error: lace not found at $LACE_ROOT" >&2
  echo "Set LACE_ROOT to your lace checkout path" >&2
  exit 1
fi

export LACE_WORKSPACE_CONF="$REPO_ROOT/.lace/workspace.conf"
exec "$LACE_ROOT/bin/open-workspace" "$@"
```

### Configuration Resolution in `open-workspace`

```bash
# --- Resolve script location ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Configuration loading ---
# Priority: env var > project manifest > script-relative defaults
#
# REPO_ROOT determines the project directory for:
#   - devcontainer up --workspace-folder
#   - Docker label filtering (devcontainer.local_folder=$REPO_ROOT)
#   - Troubleshooting messages
#
# When invoked via LACE_WORKSPACE_CONF (cross-project use), REPO_ROOT must
# point to the calling project, not to the lace repo where this script lives.

if [[ -n "${LACE_WORKSPACE_CONF:-}" ]]; then
  # Cross-project invocation: config path explicitly provided
  if [[ ! -f "$LACE_WORKSPACE_CONF" ]]; then
    echo "$(basename "$0"): error: config file not found: $LACE_WORKSPACE_CONF" >&2
    exit 1
  fi
  # Derive REPO_ROOT from config file location
  # Convention: config lives at <project-root>/.lace/workspace.conf
  # Allow explicit override via LACE_WORKSPACE_ROOT for non-standard layouts
  CONF_DIR="$(cd "$(dirname "$LACE_WORKSPACE_CONF")" && pwd)"
  REPO_ROOT="${LACE_WORKSPACE_ROOT:-$(dirname "$CONF_DIR")}"
  # shellcheck source=/dev/null
  source "$LACE_WORKSPACE_CONF"
elif [[ -f "$(dirname "$SCRIPT_DIR")/.lace/workspace.conf" ]]; then
  # Script-local project has a config file
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.lace/workspace.conf"
else
  # No config file: use script's own repo (backward-compatible lace default)
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
fi

# Apply defaults for any values not set by config
SSH_KEY="${SSH_KEY:-$HOME/.ssh/lace_devcontainer}"
SSH_PORT="${SSH_PORT:-2222}"
SSH_USER="${SSH_USER:-node}"
SSH_HOST="${SSH_HOST:-localhost}"
DOMAIN_NAME="${DOMAIN_NAME:-lace}"
PANE_CWD_PREFIX="${PANE_CWD_PREFIX:-file:///workspace/}"
MAX_SSH_ATTEMPTS="${MAX_SSH_ATTEMPTS:-15}"
SSH_RETRY_INTERVAL="${SSH_RETRY_INTERVAL:-1}"

# Derived values
WEZTERM_LOG_FILE="${WEZTERM_LOG_FILE:-/tmp/open-${DOMAIN_NAME}-workspace-wezterm.log}"

# Optional: set WEZTERM_CONFIG_FILE only if explicitly configured
if [[ -n "${WEZTERM_CONFIG_FILE:-}" ]]; then
  export WEZTERM_CONFIG_FILE
fi
```

## Important Design Decisions

### Decision 1: Shell-Sourceable Config Over JSON/TOML

**Decision:** Use a bash-sourceable `.lace/workspace.conf` rather than JSON, TOML, or YAML.

**Why:** The consumer is a bash script. Sourcing a config file requires zero additional dependencies -- no `jq`, no custom parser, no TOML library. The variables map 1:1 to the script's internal configuration. JSON would require either `jq` (optional dependency) or fragile grep/sed parsing (which the script already does as a fallback for `devcontainer up` output, and it is not pleasant). This is the idiomatic bash approach.

### Decision 2: Generic Script in Lace Repo, Not a Separate Package

**Decision:** Keep `bin/open-workspace` in the lace repository rather than extracting it to a standalone package.

**Why:** The script is tightly coupled to the lace devcontainer ecosystem (SSH key conventions, mux server expectations, WezTerm domain patterns). Extracting it would create a distribution problem without clear benefit. Other projects reference lace's script directly or copy the thin wrapper pattern. When the lace CLI matures, this script's functionality will likely be absorbed into `lace connect` or similar.

### Decision 3: `LACE_WORKSPACE_CONF` Environment Variable for Cross-Project Use

**Decision:** Allow external projects to specify their config via an environment variable rather than requiring the config to be at a fixed path relative to `open-workspace`.

**Why:** The generic script resolves `REPO_ROOT` relative to its own location (i.e., the lace repo). When dotfiles invokes `open-workspace`, `REPO_ROOT` would point to lace, not dotfiles. The environment variable lets the dotfiles wrapper say "use my config, not yours" without the generic script needing to know about dotfiles.

### Decision 4: Backward-Compatible Defaults Match Current Lace Behavior

**Decision:** When no config file is found, the script uses lace's current values as defaults.

**Why:** This ensures that existing `open-lace-workspace` invocations (without any config file) continue to work identically. Zero behavioral change for lace users who do not create a `.lace/workspace.conf`. The thin wrapper `open-lace-workspace` can exist as a zero-logic redirect.

### Decision 5: Dotfiles Wrapper Requires a Lace Checkout

**Decision:** The dotfiles wrapper references lace's `bin/open-workspace` on the host filesystem rather than vendoring a copy of the script.

**Why:** The entire point of this proposal is to eliminate code duplication. Vendoring would recreate the problem. Requiring a lace checkout is a reasonable prerequisite -- the user already has lace checked out (they are using lace devcontainers). The `LACE_ROOT` environment variable provides an escape hatch for non-standard paths.

### Decision 6: REPO_ROOT Override for Cross-Project Invocation

**Decision:** When `LACE_WORKSPACE_CONF` is set, `REPO_ROOT` is derived from the config file's parent directory (convention: `<project>/.lace/workspace.conf` means `REPO_ROOT` is two levels up). An explicit `LACE_WORKSPACE_ROOT` environment variable overrides this derivation for non-standard layouts.

**Why:** Several parts of the script use `REPO_ROOT` for project-specific operations: the `--workspace-folder` argument to `devcontainer up`, Docker label filtering (`devcontainer.local_folder=$REPO_ROOT`), and troubleshooting messages. When dotfiles invokes lace's generic script, `REPO_ROOT` must point to the dotfiles repo, not the lace repo. The two-level derivation (`dirname(dirname(LACE_WORKSPACE_CONF))`) matches the `.lace/workspace.conf` convention. `LACE_WORKSPACE_ROOT` provides an escape hatch when the config file is not at the conventional path. See the Configuration Resolution code block for the complete logic.

## Stories

### Developer Opens Lace Workspace (No Change)

Developer runs `./bin/open-lace-workspace` from the lace repo. The thin wrapper calls `bin/open-workspace`. No `.lace/workspace.conf` exists (or it does with lace-specific values). Built-in defaults apply. Behavior is identical to current `open-lace-workspace`.

### Developer Opens Dotfiles Workspace

Developer runs `./bin/open-dotfiles-workspace` from the dotfiles repo. The thin wrapper sets `LACE_WORKSPACE_CONF` to `dotfiles/.lace/workspace.conf` and execs `lace/bin/open-workspace`. The generic script sources the config, picks up SSH port 2223, user `vscode`, domain `dotfiles`, etc. Behavior is identical to current `open-dotfiles-workspace`.

### Lace Improves the Launcher

Developer adds a new feature to `bin/open-workspace` (e.g., better error messages, retry logic, tmux fallback). Both lace and dotfiles get the improvement automatically. No manual porting required.

### New Project Adopts Lace Workspace Launcher

A third project creates `.lace/workspace.conf` with its own SSH port, key, and domain name. It adds a thin `bin/open-myproject-workspace` wrapper (5 lines). Full launcher functionality without forking 374 lines.

## Edge Cases / Challenging Scenarios

### Config File Contains Invalid Bash

**Trigger:** User puts malformed syntax in `.lace/workspace.conf`.

**Behavior:** `source` will fail, bash reports a syntax error, and `set -e` causes the script to abort with a clear error traceback pointing to the config file.

**Mitigation:** The config file format is simple key-value assignments. Document the expected format in a comment header within the template. Optionally, validate required variables after sourcing.

### Config File Overrides Unexpected Variables

**Trigger:** `.lace/workspace.conf` defines variables that collide with script internals (e.g., `SCRIPT_DIR`, `REPO_ROOT`, `ATTEMPT`).

**Behavior:** The sourced values would override script variables, potentially causing unexpected behavior.

**Mitigation:** Source the config file before any internal state is established (immediately after resolving `SCRIPT_DIR` and `REPO_ROOT`). Document that only the defined configuration variables should be set. Prefix internal variables with `_OW_` if collision becomes a real problem.

### Lace Checkout Not Found by Dotfiles Wrapper

**Trigger:** User clones dotfiles on a machine without lace checked out.

**Behavior:** The dotfiles wrapper prints a clear error: "lace not found at ~/code/weft/lace" with instructions to set `LACE_ROOT`.

**Mitigation:** The error message is actionable. Users who do not use lace devcontainers will not run this script.

### Both Projects Running Simultaneously

**Trigger:** User has lace (port 2222) and dotfiles (port 2223) devcontainers running concurrently.

**Behavior:** Each invocation uses its own config. No conflict because ports, keys, and domains are all distinct. This is the same behavior as the current two-script setup.

### Existing Pane Detection CWD Prefix Mismatch

**Trigger:** The `PANE_CWD_PREFIX` in the config does not match the actual container's workspace path.

**Behavior:** The script will not detect existing WezTerm panes connected to this container, and will always offer to open a new window.

**Mitigation:** Document the relationship between `PANE_CWD_PREFIX` and the devcontainer's `workspaceFolder` setting. For the dotfiles case, `file:///workspaces/` matches the default devcontainer mount path.

### REPO_ROOT Derivation When Config Is Not in `.lace/` Subdirectory

**Trigger:** User sets `LACE_WORKSPACE_CONF` to an arbitrary path not under a `.lace/` directory.

**Behavior:** The `REPO_ROOT` derivation (two levels up from config) would produce an incorrect path.

**Mitigation:** Set `LACE_WORKSPACE_ROOT` explicitly in the wrapper script or environment. The config resolution uses `LACE_WORKSPACE_ROOT` when set, falling back to the two-level derivation only as a convention-based default.

### LACE_WORKSPACE_CONF Set But Config File Missing

**Trigger:** The dotfiles wrapper sets `LACE_WORKSPACE_CONF` to `dotfiles/.lace/workspace.conf`, but the file has been deleted or renamed.

**Behavior:** The script emits a clear error ("config file not found: /path/to/workspace.conf") and exits with code 1. It does not fall through to lace defaults.

**Rationale:** When `LACE_WORKSPACE_CONF` is explicitly set, the caller has declared "use this config." Silently falling through to lace defaults would be dangerous: `REPO_ROOT` would point to the lace project instead of dotfiles, `devcontainer up` would target the wrong workspace, and the user would get no indication of the misconfiguration. Fail-fast is the correct behavior for an explicitly provided path.

### Forward Compatibility of Config Files

**Trigger:** A future version of `open-workspace` adds new config variables (e.g., `SSH_PROXY`, `MUX_TIMEOUT`) that older `.lace/workspace.conf` files do not define.

**Behavior:** The `${VAR:-default}` pattern ensures that any variable not set by the config file falls back to its built-in default. Older config files continue to work without modification.

**Mitigation:** This is handled by design. The config file format is additive-only: new variables get defaults, existing variables retain their meaning. No versioning mechanism is needed.

## Test Plan

### Testing Strategy

The critical acceptance criterion is that the refactored scripts produce identical behavior to the current scripts. Since the launcher interacts with Docker, SSH, and WezTerm GUI, testing is primarily manual end-to-end verification. Tests are organized per-phase (see each phase's "Testing & Validation" section above for detailed commands).

This section provides a summary checklist and cross-cutting test scenarios that span multiple phases.

### Behavioral Equivalence Checklist

Each test references the detailed commands in the per-phase testing sections.

#### Lace Backward Compatibility (Phase 1)

| # | Scenario | Test Ref | Pass Criteria |
|---|----------|----------|---------------|
| 1 | Fresh start: WezTerm window opens | Test 1.1 | Port 2222, user node, domain lace |
| 2 | Reconnect: prompt appears | Test 1.2 | "container is already running" message |
| 3 | Rebuild: container rebuilt | Test 1.3 | `--rebuild` triggers full rebuild |
| 4 | Piped mode: stdin JSON processed | Test 1.4 | Reads JSON, polls SSH, opens WezTerm |
| 5 | No config: defaults apply | Test 1.5 | Identical to pre-change behavior |
| 6 | Config loaded from env var | Test 1.6 | Custom SSH_PORT and DOMAIN_NAME used |
| 7 | REPO_ROOT resolves correctly | Test 1.7 | Points to config's project, not lace |

#### Dotfiles Behavioral Equivalence (Phase 2)

| # | Scenario | Test Ref | Pass Criteria |
|---|----------|----------|---------------|
| 1 | Fresh start: WezTerm window opens | Test 2.1 | Port 2223, user vscode, domain dotfiles |
| 2 | Reconnect: prompt appears | Test 2.2 | Connects to dotfiles, not lace |
| 3 | Rebuild: container rebuilt | Test 2.3 | `--rebuild` triggers full rebuild |
| 4 | Pane detection: existing pane found | Test 2.4 | Uses `file:///workspaces/` prefix |
| 5 | Mux server: auto-started | Test 2.5 | Detects missing mux, starts it |
| 6 | Log file path: derived from domain | Test 2.10 | `/tmp/open-dotfiles-workspace-wezterm.log` |
| 7 | Troubleshooting: domain in message | Test 2.11 | "ensure WezTerm config has 'dotfiles' SSH domain" |

#### Cross-Project Isolation (Phase 2)

| # | Scenario | Test Ref | Pass Criteria |
|---|----------|----------|---------------|
| 1 | Both containers running, lace connects to lace | Test 2.9 | Port 2222, domain lace |
| 2 | Both containers running, dotfiles connects to dotfiles | Test 2.9 | Port 2223, domain dotfiles |
| 3 | known_hosts has entries for both ports | Test 2.9 | `[localhost]:2222` and `[localhost]:2223` |
| 4 | WezTerm pane list shows both CWD prefixes | Test 2.9 | Both `/workspace/` and `/workspaces/` |

#### Error Path Coverage

| # | Scenario | Test Ref | Expected Exit Code | Expected Message |
|---|----------|----------|--------------------|------------------|
| 1 | Missing SSH key | Test 1.8 | 1 | "SSH key not found at ..." |
| 2 | Invalid config syntax | Test 1.9 | non-zero | Bash syntax error + traceback |
| 3 | wezterm not on PATH | Test 1.10 | 1 | "wezterm not found on PATH" |
| 4 | Invalid JSON on stdin | Test 1.11 | 2 | "failed to find JSON output" |
| 5 | SSH timeout | Test 1.11 | 3 | "SSH connectivity timeout" |
| 6 | Lace checkout not found | Test 2.6 | 1 | "lace not found at ..." |
| 7 | Missing workspace.conf (fail-fast) | Test 2.7 | 1 | "config file not found: ..." |
| 8 | Missing dotfiles SSH key | Test 2.8 | 1 | "SSH key not found at ..." |

### Config Loading Verification

Config loading is verified by observing runtime log messages rather than a `--help` flag (which prints static header comments). The three priority levels are tested:

```bash
# Priority 1: LACE_WORKSPACE_CONF environment variable
LACE_WORKSPACE_CONF=/path/to/dotfiles/.lace/workspace.conf ./bin/open-workspace 2>&1 | head -5
# Verify: "waiting for SSH readiness on port 2223"
# Verify: "connecting WezTerm to dotfiles domain"

# Priority 2: Project-local .lace/workspace.conf
# (When the script's own repo has .lace/workspace.conf)
./bin/open-workspace 2>&1 | head -5
# Verify: uses values from .lace/workspace.conf

# Priority 3: Built-in defaults (no config file anywhere)
# (Rename .lace/workspace.conf temporarily if it exists)
./bin/open-workspace 2>&1 | head -5
# Verify: "waiting for SSH readiness on port 2222" (lace default)
# Verify: "connecting WezTerm to lace domain" (lace default)
```

### Adoption Verification (Phase 3)

A third-project adoption walkthrough (Test 3.1) verifies that the template and documentation are sufficient for a new project to adopt the launcher without reading the source code of `open-workspace`.

## Forward Compatibility

### Alignment with Port-Range Discovery

The [port-scanning discovery proposal](2026-02-04-port-scanning-wezterm-discovery.md) defines the strategic direction: projects use ports in the 22425-22499 range, Docker label-based discovery finds them, and `wez-lace-into` or the WezTerm project picker connects to them. The `workspace.conf` approach aligns with this future in several ways:

**What stays the same:**
- The `workspace.conf` file remains the per-project configuration mechanism. The port-range system changes *which port* is used, not *how the config is stored*.
- The thin wrapper pattern remains valid. A project still needs to tell `open-workspace` which SSH key, user, and domain to use.
- `REPO_ROOT` resolution continues to work identically -- Docker labels still use `devcontainer.local_folder=$REPO_ROOT`.

**What changes:**
- `SSH_PORT` in `workspace.conf` transitions from a static value (e.g., `2223`) to either:
  - A dynamically discovered value (read from `lace-discover` at runtime), or
  - A value from the 22425-22499 range assigned in `.lace/devcontainer.json`
- `DOMAIN_NAME` transitions from a static domain name (e.g., `dotfiles`) to a port-based domain format (e.g., `lace:22426`), matching the convention used by `wez-lace-into`.

**Concrete migration path:**

When the port-range system is implemented, `open-workspace` gains a new config variable and a small discovery block:

```bash
# In workspace.conf:
# DISCOVERY_MODE="static"   # Current behavior: use SSH_PORT directly
# DISCOVERY_MODE="discover" # Future: use lace-discover to find the port

# In open-workspace, after loading config:
DISCOVERY_MODE="${DISCOVERY_MODE:-static}"
if [[ "$DISCOVERY_MODE" == "discover" ]]; then
  LACE_DISCOVER="${SCRIPT_DIR}/lace-discover"
  if [[ -x "$LACE_DISCOVER" ]]; then
    # lace-discover outputs: name:port:user:path
    DISCOVERED_PORT="$("$LACE_DISCOVER" | grep "^$(basename "$REPO_ROOT"):" | cut -d: -f2)"
    if [[ -n "$DISCOVERED_PORT" ]]; then
      SSH_PORT="$DISCOVERED_PORT"
      DOMAIN_NAME="lace:${SSH_PORT}"
      info "discovered port $SSH_PORT for $(basename "$REPO_ROOT")"
    else
      info "warning: discovery found no running container for $(basename "$REPO_ROOT"), falling back to static port $SSH_PORT"
    fi
  fi
fi
```

This is additive -- old `workspace.conf` files without `DISCOVERY_MODE` default to `static` and work unchanged. New configs can opt into discovery by adding `DISCOVERY_MODE="discover"`.

### Migration Path from Static Domains to Dynamic Discovery

The transition happens in three stages, each backward-compatible with the previous:

| Stage | SSH_PORT source | DOMAIN_NAME format | workspace.conf change needed |
|---|---|---|---|
| **Current** (this proposal) | Static in workspace.conf | Static string (e.g., `dotfiles`) | None (initial setup) |
| **Port-range adoption** | Static in workspace.conf, but from 22425-22499 range | Port-based (e.g., `lace:22426`) | Update `SSH_PORT` and `DOMAIN_NAME` |
| **Dynamic discovery** | Runtime via `lace-discover` | Port-based (auto-derived) | Add `DISCOVERY_MODE="discover"`, remove `SSH_PORT` |

At no point does an older `workspace.conf` break. The `${VAR:-default}` pattern ensures forward compatibility. A project can adopt port-range at its own pace.

### Third Project Adoption Pattern

When a third project (call it "myproject") wants to use this pattern, the steps are:

1. **Set up devcontainer SSH** (already required for any devcontainer-to-WezTerm connection):
   - Generate SSH key: `ssh-keygen -t ed25519 -f ~/.ssh/myproject_devcontainer -N ""`
   - Configure devcontainer to run sshd on a chosen port
   - Add SSH domain to WezTerm config

2. **Create `.lace/workspace.conf`** in the myproject repo:
   ```bash
   SSH_KEY="$HOME/.ssh/myproject_devcontainer"
   SSH_PORT=2224  # or a port in 22425-22499 range
   SSH_USER="node"
   DOMAIN_NAME="myproject"
   PANE_CWD_PREFIX="file:///workspaces/"
   ```

3. **Create thin wrapper** at `bin/open-myproject-workspace`:
   ```bash
   #!/bin/bash
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   REPO_ROOT="$(dirname "$SCRIPT_DIR")"
   LACE_ROOT="${LACE_ROOT:-$HOME/code/weft/lace}"
   [[ ! -x "$LACE_ROOT/bin/open-workspace" ]] && echo "error: lace not found at $LACE_ROOT" >&2 && exit 1
   export LACE_WORKSPACE_CONF="$REPO_ROOT/.lace/workspace.conf"
   exec "$LACE_ROOT/bin/open-workspace" "$@"
   ```

4. **Test**: `./bin/open-myproject-workspace` -- the generic launcher handles everything.

Total effort: one config file (6 lines) + one wrapper script (7 lines). No forking of the 400-line launcher.

When the port-range system is available, the third project can update its `workspace.conf` to use discovery mode without touching the wrapper or the generic launcher.

## Implementation Phases

### Phase 1: Create Generic `open-workspace` Script

**Pre-conditions:**
- `bin/open-lace-workspace` exists and works for lace (the current 379-line script)
- No `.lace/workspace.conf` exists in the lace repo
- The lace devcontainer is functional with port 2222, user `node`, domain `lace`

**Scope:**
- Create `bin/open-workspace` based on `bin/open-lace-workspace`, adding config loading and parameterization
- Add configuration loading block (env var > project manifest > defaults)
- Replace all hardcoded `"lace"` string literals with `$DOMAIN_NAME` variable
- Replace hardcoded `"file:///workspace/"` with `$PANE_CWD_PREFIX`
- Make `WEZTERM_CONFIG_FILE` export conditional
- Add `REPO_ROOT` override logic for cross-project invocation
- Add the extra troubleshooting line from dotfiles ("ensure WezTerm config has domain configured") for all projects
- Derive `WEZTERM_LOG_FILE` from `DOMAIN_NAME`
- Reduce `bin/open-lace-workspace` to a thin wrapper
- Mark `bin/open-workspace` as executable

**Files modified:**
- `bin/open-workspace` (new)
- `bin/open-lace-workspace` (replaced with wrapper)

#### Exact Code Changes

**Step 1a: Create `bin/open-workspace`**

Copy `bin/open-lace-workspace` to `bin/open-workspace`. Then apply the following modifications:

*Replace the header comment block (lines 1-33):*

```bash
#!/bin/bash
# Open a WezTerm workspace connected to a lace-managed devcontainer.
#
# Usage:
#   devcontainer up --workspace-folder . | ./bin/open-workspace   (piped mode)
#   ./bin/open-workspace                                          (standalone mode)
#   ./bin/open-workspace --rebuild                                (rebuild container)
#
# Configuration:
#   This script reads project-specific settings from a workspace config file.
#   Config is loaded in this priority order:
#     1. $LACE_WORKSPACE_CONF environment variable (explicit override)
#     2. <repo-root>/.lace/workspace.conf (project manifest)
#     3. Built-in defaults (lace values, for backward compatibility)
#
#   Config file format: shell-sourceable key=value pairs. See the
#   "Configuration variables" section below for all supported variables.
#
# Configuration variables:
#   SSH_KEY             Path to SSH key for container access
#                       Default: ~/.ssh/lace_devcontainer
#   SSH_PORT            Host port mapped to container's sshd
#                       Default: 2222
#   SSH_USER            Container user for SSH
#                       Default: node
#   DOMAIN_NAME         WezTerm SSH domain name (must match WezTerm config)
#                       Default: lace
#   PANE_CWD_PREFIX     CWD prefix for detecting existing WezTerm panes
#                       Default: file:///workspace/
#   WEZTERM_CONFIG_FILE Optional WezTerm config file override (leave unset for default)
#   SSH_HOST            SSH host to connect to
#                       Default: localhost
#   MAX_SSH_ATTEMPTS    Maximum SSH readiness polling attempts
#                       Default: 15
#   SSH_RETRY_INTERVAL  Seconds between SSH readiness polls
#                       Default: 1
#   WEZTERM_LOG_FILE    Path for WezTerm log output
#                       Default: /tmp/open-${DOMAIN_NAME}-workspace-wezterm.log
#
# Options:
#   --rebuild, --no-cache   Remove existing container and rebuild image
#
# Prerequisites:
#   - wezterm installed on the host
#   - SSH key pair at the configured SSH_KEY path
#   - devcontainer CLI installed (standalone mode only)
#
# Exit codes:
#   0 - Success (WezTerm window opened)
#   1 - Prerequisite failure (missing tool or SSH key)
#   2 - devcontainer up failure (non-success outcome or JSON parse error)
#   3 - SSH connectivity timeout (sshd not reachable after max retries)
#   4 - wezterm connect failure (mux server not running or connection error)
#
# Design rationale: cdocs/proposals/2026-02-05-dotfiles-bin-launcher-migration.md
```

*Replace the SCRIPT_DIR / REPO_ROOT / configuration constants block (lines 36-48) with the full configuration resolution logic:*

```bash
SCRIPT_NAME="$(basename "$0")"

# --- Resolve script location ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Configuration loading ---
# Priority: env var > project manifest > script-relative defaults
#
# REPO_ROOT determines the project directory for:
#   - devcontainer up --workspace-folder
#   - Docker label filtering (devcontainer.local_folder=$REPO_ROOT)
#   - Troubleshooting messages
#
# When invoked via LACE_WORKSPACE_CONF (cross-project use), REPO_ROOT must
# point to the calling project, not to the lace repo where this script lives.

if [[ -n "${LACE_WORKSPACE_CONF:-}" ]]; then
  # Cross-project invocation: config path explicitly provided
  if [[ ! -f "$LACE_WORKSPACE_CONF" ]]; then
    echo "$(basename "$0"): error: config file not found: $LACE_WORKSPACE_CONF" >&2
    exit 1
  fi
  # Derive REPO_ROOT from config file location
  # Convention: config lives at <project-root>/.lace/workspace.conf
  # Allow explicit override via LACE_WORKSPACE_ROOT for non-standard layouts
  CONF_DIR="$(cd "$(dirname "$LACE_WORKSPACE_CONF")" && pwd)"
  REPO_ROOT="${LACE_WORKSPACE_ROOT:-$(dirname "$CONF_DIR")}"
  # shellcheck source=/dev/null
  source "$LACE_WORKSPACE_CONF"
elif [[ -f "$(dirname "$SCRIPT_DIR")/.lace/workspace.conf" ]]; then
  # Script-local project has a config file
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.lace/workspace.conf"
else
  # No config file: use script's own repo (backward-compatible lace default)
  REPO_ROOT="$(dirname "$SCRIPT_DIR")"
fi

# Apply defaults for any values not set by config
SSH_KEY="${SSH_KEY:-$HOME/.ssh/lace_devcontainer}"
SSH_PORT="${SSH_PORT:-2222}"
SSH_USER="${SSH_USER:-node}"
SSH_HOST="${SSH_HOST:-localhost}"
DOMAIN_NAME="${DOMAIN_NAME:-lace}"
PANE_CWD_PREFIX="${PANE_CWD_PREFIX:-file:///workspace/}"
MAX_SSH_ATTEMPTS="${MAX_SSH_ATTEMPTS:-15}"
SSH_RETRY_INTERVAL="${SSH_RETRY_INTERVAL:-1}"

# Derived values
WEZTERM_LOG_FILE="${WEZTERM_LOG_FILE:-/tmp/open-${DOMAIN_NAME}-workspace-wezterm.log}"

# Optional: set WEZTERM_CONFIG_FILE only if explicitly configured
if [[ -n "${WEZTERM_CONFIG_FILE:-}" ]]; then
  export WEZTERM_CONFIG_FILE
fi
```

*Replace the `--help` handler to reflect new header length:*

```bash
    -h|--help)
      head -55 "${BASH_SOURCE[0]}" | tail -n +2 | sed 's/^# \?//'
      exit 0
      ;;
```

*Replace hardcoded lace strings in Phase E -- existing pane detection (around original line 282-296):*

```bash
# Check for existing WezTerm connection to this project's domain.
# wezterm cli list requires a running host mux (unix_domains config).
# Panes connected to the container have cwd under the configured prefix.
EXISTING_PANE=""
if PANE_LIST="$(timeout 2 wezterm cli list --format json 2>/dev/null)"; then
  if command -v jq &>/dev/null; then
    EXISTING_PANE="$(echo "$PANE_LIST" | jq -r --arg prefix "$PANE_CWD_PREFIX" '[.[] | select(.cwd | startswith($prefix))][0] // empty | .pane_id // empty')"
  else
    # Fallback: grep for configured cwd pattern
    if echo "$PANE_LIST" | grep -q "\"cwd\"\\s*:\\s*\"${PANE_CWD_PREFIX}" 2>/dev/null; then
      EXISTING_PANE="found"
    fi
  fi
fi

if [[ -n "$EXISTING_PANE" ]]; then
  info "existing WezTerm connection to $DOMAIN_NAME domain detected"
```

*Replace hardcoded lace strings in the wezterm connect block (around original lines 345-373):*

```bash
# Connect to the configured domain.
# Redirect wezterm output to a log file to avoid cluttering the terminal with
# xkbcommon/wayland warnings, while still capturing errors for debugging.
info "connecting WezTerm to $DOMAIN_NAME domain..."
info "wezterm output logged to: $WEZTERM_LOG_FILE"
wezterm connect "$DOMAIN_NAME" >"$WEZTERM_LOG_FILE" 2>&1 &
WEZ_PID=$!

# Give wezterm a moment to fail on immediate errors (bad config, SSH rejection)
sleep 2

if ! kill -0 "$WEZ_PID" 2>/dev/null; then
  # Process already exited -- retrieve its exit code
  WEZ_EXIT=0
  wait "$WEZ_PID" 2>/dev/null || WEZ_EXIT=$?
  err "wezterm connect $DOMAIN_NAME failed (exit code: $WEZ_EXIT)"
  # Show log contents to help diagnose the failure
  if [[ -s "$WEZTERM_LOG_FILE" ]]; then
    err "wezterm log output:"
    cat "$WEZTERM_LOG_FILE" >&2
  fi
  err "troubleshooting:"
  err "  - verify mux server: devcontainer exec --workspace-folder $REPO_ROOT -- pgrep -a wezterm"
  err "  - restart mux server: devcontainer exec --workspace-folder $REPO_ROOT -- wezterm-mux-server --daemonize"
  err "  - debug connection: WEZTERM_LOG=debug wezterm connect $DOMAIN_NAME"
  err "  - ensure WezTerm config has '$DOMAIN_NAME' SSH domain configured"
  exit 4
fi
```

Note: The `WEZTERM_LOG_FILE` assignment and the `# NOTE:` comment block about the removed lace-specific wezterm config (around original lines 324-327) are both removed since they are handled by the configuration loading block. The `WEZTERM_LOG_FILE` hardcoded assignment line (`WEZTERM_LOG_FILE="/tmp/open-lace-workspace-wezterm.log"`) is deleted entirely -- the derived value from the config block provides it.

**Step 1b: Replace `bin/open-lace-workspace` with a thin wrapper**

```bash
#!/bin/bash
# Open a WezTerm workspace connected to the lace devcontainer.
# This is a convenience wrapper around bin/open-workspace.
# See bin/open-workspace for full documentation and configuration options.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/open-workspace" "$@"
```

**Step 1c: Optionally create `lace/.lace/workspace.conf`**

Not strictly required (built-in defaults match lace), but useful for explicitness and as a reference example:

```bash
# .lace/workspace.conf - Lace project workspace configuration
#
# This file is sourced by bin/open-workspace. See that script's header
# for all available configuration variables and their defaults.
#
# These values match the built-in defaults, so this file is optional.
# It is provided for reference and to make the configuration explicit.

SSH_KEY="$HOME/.ssh/lace_devcontainer"
SSH_PORT=2222
SSH_USER="node"
DOMAIN_NAME="lace"
PANE_CWD_PREFIX="file:///workspace/"

# WEZTERM_CONFIG_FILE is intentionally unset.
# The personal wezterm config at ~/.config/wezterm/wezterm.lua loads the
# lace.wezterm plugin which pre-registers SSH domains.
```

#### REPO_ROOT Resolution Walkthrough

The `REPO_ROOT` variable is used in four places throughout the script:

1. `devcontainer up --workspace-folder "$REPO_ROOT"` -- must point to the project with the `.devcontainer/`
2. `docker ps --filter "label=devcontainer.local_folder=$REPO_ROOT"` -- Docker labels use the host-side project path
3. Troubleshooting messages referencing `$REPO_ROOT`
4. `devcontainer exec --workspace-folder $REPO_ROOT` -- same as (1)

Resolution by invocation path:

| Invocation | LACE_WORKSPACE_CONF | Config file found? | REPO_ROOT resolves to |
|---|---|---|---|
| `lace/bin/open-workspace` directly | unset | `lace/.lace/workspace.conf` exists | `lace/` (via `dirname $SCRIPT_DIR`) |
| `lace/bin/open-workspace` directly | unset | no config file | `lace/` (via `dirname $SCRIPT_DIR`) |
| `lace/bin/open-lace-workspace` | unset (wrapper does not set it) | depends on `.lace/workspace.conf` | `lace/` (via `dirname $SCRIPT_DIR`) |
| `dotfiles/bin/open-dotfiles-workspace` | set to `dotfiles/.lace/workspace.conf` | yes (env var path) | `dotfiles/` (via `dirname(dirname(CONF))`) |
| `LACE_WORKSPACE_CONF=/custom/path.conf` | set to custom path | yes | custom (via `LACE_WORKSPACE_ROOT` or `dirname(dirname(CONF))`) |

**Post-conditions:**
- `bin/open-workspace` exists, is executable, and contains the full parameterized launcher logic
- `bin/open-lace-workspace` exists, is executable, and contains only the 6-line wrapper
- Running `./bin/open-lace-workspace` with the lace devcontainer produces identical behavior to the pre-change script
- Running `LACE_WORKSPACE_CONF=/path/to/conf ./bin/open-workspace` sources the specified config and resolves `REPO_ROOT` to the config's parent project
- All hardcoded `"lace"` domain references are replaced with `$DOMAIN_NAME`
- All hardcoded `"file:///workspace/"` CWD prefix references are replaced with `$PANE_CWD_PREFIX`
- `WEZTERM_LOG_FILE` is derived as `/tmp/open-${DOMAIN_NAME}-workspace-wezterm.log`
- The troubleshooting line `"ensure WezTerm config has '$DOMAIN_NAME' SSH domain configured"` appears for all projects
- `set -euo pipefail` is maintained
- All exit codes (0-4) are preserved with identical semantics

**Success criteria:**
- `./bin/open-lace-workspace` behavior is identical to before (no config file, defaults apply)
- `./bin/open-workspace` with no config produces lace-default behavior
- `./bin/open-workspace` with `LACE_WORKSPACE_CONF` pointed at a test config uses those values
- All existing exit codes and error messages preserved

**Constraints:**
- Do not modify `devcontainer.json` or any WezTerm Lua config
- Do not change the set of prerequisites or dependencies
- Bash-only, no new tool requirements
- `set -euo pipefail` must be maintained

#### Phase 1 Testing & Validation

**Test 1.1: Lace backward compatibility -- full workflow**

Pre-condition: Lace devcontainer is not running.

```bash
# From the lace repo root
cd ~/code/weft/lace

# Run the wrapper (should behave identically to old script)
./bin/open-lace-workspace

# Expected: devcontainer starts, SSH polling on port 2222, WezTerm opens with domain "lace"
# Verify: WezTerm window appears, terminal is inside /workspace/lace
```

**Test 1.2: Lace backward compatibility -- reconnect flow**

Pre-condition: Lace devcontainer IS running from Test 1.1.

```bash
./bin/open-lace-workspace

# Expected: "container is already running" message, reconnect/rebuild/quit prompt
# Choose [r]: should skip devcontainer up, go straight to SSH poll + WezTerm connect
```

**Test 1.3: Lace backward compatibility -- rebuild flow**

```bash
./bin/open-lace-workspace --rebuild

# Expected: container removed, image rebuilt, SSH poll, WezTerm opens
```

**Test 1.4: Lace backward compatibility -- piped mode**

```bash
devcontainer up --workspace-folder ~/code/weft/lace | ./bin/open-lace-workspace

# Expected: reads JSON from stdin, validates outcome, SSH poll, WezTerm opens
```

**Test 1.5: Generic script uses defaults when no config exists**

```bash
# Temporarily ensure no .lace/workspace.conf exists
ls ~/code/weft/lace/.lace/workspace.conf 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"

# Run the generic script directly
./bin/open-workspace

# Expected: identical to open-lace-workspace (port 2222, user node, domain lace)
# Verify: log message says "waiting for SSH readiness on port 2222"
# Verify: log message says "connecting WezTerm to lace domain"
```

**Test 1.6: Generic script loads config from LACE_WORKSPACE_CONF**

```bash
# Create a temporary test config
mkdir -p /tmp/test-project/.lace
cat > /tmp/test-project/.lace/workspace.conf << 'TESTEOF'
SSH_KEY="$HOME/.ssh/lace_devcontainer"
SSH_PORT=9999
SSH_USER="testuser"
DOMAIN_NAME="testproject"
PANE_CWD_PREFIX="file:///workspaces/"
TESTEOF

# Run with the test config (will fail to connect, but verifies config loading)
LACE_WORKSPACE_CONF=/tmp/test-project/.lace/workspace.conf ./bin/open-workspace 2>&1 | head -5

# Expected: "waiting for SSH readiness on port 9999" (confirms SSH_PORT loaded)
# Expected: references to "testproject" domain (confirms DOMAIN_NAME loaded)
# Expected: REPO_ROOT resolves to /tmp/test-project (check troubleshooting messages)

# Cleanup
rm -rf /tmp/test-project
```

**Test 1.7: REPO_ROOT resolution for cross-project invocation**

```bash
# Verify REPO_ROOT points to the config's project, not lace
mkdir -p /tmp/cross-project/.lace
cat > /tmp/cross-project/.lace/workspace.conf << 'TESTEOF'
SSH_PORT=9999
DOMAIN_NAME="cross"
TESTEOF

# The script will fail (no container), but error messages reveal REPO_ROOT
LACE_WORKSPACE_CONF=/tmp/cross-project/.lace/workspace.conf ./bin/open-workspace 2>&1 || true

# Expected: error messages reference /tmp/cross-project (not ~/code/weft/lace)
# Look for: "devcontainer up --workspace-folder /tmp/cross-project"
# Look for: "devcontainer.local_folder=/tmp/cross-project"

rm -rf /tmp/cross-project
```

**Test 1.8: Error path -- missing SSH key**

```bash
mkdir -p /tmp/nokey-project/.lace
cat > /tmp/nokey-project/.lace/workspace.conf << 'TESTEOF'
SSH_KEY="/nonexistent/path/to/key"
TESTEOF

LACE_WORKSPACE_CONF=/tmp/nokey-project/.lace/workspace.conf ./bin/open-workspace 2>&1
# Expected: exit code 1, "SSH key not found at /nonexistent/path/to/key"

rm -rf /tmp/nokey-project
```

**Test 1.9: Error path -- invalid config file syntax**

```bash
mkdir -p /tmp/badconf-project/.lace
echo 'SSH_PORT=2222; if [[ bogus' > /tmp/badconf-project/.lace/workspace.conf

LACE_WORKSPACE_CONF=/tmp/badconf-project/.lace/workspace.conf ./bin/open-workspace 2>&1
# Expected: bash syntax error referencing the config file, script aborts (set -e)

rm -rf /tmp/badconf-project
```

**Test 1.10: Error path -- wezterm not installed**

```bash
# Temporarily hide wezterm from PATH
PATH_BACKUP="$PATH"
PATH="$(echo "$PATH" | tr ':' '\n' | grep -v wezterm | tr '\n' ':')"
./bin/open-workspace 2>&1
# Expected: exit code 1, "wezterm not found on PATH"
PATH="$PATH_BACKUP"
```

**Test 1.11: Regression -- exit codes preserved**

```bash
# Exit 1: missing prerequisite (tested in 1.8 and 1.10)
# Exit 2: devcontainer up failure -- test by providing invalid JSON via pipe
echo '{"not":"valid"}' | ./bin/open-workspace 2>&1; echo "Exit: $?"
# Expected: exit code 2, "failed to find JSON output in stdin"

# Exit 3: SSH timeout -- set impossible port with 1 retry
mkdir -p /tmp/timeout-test/.lace
cat > /tmp/timeout-test/.lace/workspace.conf << 'TESTEOF'
SSH_PORT=19999
MAX_SSH_ATTEMPTS=1
SSH_RETRY_INTERVAL=0
TESTEOF
# Need a running container for this to get past Phase B, so test with piped mode:
echo '{"outcome":"success"}' | LACE_WORKSPACE_CONF=/tmp/timeout-test/.lace/workspace.conf ./bin/open-workspace 2>&1; echo "Exit: $?"
# Expected: exit code 3, "SSH connectivity timeout after 1 attempts"

rm -rf /tmp/timeout-test
```

**Test 1.12: Regression -- WEZTERM_LOG_FILE derived correctly**

```bash
# With default config (domain=lace):
./bin/open-workspace 2>&1 | grep "logged to"
# Expected: "wezterm output logged to: /tmp/open-lace-workspace-wezterm.log"

# With custom domain:
mkdir -p /tmp/logtest/.lace
echo 'DOMAIN_NAME="myproj"' > /tmp/logtest/.lace/workspace.conf
LACE_WORKSPACE_CONF=/tmp/logtest/.lace/workspace.conf ./bin/open-workspace 2>&1 | grep "logged to" || true
# Expected: "wezterm output logged to: /tmp/open-myproj-workspace-wezterm.log"

rm -rf /tmp/logtest
```

---

### Phase 2: Migrate Dotfiles to Use Lace's Generic Launcher

**Pre-conditions:**
- Phase 1 is complete: `lace/bin/open-workspace` exists and is tested
- `dotfiles/bin/open-dotfiles-workspace` exists as the current 374-line script
- The dotfiles devcontainer is functional with port 2223, user `vscode`, domain `dotfiles`
- Lace checkout exists at `~/code/weft/lace` (or a known path)

**Scope:**
- Create `dotfiles/.lace/workspace.conf` with dotfiles-specific configuration
- Replace `dotfiles/bin/open-dotfiles-workspace` (374 lines) with a thin wrapper (~15 lines)
- Commit the `.lace/workspace.conf` file (project config is not secret)

**Files modified (in dotfiles repo):**
- `.lace/workspace.conf` (new)
- `bin/open-dotfiles-workspace` (replaced with wrapper)

#### Exact Code Changes

**Step 2a: Create `dotfiles/.lace/workspace.conf`**

```bash
# .lace/workspace.conf - Dotfiles project workspace configuration
#
# This file is sourced by lace's bin/open-workspace to configure
# devcontainer-to-WezTerm workspace connections.
#
# See ~/code/weft/lace/bin/open-workspace for all available
# configuration variables and their defaults.

# SSH key for container access (different from lace to allow concurrent use)
SSH_KEY="$HOME/.ssh/dotfiles_devcontainer"

# Host port mapped to container's sshd (port 2222 inside container)
# Uses 2223 to avoid conflict with lace's 2222
SSH_PORT=2223

# Container user (dotfiles devcontainer uses vscode, not node)
SSH_USER="vscode"

# WezTerm SSH domain name (must match WezTerm config's ssh_domains entry)
DOMAIN_NAME="dotfiles"

# CWD prefix for detecting existing WezTerm panes connected to this container.
# The dotfiles devcontainer mounts at /workspaces/ (devcontainer default),
# unlike lace which mounts at /workspace/ (custom).
PANE_CWD_PREFIX="file:///workspaces/"

# WEZTERM_CONFIG_FILE is intentionally unset.
# The user's default WezTerm config should define the "dotfiles" SSH domain.
```

**Step 2b: Replace `dotfiles/bin/open-dotfiles-workspace` with thin wrapper**

```bash
#!/bin/bash
# Open a WezTerm workspace connected to the dotfiles devcontainer.
# Delegates to lace's generic workspace launcher.
#
# Requires lace checkout at ~/code/weft/lace (or set LACE_ROOT).
# Configuration is read from .lace/workspace.conf in this repo.
#
# See ~/code/weft/lace/bin/open-workspace for full documentation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LACE_ROOT="${LACE_ROOT:-$HOME/code/weft/lace}"

if [[ ! -x "$LACE_ROOT/bin/open-workspace" ]]; then
  echo "$(basename "$0"): error: lace not found at $LACE_ROOT" >&2
  echo "Set LACE_ROOT to your lace checkout path" >&2
  exit 1
fi

export LACE_WORKSPACE_CONF="$REPO_ROOT/.lace/workspace.conf"
exec "$LACE_ROOT/bin/open-workspace" "$@"
```

#### workspace.conf Format Reference

The `.lace/workspace.conf` file is a shell-sourceable (bash) configuration file. It is `source`d by `open-workspace` before any internal state is established. The format is:

```
# Comments start with #
VARIABLE_NAME="value"           # String values (quoting optional for simple strings)
VARIABLE_NAME=$HOME/path        # Shell expansions are evaluated
VARIABLE_NAME=2222              # Numeric values
# VARIABLE_NAME="..."          # Commented-out = use built-in default
```

Side-by-side comparison of the two concrete configurations:

| Variable | `lace/.lace/workspace.conf` | `dotfiles/.lace/workspace.conf` |
|---|---|---|
| `SSH_KEY` | `$HOME/.ssh/lace_devcontainer` | `$HOME/.ssh/dotfiles_devcontainer` |
| `SSH_PORT` | `2222` | `2223` |
| `SSH_USER` | `node` | `vscode` |
| `DOMAIN_NAME` | `lace` | `dotfiles` |
| `PANE_CWD_PREFIX` | `file:///workspace/` | `file:///workspaces/` |
| `WEZTERM_CONFIG_FILE` | *(unset)* | *(unset)* |

**Post-conditions:**
- `dotfiles/.lace/workspace.conf` exists with the six configuration values above
- `dotfiles/bin/open-dotfiles-workspace` is reduced from 374 lines to ~20 lines
- Running `./bin/open-dotfiles-workspace` from the dotfiles repo produces identical behavior to the old 374-line script
- The wrapper fails gracefully with a clear error message if lace is not found

**Success criteria:**
- `./bin/open-dotfiles-workspace` from dotfiles repo produces identical behavior to the current 374-line script
- SSH connects on port 2223 as user `vscode` to domain `dotfiles`
- Existing pane detection uses `file:///workspaces/` prefix
- Error when lace checkout is not found at expected path

**Constraints:**
- The dotfiles wrapper must degrade gracefully if lace is not available
- Do not modify any lace files in this phase

**Dependencies:** Phase 1 must be complete.

#### Phase 2 Testing & Validation

**Test 2.1: Dotfiles full workflow**

Pre-condition: Dotfiles devcontainer is not running.

```bash
cd ~/code/personal/dotfiles

# Run the new thin wrapper
./bin/open-dotfiles-workspace

# Expected: devcontainer starts, SSH polling on port 2223, WezTerm opens with domain "dotfiles"
# Verify: WezTerm window appears
# Verify: terminal user is "vscode" (run `whoami` in the opened terminal)
# Verify: workspace is at /workspaces/dotfiles (run `pwd` in the opened terminal)
```

**Test 2.2: Dotfiles reconnect flow**

Pre-condition: Dotfiles devcontainer IS running from Test 2.1.

```bash
./bin/open-dotfiles-workspace

# Expected: "container is already running" message, reconnect/rebuild/quit prompt
# Choose [r]: should skip devcontainer up, go straight to SSH poll + WezTerm connect
# Verify: connects to dotfiles (port 2223), not lace (port 2222)
```

**Test 2.3: Dotfiles rebuild flow**

```bash
./bin/open-dotfiles-workspace --rebuild

# Expected: container removed, image rebuilt, SSH poll on 2223, WezTerm opens
```

**Test 2.4: Dotfiles pane detection**

Pre-condition: Dotfiles WezTerm window is already open from a previous test.

```bash
./bin/open-dotfiles-workspace

# Expected: "existing WezTerm connection to dotfiles domain detected"
# Verify: the pane detection prompt appears ([o] Open new / [q] Quit)
# This confirms PANE_CWD_PREFIX="file:///workspaces/" is working
```

**Test 2.5: Dotfiles mux server detection**

```bash
# Stop the mux server inside the container
docker exec "$(docker ps -q --filter 'label=devcontainer.local_folder=/home/mjr/code/personal/dotfiles')" pkill -f wezterm-mux-server 2>/dev/null || true

./bin/open-dotfiles-workspace
# Choose [r] to reconnect

# Expected: "wezterm-mux-server not detected in container; starting..."
# Followed by successful WezTerm connect
```

**Test 2.6: Error path -- lace checkout not found**

```bash
LACE_ROOT=/nonexistent/path ./bin/open-dotfiles-workspace 2>&1
# Expected: exit code 1
# Expected: "error: lace not found at /nonexistent/path"
# Expected: "Set LACE_ROOT to your lace checkout path"
```

**Test 2.7: Error path -- missing .lace/workspace.conf**

```bash
# Temporarily rename the config
mv ~/code/personal/dotfiles/.lace/workspace.conf ~/code/personal/dotfiles/.lace/workspace.conf.bak

./bin/open-dotfiles-workspace 2>&1; echo "Exit: $?"

# Expected: exit code 1
# Expected: "error: config file not found: /home/mjr/code/personal/dotfiles/.lace/workspace.conf"
# The script should fail-fast rather than silently falling through to lace defaults.
# (LACE_WORKSPACE_CONF is set by the wrapper, so a missing file is an explicit error.)

# Restore
mv ~/code/personal/dotfiles/.lace/workspace.conf.bak ~/code/personal/dotfiles/.lace/workspace.conf
```

**Test 2.8: Error path -- missing SSH key for dotfiles**

```bash
# Temporarily rename the key
mv ~/.ssh/dotfiles_devcontainer ~/.ssh/dotfiles_devcontainer.bak 2>/dev/null

./bin/open-dotfiles-workspace 2>&1
# Expected: exit code 1, "SSH key not found at ~/.ssh/dotfiles_devcontainer"

# Restore
mv ~/.ssh/dotfiles_devcontainer.bak ~/.ssh/dotfiles_devcontainer 2>/dev/null
```

**Test 2.9: Cross-project isolation -- both containers running**

Pre-condition: Both lace and dotfiles devcontainers are running.

```bash
# Connect to lace
cd ~/code/weft/lace && ./bin/open-lace-workspace
# Expected: port 2222, user node, domain lace

# Connect to dotfiles
cd ~/code/personal/dotfiles && ./bin/open-dotfiles-workspace
# Expected: port 2223, user vscode, domain dotfiles

# Verify no cross-contamination:
# 1. Check known_hosts has entries for both [localhost]:2222 and [localhost]:2223
grep '\[localhost\]:2222' ~/.ssh/known_hosts
grep '\[localhost\]:2223' ~/.ssh/known_hosts

# 2. Check WezTerm pane list shows both connections with different CWD prefixes
wezterm cli list --format json 2>/dev/null | python3 -m json.tool | grep cwd
# Expected: both "file:///workspace/" (lace) and "file:///workspaces/" (dotfiles) entries
```

**Test 2.10: Regression -- verify WEZTERM_LOG_FILE for dotfiles**

```bash
./bin/open-dotfiles-workspace 2>&1 | grep "logged to"
# Expected: "wezterm output logged to: /tmp/open-dotfiles-workspace-wezterm.log"
# (Not /tmp/open-lace-workspace-wezterm.log)
```

**Test 2.11: Regression -- verify troubleshooting message includes domain**

```bash
# Force a wezterm connect failure by stopping the mux server
docker exec "$(docker ps -q --filter 'label=devcontainer.local_folder=/home/mjr/code/personal/dotfiles')" pkill -f wezterm-mux-server 2>/dev/null

# Feed a success outcome to skip devcontainer up, let it reach wezterm connect
echo '{"outcome":"success"}' | ./bin/open-dotfiles-workspace 2>&1 || true
# Expected in troubleshooting output:
# "ensure WezTerm config has 'dotfiles' SSH domain configured"
```

---

### Phase 3: Documentation and Adoption Template

**Pre-conditions:**
- Phase 1 and Phase 2 are complete and tested
- Both lace and dotfiles workflows are verified working

**Scope:**
- Add a comment header to `bin/open-workspace` documenting the config file format (done in Phase 1 already; verify completeness)
- Create a template `.lace/workspace.conf.example` in the lace repo showing all available options
- Update the header comments in the thin wrappers to point to `open-workspace` for full docs

**Files modified:**
- `bin/open-workspace` (header comments, verification only -- already done in Phase 1)
- `.lace/workspace.conf.example` (new, template)

#### Exact Code Changes

**Step 3a: Create `.lace/workspace.conf.example`**

```bash
# .lace/workspace.conf.example - Template for project workspace configuration
#
# Copy this file to your project's .lace/workspace.conf and customize:
#   mkdir -p .lace
#   cp ~/code/weft/lace/.lace/workspace.conf.example .lace/workspace.conf
#
# Then create a thin wrapper script (see bin/open-lace-workspace for an example).
#
# This file is sourced by lace's bin/open-workspace. Shell expansions work.
# Only set variables that differ from the defaults shown below.

# --- Required: these typically differ per project ---

# SSH key for container access
# Default: $HOME/.ssh/lace_devcontainer
# SSH_KEY="$HOME/.ssh/myproject_devcontainer"

# Host port mapped to container's sshd (port 2222 inside container)
# Default: 2222
# SSH_PORT=2222

# Container user for SSH
# Default: node
# SSH_USER="node"

# WezTerm SSH domain name (must match a WezTerm ssh_domains entry)
# Default: lace
# DOMAIN_NAME="myproject"

# CWD prefix for detecting existing WezTerm panes connected to this container
# Default: file:///workspace/
# The value depends on your devcontainer's workspaceFolder setting:
#   /workspace/myproject  -> "file:///workspace/"
#   /workspaces/myproject -> "file:///workspaces/"
# PANE_CWD_PREFIX="file:///workspace/"

# --- Optional: these rarely need changing ---

# SSH host to connect to
# Default: localhost
# SSH_HOST="localhost"

# Maximum SSH readiness polling attempts
# Default: 15
# MAX_SSH_ATTEMPTS=15

# Seconds between SSH readiness polls
# Default: 1
# SSH_RETRY_INTERVAL=1

# Path for WezTerm log output
# Default: /tmp/open-${DOMAIN_NAME}-workspace-wezterm.log
# WEZTERM_LOG_FILE="/tmp/myproject-wezterm.log"

# WezTerm config file override (leave unset to use user's default config)
# Default: (unset)
# WEZTERM_CONFIG_FILE="/path/to/custom/wezterm.lua"
```

**Post-conditions:**
- `.lace/workspace.conf.example` exists in the lace repo with all configuration variables documented
- A developer can adopt the launcher by following the instructions in the example file header
- All variables include their default values and explanatory comments

**Success criteria:**
- A new project can adopt the launcher by creating `.lace/workspace.conf` and a thin wrapper, following the template
- All configuration options are documented with descriptions and defaults

**Constraints:**
- No behavioral changes in this phase, documentation only

#### Phase 3 Testing & Validation

**Test 3.1: Third-project adoption walkthrough**

Verify the template is sufficient for a new project by simulating adoption:

```bash
# Create a mock project
mkdir -p /tmp/mock-project/.lace /tmp/mock-project/bin

# Copy the example and customize
cp ~/code/weft/lace/.lace/workspace.conf.example /tmp/mock-project/.lace/workspace.conf

# Edit to set project-specific values (simulate a real project)
cat > /tmp/mock-project/.lace/workspace.conf << 'EOF'
SSH_KEY="$HOME/.ssh/mock_devcontainer"
SSH_PORT=2224
SSH_USER="developer"
DOMAIN_NAME="mock"
PANE_CWD_PREFIX="file:///workspaces/"
EOF

# Create a thin wrapper following the pattern
cat > /tmp/mock-project/bin/open-mock-workspace << 'WRAPPER'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
LACE_ROOT="${LACE_ROOT:-$HOME/code/weft/lace}"

if [[ ! -x "$LACE_ROOT/bin/open-workspace" ]]; then
  echo "$(basename "$0"): error: lace not found at $LACE_ROOT" >&2
  exit 1
fi

export LACE_WORKSPACE_CONF="$REPO_ROOT/.lace/workspace.conf"
exec "$LACE_ROOT/bin/open-workspace" "$@"
WRAPPER
chmod +x /tmp/mock-project/bin/open-mock-workspace

# Test that config loads (will fail to connect, but verifies parameterization)
/tmp/mock-project/bin/open-mock-workspace 2>&1 | head -3
# Expected: references to port 2224, domain "mock", SSH key "mock_devcontainer"
# Expected: REPO_ROOT resolves to /tmp/mock-project

rm -rf /tmp/mock-project
```

**Test 3.2: Documentation completeness**

```bash
# Verify all variables in the example appear in open-workspace's header
grep '^#   [A-Z_]' ~/code/weft/lace/bin/open-workspace | awk '{print $2}' | sort > /tmp/doc-vars
grep '^# [A-Z_]' ~/code/weft/lace/.lace/workspace.conf.example | sed 's/^# //' | cut -d= -f1 | sort > /tmp/example-vars

diff /tmp/doc-vars /tmp/example-vars
# Expected: no differences (every documented variable has an example entry)

rm -f /tmp/doc-vars /tmp/example-vars
```

## Open Questions

1. **Should `.lace/workspace.conf` be committed or gitignored?** For dotfiles, the config is project-specific and should be committed. For lace itself, the defaults are built into the script, so no config file is needed. Other projects may vary. Recommend: commit it (project config is not secret), but note that SSH key paths may differ per developer.

2. **Should the generic script live at `bin/open-workspace` or `bin/lace-workspace`?** The `open-workspace` name is more generic and suggests reusability. The `lace-workspace` name clarifies the provenance. This proposal uses `open-workspace`.

3. **Future absorption into `lace` CLI:** The [lace CLI proposal](2026-01-30-packages-lace-devcontainer-wrapper.md) envisions a `lace connect` command. When that materializes, `bin/open-workspace` could become a shim that delegates to `lace connect`, or the generic logic could be absorbed into the CLI. This proposal is compatible with either path.
