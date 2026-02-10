---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T08:55:00-08:00
task_list: lace/dotfiles-wezterm
type: report
state: archived
status: done
tags: [wezterm, copy-mode, incident, analysis, config-validation, agent-safety]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-02-09T09:10:00-08:00
  round: 1
---

# Incident Analysis: WezTerm Config Broken by Invalid CopyMode ScrollToBottom

> **BLUF:** A background agent shipped a wezterm config that used `{ CopyMode = 'ScrollToBottom' }` inside `act.Multiple` blocks in the `copy_mode` key table. This caused a parse-time failure that left the user's terminal completely unable to load. The root cause is that `ScrollToBottom` is a top-level `KeyAssignment` in wezterm, **not** a valid `CopyModeAssignment` variant. The error originated in a prior analysis report that incorrectly listed `ScrollToBottom` as a CopyMode lifecycle action, and the implementing agent propagated the error without validating the syntax against the running wezterm version. Prevention requires agents to run `wezterm show-keys` and/or `wezterm ls-fonts` as config parse checks before and after making changes.

## Context / Background

### The Incident

On 2026-02-09, a background agent implemented copy mode improvements to `/home/mjr/.config/wezterm/wezterm.lua` based on a proposal (`cdocs/proposals/2026-02-08-wezterm-copy-mode-improvements.md`) which itself was based on an analysis report (`cdocs/reports/2026-02-08-wezterm-copy-mode-analysis.md`).

The agent wrote bindings that used `{ CopyMode = 'ScrollToBottom' }` inside `act.Multiple` blocks in the copy_mode key table. At config parse time, `act.Multiple` validates its argument table entries and rejected this, producing:

```
`ScrollToBottom` is not a valid CopyModeAssignment variant. There are too many
alternatives to list here; consult the documentation!
stack traceback:
        [C]: in field 'Multiple'
        [string "/home/mjr/.config/wezterm/wezterm.lua"]:226: in main chunk
```

Because this error occurred at parse time (line 226, the `y` override inside the top-level config evaluation), wezterm could not load the config at all. The user was left with a broken terminal.

### The Document Chain

1. **Analysis report** (`2026-02-08-wezterm-copy-mode-analysis.md`) -- Listed `ScrollToBottom` under "Available CopyMode Actions > Lifecycle" as a valid `CopyMode` action. This was incorrect.
2. **Proposal** (`2026-02-08-wezterm-copy-mode-improvements.md`) -- Used `{ CopyMode = 'ScrollToBottom' }` in the proposed `y`, `Y`, `q`, and `Escape` overrides, citing the analysis report.
3. **Implementation** -- Copied the syntax from the proposal into the deployed config.
4. **Implementation review** (`2026-02-09-review-of-wezterm-copy-mode-implementation.md`) -- Accepted the implementation without catching the invalid syntax, explicitly calling out `{ CopyMode = 'ScrollToBottom' }` as "correct."

Every agent in the chain propagated the same error without independent verification.

## Key Findings

### 1. `ScrollToBottom` Is NOT a CopyModeAssignment Variant

**Confirmed via wezterm source code** (`config/src/keyassignment.rs`):

- `ScrollToBottom` is a variant of the **top-level `KeyAssignment` enum** (86 variants). It scrolls the viewport to the bottom of the scrollback. The Lua syntax is `act.ScrollToBottom`.
- The `CopyModeAssignment` enum contains ~40 variants for copy mode cursor/selection operations. **`ScrollToBottom` is not among them.**
- The correct CopyMode variant for moving to the bottom of scrollback is `MoveToScrollbackBottom`, which moves the copy-mode cursor (not the viewport scroll position).

The table-construction syntax `{ CopyMode = 'ScrollToBottom' }` attempts to deserialize `'ScrollToBottom'` as a `CopyModeAssignment` variant. Since it is not one, the Lua-to-Rust deserialization fails at the point where `act.Multiple` constructs its action list.

### 2. The Default `y` Binding Does NOT Use ScrollToBottom

Running `wezterm show-keys --lua --key-table copy_mode` on the installed version (20240203-110809-5046fc22) reveals the actual default `y` binding:

```lua
{ key = 'y', mods = 'NONE', action = act.Multiple{
    { CopyTo = 'ClipboardAndPrimarySelection' },
    { CopyMode = 'Close' }
  }
}
```

There is **no** `ScrollToBottom` in the default `y` binding. The default behavior is simply: copy to clipboard, then close copy mode. The viewport scroll position is implicitly restored when copy mode closes.

Searching all default key bindings (`wezterm show-keys --lua`) for `ScrollToBottom` returns **zero results**. This action is not used anywhere in the default key tables for this wezterm version.

### 3. The Docs vs. the Installed Version

The wezterm documentation at [wezterm.org/copymode.html](https://wezterm.org/copymode.html) tracks the `main` branch (nightly builds). The docs page states:

> "The default configuration at the time that these docs were built (which may be more recent than your version of wezterm) is shown below."

It is possible that `{ CopyMode = 'ScrollToBottom' }` was added as a valid CopyModeAssignment variant in a post-20240203 nightly build. The docs may be correct for the nightly, but incorrect for the installed stable release. The analysis report agent likely read the nightly docs without checking the installed version.

**Installed version:** `wezterm 20240203-110809-5046fc22` (stable release from February 2024).

### 4. The Correct Syntax for the Desired Behavior

The goal was "scroll viewport to bottom when exiting copy mode." There are two options:

**Option A: Use the top-level `ScrollToBottom` KeyAssignment.**

```lua
-- Correct: ScrollToBottom as a top-level action, not a CopyMode action
act.Multiple {
  { CopyTo = 'ClipboardAndPrimarySelection' },
  act.ScrollToBottom,
  { CopyMode = 'Close' },
}
```

**Option B: Just use `Close` (the default behavior).**

When copy mode closes, the viewport returns to its pre-copy-mode position (typically the bottom). The explicit `ScrollToBottom` is unnecessary in most cases. The default `y` binding omits it and works correctly.

The currently deployed config (after fix) uses Option B for the `y` binding. The Escape callback uses `{ CopyMode = 'MoveToScrollbackBottom' }`, which is the correct CopyModeAssignment variant (see Finding 5).

### 5. Current Deployed Config Has Been Partially Fixed

The current deployed config at `/home/mjr/.config/wezterm/wezterm.lua` shows that someone (likely the user or a subsequent agent) already fixed the most critical instances. The `y` binding (line 226) no longer uses `ScrollToBottom` -- it uses just `{ CopyMode = 'Close' }`. The Escape callback (line 253) uses `{ CopyMode = 'MoveToScrollbackBottom' }`, which IS a valid CopyModeAssignment variant (the correct CopyMode variant for moving to the bottom of scrollback).

The fix was applied to the top-level `act.Multiple` blocks (which cause parse-time failures) and the callback internals (which would cause runtime failures). The deployed config now loads and functions correctly.

However, the original analysis report and proposal still contain the incorrect syntax, meaning any agent re-implementing from those documents would reproduce the same bug.

## How the Bug Got Through

### Stage 1: Analysis Report (Wrong Information)

The analysis report listed CopyMode actions in a structured table. Under the "Lifecycle" section, it stated:

```markdown
**Lifecycle:**
- `Close` -- exit copy mode
- `ScrollToBottom` -- scroll to bottom of scrollback
```

It also showed the default `y` binding as:

```lua
act.Multiple {
  { CopyTo = 'ClipboardAndPrimarySelection' },
  { CopyMode = 'ScrollToBottom' },
  { CopyMode = 'Close' },
}
```

This was wrong. The agent likely:
- Read the wezterm.org docs (which track nightly, not the installed 20240203 stable)
- Inferred the syntax from doc examples without running `wezterm show-keys` to verify
- Did not cross-reference the CopyModeAssignment Rust enum definition in the wezterm source

### Stage 2: Proposal (Propagated Wrong Information)

The proposal used the analysis report as its source of truth for CopyMode actions. It proposed `y`, `Y`, `q`, and `Escape` overrides all using `{ CopyMode = 'ScrollToBottom' }`. The proposal was reviewed and accepted without catching the error.

### Stage 3: Implementation (No Validation)

The implementing agent wrote the code exactly as specified in the proposal. It did not:
- Run `wezterm show-keys --lua --key-table copy_mode` to see actual default syntax
- Run `wezterm ls-fonts` or `wezterm show-keys` as a config parse check after making changes
- Check `$XDG_RUNTIME_DIR/wezterm/` log files for errors
- Verify that wezterm reloaded successfully after the config change
- Test the actual key bindings in copy mode

### Stage 4: Implementation Review (Missed the Bug)

The implementation review explicitly called out the `y` override with `{ CopyMode = 'ScrollToBottom' }` and stated: "Matches the proposal exactly. The default `y` binding in wezterm uses `CopyTo = 'ClipboardAndPrimarySelection'` with the same scroll+close sequence, so this override makes the behavior explicit without changing it. Correct."

The review validated against the proposal, not against reality. It did not run `wezterm show-keys` to verify.

### Pattern: Trust Chain Without Grounding

The failure mode is a trust chain: report -> proposal -> implementation -> review, where each stage trusted the previous one without independently grounding against the actual system. The original error in the analysis report propagated through every subsequent document and review.

## Prevention: How to Test WezTerm Config Changes

### Available Validation Tools

| Tool | What It Tests | Catches Parse Errors? | Catches Runtime Errors? |
|------|--------------|----------------------|------------------------|
| `wezterm show-keys --lua` | Full config parse + key binding resolution | Yes | No |
| `wezterm show-keys --lua --key-table copy_mode` | Copy mode key table specifically | Yes | No |
| `wezterm ls-fonts` | Full config parse + font resolution | Yes | No |
| `wezterm --config-file <path> ls-fonts` | Parse a specific config file | Yes | No |
| `wezterm cli list` | Verify mux server is running | No (but confirms wezterm is alive) | No |
| `$XDG_RUNTIME_DIR/wezterm/` log files | Runtime errors, warnings | After reload | Yes |
| Debug overlay (`Ctrl+Shift+L`) | Interactive Lua REPL + recent logs | N/A | Yes (visible in logs) |

### Key Validation Commands

**Parse check (fastest -- does the config load without errors?):**
```bash
wezterm ls-fonts 2>&1 | head -1
# Success: prints font info
# Failure: prints Lua error with stack trace
```

**Key table inspection (does the copy_mode table look right?):**
```bash
wezterm show-keys --lua --key-table copy_mode
# Outputs the effective copy_mode key table as Lua
# Compare against expected bindings
```

**Parse check against a specific file (test before deploying):**
```bash
wezterm --config-file /path/to/test-config.lua ls-fonts 2>&1 | head -1
```

**Runtime verification (is wezterm still running after reload?):**
```bash
wezterm cli list
# If wezterm crashed, this will fail to connect to the mux
```

**Log file inspection:**
```bash
# Log files are in $XDG_RUNTIME_DIR/wezterm/ (Linux)
# or $HOME/.local/share/wezterm/ (macOS/Windows)
ls -t $XDG_RUNTIME_DIR/wezterm/wezterm-gui-log-*.txt | head -1 | xargs tail -20
```

### What WezTerm Does NOT Have

- **No `--check` or `--dry-run` flag.** There is no dedicated config validation mode. `ls-fonts` and `show-keys` are the best proxies because they parse the full config as a side effect.
- **No `--validate` subcommand.**
- **No isolated Lua table construction test.** You cannot test a Lua snippet against the wezterm action type system without loading a full config.

## Recommended TDD Workflow for WezTerm Config Changes

Agents making changes to wezterm config files MUST follow this workflow:

### Step 0: Identify the Installed Version

```bash
wezterm --version
# Record this. Docs at wezterm.org may track a NEWER version.
```

### Step 1: Capture Baseline (Before Changes)

```bash
# Save current effective key bindings
wezterm show-keys --lua --key-table copy_mode > /tmp/wez-copy-mode-before.lua

# Save full key dump for reference
wezterm show-keys --lua > /tmp/wez-keys-before.lua

# Verify config parses clean
wezterm ls-fonts 2>&1 | head -3

# Note the most recent log file
ls -t $XDG_RUNTIME_DIR/wezterm/wezterm-gui-log-*.txt | head -1
```

### Step 2: Verify Syntax Against Running Version

Before writing ANY `CopyMode` action, verify it exists in the installed version:

```bash
# Check what CopyMode actions the installed version actually supports
wezterm show-keys --lua --key-table copy_mode | grep -o "CopyMode [^}]*" | sort -u
```

Do NOT trust the wezterm.org docs alone. They track `main`/nightly.

### Step 3: Make Changes to a Temp File First

```bash
cp ~/.config/wezterm/wezterm.lua /tmp/wezterm-test.lua
# Edit /tmp/wezterm-test.lua
```

### Step 4: Validate the Temp File

```bash
wezterm --config-file /tmp/wezterm-test.lua ls-fonts 2>&1 | head -3
# Must show font info, not a Lua error

wezterm --config-file /tmp/wezterm-test.lua show-keys --lua --key-table copy_mode > /tmp/wez-copy-mode-after.lua
# Must produce valid Lua output

diff /tmp/wez-copy-mode-before.lua /tmp/wez-copy-mode-after.lua
# Verify only expected changes
```

### Step 5: Deploy and Verify Reload

```bash
# Deploy
cp /tmp/wezterm-test.lua ~/.config/wezterm/wezterm.lua

# Wezterm auto-reloads on file change. Wait 2 seconds, then:
wezterm cli list
# Must show running windows/tabs (proves wezterm survived the reload)

# Check log for errors
ls -t $XDG_RUNTIME_DIR/wezterm/wezterm-gui-log-*.txt | head -1 | xargs tail -30 | grep -i error
# Must be empty (no new errors)
```

### Step 6: Functional Test

For copy mode changes, actually enter copy mode and test the bindings:
- Press `Alt+C` (or configured copy mode key) to enter copy mode
- Test the specific bindings that were changed
- Verify exit paths (`q`, `Escape`, `Ctrl+C`) all work
- Check wezterm log again for runtime errors

### Critical Rule

**Never deploy a wezterm config change without running `wezterm ls-fonts` or `wezterm show-keys` against the modified file.** If either command produces a Lua error, the config WILL break wezterm on reload.

## Recommendations

1. **Update the analysis report.** Mark `2026-02-08-wezterm-copy-mode-analysis.md` with a correction noting that `ScrollToBottom` is NOT a valid CopyModeAssignment variant in wezterm 20240203, and that the default `y` binding does not include it.

2. **Agent workflow requirement.** Any agent modifying wezterm config must run the Step 4 validation (parse check + key table diff) before deploying. This should be documented as a hard requirement in the proposal's test plan.

3. **Grounding over trust.** Agents writing reports about tool APIs must verify claims against the installed version of the tool, not just web documentation. `wezterm show-keys --lua` is the ground truth for key bindings, not wezterm.org.

4. **Review against reality.** Implementation reviews must include at least one grounding step (running a validation command) rather than only comparing implementation against proposal text.

---

### Sources

- [WezTerm Copy Mode Documentation](https://wezterm.org/copymode.html) (tracks main/nightly, may differ from installed version)
- [ScrollToBottom KeyAssignment](https://wezterm.org/config/lua/keyassignment/ScrollToBottom.html) (top-level KeyAssignment, not CopyMode)
- [MoveToScrollbackBottom CopyMode action](https://wezterm.org/config/lua/keyassignment/CopyMode/MoveToScrollbackBottom.html) (the actual CopyMode variant for bottom-of-scrollback)
- [KeyAssignment enum](https://wezterm.org/config/lua/keyassignment/index.html) (full list of 86 top-level KeyAssignment variants)
- [wezterm show-keys CLI](https://wezterm.org/cli/show-keys.html)
- [WezTerm Configuration Files](https://wezterm.org/config/files.html) (--config-file flag, error handling)
- [WezTerm Troubleshooting](https://wezterm.org/troubleshooting.html) (log file locations, debug overlay)
- [wezterm.gui.default_key_tables()](https://wezterm.org/config/lua/wezterm.gui/default_key_tables.html)
- [config/src/keyassignment.rs](https://github.com/wezterm/wezterm/blob/main/config/src/keyassignment.rs) (CopyModeAssignment enum source)
- Local verification: `wezterm show-keys --lua --key-table copy_mode` on version 20240203-110809-5046fc22

*Report generated: 2026-02-09T08:55:00-08:00*
