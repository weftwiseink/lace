---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-13T09:30:00-08:00
task_list: lace/wez-into
type: report
state: archived
status: result_accepted
tags: [investigation, wez-into, nushell, path, node, error-handling, distribution]
related_to:
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
  - cdocs/reports/2026-02-09-wez-into-packaging-analysis.md
  - cdocs/reports/2026-02-08-wez-into-cli-command-status.md
  - cdocs/reports/2026-02-10-lace-wezterm-setup-status.md
---

# Investigation: `wez-into --start` Failure and Distribution Model

> **BLUF:** `wez-into --start` fails because nushell's `env.nu` does not add
> linuxbrew to PATH, so the co-located `lace` binary (which needs `node`) can't
> run. The fix has two layers: (1) add linuxbrew to nushell's PATH in `env.nu`,
> and (2) harden `wez-into` to detect exit code 127 specifically, validate
> prerequisites before invoking `lace`, and fail fast with actionable messages
> instead of retrying discovery for 20 seconds. The current "installed from
> source" model (nushell `env.nu` adds `lace/bin` to PATH) works for discovery
> but breaks for `--start` because `locate_lace_cli()` prefers the local pnpm
> workspace symlink over the globally-installed `lace` — and the local symlink
> needs `node` on PATH.

## Root Cause Chain

```
User types `wez-into --start` in nushell terminal
  → nushell inherits WezTerm GUI's PATH (no linuxbrew)
  → nushell's env.nu adds: ~/.local/bin, ~/.cargo/bin, lace/bin
  → nushell does NOT add: /home/linuxbrew/.linuxbrew/bin
  → wez-into (bash) inherits nushell's PATH
  → locate_lace_cli() finds packages/lace/bin/lace (co-located, first candidate)
  → that file is a pnpm symlink → ../lib/node_modules/lace/dist/index.js
  → shebang: #!/usr/bin/env node
  → env searches PATH for `node` → NOT FOUND
  → exit code 127: "env: 'node': No such file or directory"
  → wez-into treats this as "lace up might have partially worked"
  → 20 seconds of futile discovery retries
  → confusing error output
```

### Why it works in interactive bash but not nushell

The `.bashrc` adds linuxbrew to PATH — but it's guarded by `[[ $- != *i* ]]` (interactive-only). The `#!/bin/bash` shebang in `wez-into` starts a non-interactive shell, so `.bashrc` isn't sourced. However, when the *parent* shell is interactive bash (e.g., Claude Code's terminal), linuxbrew is already in the inherited PATH. When the parent is nushell, it isn't.

### Why the globally-installed `lace` isn't used

`locate_lace_cli()` checks candidates in order:

1. `$SCRIPT_DIR/../packages/lace/bin/lace` — **found** (pnpm workspace symlink, needs node)
2. `$HOME/code/weft/lace/packages/lace/bin/lace` — same file
3. `/var/home/$(whoami)/code/weft/lace/packages/lace/bin/lace` — same file
4. `command -v lace` — would find `/home/linuxbrew/.linuxbrew/bin/lace` (also needs node, but at least this path implies linuxbrew is on PATH)

All candidates have the same `#!/usr/bin/env node` shebang. The globally-installed one at `/home/linuxbrew/.linuxbrew/bin/lace` would also fail without `node` on PATH. The root problem is PATH, not which binary is selected.

## Error Handling Gaps

### 1. Exit code 127 treated as "might have worked"

Line 130-136 of `wez-into`:
```bash
up_output=$("$lace_cli" up ... 2>&1) || up_exit=$?
if [[ $up_exit -ne 0 ]]; then
    info "warning: lace up exited with code $up_exit (container may still have started)"
```

Exit 127 = "command not found." The container definitively did NOT start. The message "container may still have started" is actively misleading. The script should detect 127 specifically and fail immediately with "node not found on PATH" or "lace runtime interpreter not available."

### 2. 20 seconds of futile retries after certain failure

After exit 127, the script enters a 10-iteration retry loop with `sleep 2` (lines 147-164). This is correct for transient failures (e.g., postStartCommand failing while container is running) but wrong for "interpreter not found." The user waits 20 seconds for an inevitable failure.

### 3. No prerequisite check before invoking lace CLI

`locate_lace_cli()` checks `-x` (executable bit) but not whether the runtime interpreter is available. For a `#!/usr/bin/env node` script, the file is executable but will fail if `node` isn't on PATH.

### 4. Missing `exit` after some `do_connect` calls

At lines 464-471 (single-item picker) and 525-529 (single running project), the script calls `do_connect` without a trailing `exit`. `do_connect` uses `exec` internally, so this works — but if `exec` fails or a future code path doesn't `exit`, the script silently falls through to subsequent code.

### 5. Raw error output instead of structured diagnostics

When `lace up` fails, line 136 dumps raw output via `head -20 >&2`. The user sees `env: 'node': No such file or directory` without context about what that means or how to fix it.

## Current Distribution Model

The "installed from source" model is:

| Component | How it reaches PATH | Works? |
|-----------|-------------------|--------|
| `wez-into` | `env.nu` adds `/var/home/mjr/code/weft/lace/bin` | Yes |
| `lace-discover` | Co-located in same `bin/` directory | Yes |
| `lace` CLI | Globally installed via npm to linuxbrew | Yes in bash, **no in nushell** |
| `node` | `/home/linuxbrew/.linuxbrew/bin/node` | Not on nushell's PATH |

The `env.nu` comment says "Temporary: wez-into prototype lives in lace repo bin/ during testing." The packaging analysis report (2026-02-09) recommended a standalone `weft/wez-into` repo with chezmoi externals, but this was never pursued. The workstream closeout (2026-02-10) deferred all packaging decisions.

## Options

### Option A: Add linuxbrew to nushell's PATH (minimal fix)

Add one line to `env.nu`:
```nu
path add "/home/linuxbrew/.linuxbrew/bin"
```

**Pros:** One-line fix. Solves the immediate problem. Makes all linuxbrew tools (node, npm, lace, etc.) available in nushell.
**Cons:** Does not fix the error handling gaps. Doesn't address the distribution model. Machine-specific path.
**Effort:** Trivial.

### Option B: Harden wez-into error handling (defense in depth)

Improvements to `bin/wez-into`:
1. **Detect exit 127** in `start_and_connect()` — fail immediately with "lace CLI interpreter not found" instead of retrying discovery.
2. **Validate `node` on PATH** in `locate_lace_cli()` when the candidate has a `#!/usr/bin/env node` shebang — return 1 with a diagnostic message if the interpreter is missing.
3. **Add explicit `exit`** after every `do_connect` / `start_and_connect` call to prevent fall-through.
4. **Structured error diagnostics** — when `lace up` fails, classify the failure (interpreter missing, Docker error, postStart failure) and print a targeted message with remediation steps.

**Pros:** Makes wez-into robust regardless of PATH configuration. Better UX for all failure modes.
**Cons:** Does not fix the root PATH issue — node still won't be available to other tools in nushell.
**Effort:** Moderate (focused on the bash script).

### Option C: Both A + B (recommended)

Fix `env.nu` to add linuxbrew (eliminates the root cause) AND harden `wez-into` error handling (defense in depth for future issues).

**Pros:** Fixes the immediate problem AND prevents similar issues. The error handling improvements benefit all users regardless of their PATH setup.
**Cons:** Two repositories to touch (dotfiles + lace).
**Effort:** Moderate.

### Option D: Make wez-into self-contained (no lace CLI dependency for --start)

Instead of calling `lace up` (which needs node), have `wez-into --start` use `docker start <container>` directly for stopped containers — they already have the right configuration baked in from the original `lace up`.

```bash
# Instead of: lace up --workspace-folder <path>
# Use: docker start <container_name>
```

Then run postStart lifecycle hooks via `docker exec` if needed.

**Pros:** Eliminates the node/lace dependency entirely for the restart case. Faster startup (no devcontainer CLI overhead). Pure bash, no runtime interpreter needed.
**Cons:** Doesn't handle first-time creation (still needs `lace up` for that). PostStart hooks would need manual orchestration. Diverges from the devcontainer lifecycle contract.
**Effort:** Moderate-to-high.

## Recommendation

**Option C (A + B combined)** is the right path:

1. **Immediate fix**: Add linuxbrew to `env.nu` — this is missing regardless of wez-into, and any nushell user wanting to use node/npm tools hits this.

2. **Error handling hardening**: The 127-detection and prerequisite validation should be done anyway. A script that spends 20 seconds retrying after "command not found" is a bad user experience that will recur whenever any dependency goes missing.

Option D is worth noting as a future enhancement for the restart-only case, but it's orthogonal to the immediate fix.
