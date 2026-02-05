---
review_of: cdocs/proposals/2026-02-05-dotfiles-nushell-setup.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T12:25:00-08:00
task_list: dotfiles/nushell-migration
type: review
state: live
status: done
tags: [rereview_agent, nushell, shell_config, implementation_detail, test_plan, rollback, gotchas]
---

# Review: Nushell Configuration Setup for Dotfiles (Round 2)

## Summary Assessment

This proposal has been substantially expanded since round 1. All three blocking issues from the prior review (overlay use parse-time error, keybindings overwrite, completions partial overwrite) remain correctly fixed. The new sections -- Nushell-Specific Gotchas, expanded Implementation Phases with concrete steps, detailed Test Plan with runnable commands, and Rollback Plan -- transform this from a design document into an actionable implementation guide. The expanded content is thorough and well-organized. However, the expansion introduces a few new technical concerns: a `$env.config.history` full-record assignment that has the same partial-overwrite risk previously caught for completions, a `sys host` call in the pre_execution hook that may add latency to every command, and a `.chezmoiignore` entry that uses a path nushell history may not actually reside at. Verdict: **Revise** to fix one blocking and several non-blocking issues before implementation.

## Prior Review Status

Round 1 identified 3 blocking and 6 non-blocking issues. Status of each:

| # | Issue | Status |
|---|-------|--------|
| 1 | [blocking] Auto-venv hook overlay use with variable path | **Fixed** -- uses `code:` string pattern |
| 2 | [blocking] Keybindings `=` overwrite | **Fixed** -- uses `++=` |
| 3 | [blocking] Completions partial record overwrite | **Fixed** -- uses individual field assignments |
| 4 | [non-blocking] LESS_TERMCAP ansi -e vs char escape | **Fixed** -- uses `char escape` |
| 5 | [non-blocking] Full history newline | **Fixed** -- uses `$"($entry)\n"` |
| 6 | [non-blocking] Carapace guard in completions.nu | **Fixed** -- conditional `if (which carapace \| is-not-empty)` |
| 7 | [non-blocking] Phase 1 stub files | **Fixed** -- Step 1.7 creates all four stubs |
| 8 | [non-blocking] Nushell breaking-change history note | **Fixed** -- NOTE block added after line 101 |
| 9 | [non-blocking] Starship/carapace init startup perf | **Partially addressed** -- acknowledged in Open Question 6 but not resolved; env.nu still regenerates on every startup |

All blocking issues from round 1 are resolved.

## Section-by-Section Findings

### New Section: Nushell-Specific Gotchas

This is the strongest new addition. Six gotchas are documented with concrete code examples, clear explanations of the failure mode, and workarounds. This section alone will prevent multiple hours of debugging during implementation.

**Non-blocking (Gotcha 3):** The environment variable scoping example claims that `$env.FOO` set inside an `if` block does not propagate to the parent scope. This is a nuanced area in nushell. As of nushell v0.100+, `if` blocks DO propagate environment changes to the calling scope (this changed in nushell 0.93 or thereabouts -- `if`/`match`/`for` blocks are no longer separate scopes for environment variables). The original behavior described was true in older nushell versions. The distinction that matters is between blocks (which do propagate) and closures passed to commands like `each`, `do`, `where` (which do not propagate). The example should be corrected to avoid giving implementers a false mental model.

The accurate version:

```nu
# This DOES work in nushell v0.100+ -- if blocks propagate env
if true {
  $env.FOO = "bar"
}
$env.FOO  # "bar"

# This does NOT work -- closures (in each, do, where, etc.) do not propagate env
[1] | each { |_| $env.FOO = "baz" }
$env.FOO  # still "bar", not "baz"
```

**Non-blocking (Gotcha 5):** The table entry for `ignoreeof` says "There is no config to disable it." In nushell v0.100+, the keybinding system allows rebinding Ctrl-D. The user could add a keybinding for `ctrl+d` that does nothing (or inserts a character) in vi_insert mode. The workaround column should mention this as an option beyond "stop pressing Ctrl-D."

**Non-blocking (Gotcha 6):** The wezterm compatibility section mentions OSC 133 via starship's `[character]` module but does not explain how to enable it. Starship does not emit OSC 133 by default -- nushell's own shell integration (`$env.config.shell_integration`) handles the command boundary markers. This is a minor inaccuracy: the credit should go to nushell's built-in shell integration, not starship.

### New Section: Test Plan (Expanded)

The expanded test plan is significantly more useful than round 1's checklist. Each verification item now includes concrete commands to run and expected outputs. The Phase 1 and Phase 2 verification sections are thorough.

**Non-blocking (Phase 1, Test 4):** The PATH verification command `$env.PATH | where $it =~ ".local/bin"` uses `$it` which is the legacy implicit variable. In nushell v0.100+, the preferred pattern is to use an explicit closure: `$env.PATH | where {|p| $p =~ ".local/bin"}`. The `$it` form still works but is deprecated and may generate warnings in future versions.

**Non-blocking (Phase 2, Test 3):** The auto-venv test instructs `python -m venv test-venv-project/.venv` but notes afterward that `python -m venv` may not generate `activate.nu`. This is important enough that the test should create the venv with `virtualenv` (not `python -m venv`) from the start, since virtualenv reliably generates `activate.nu`. The current test sequence will silently pass the "setup" step but fail at the "verify activation" step with no clear error -- the hook condition simply will not fire. A pre-check step like `ls /tmp/test-venv-project/.venv/bin/activate.nu` immediately after creation would catch this.

**Non-blocking (Phase 2, Test 5 -- ssh-del):** The test writes to `/tmp/test-known-hosts` but `ssh-del` operates on `~/.ssh/known_hosts` directly. There is no way to test `ssh-del` safely without either modifying the function to accept a path parameter or backing up and restoring known_hosts. The test plan should acknowledge this gap and either (a) suggest adding an optional path parameter to `ssh-del` for testability or (b) provide explicit backup/restore steps.

### New Section: Implementation Phases (Expanded)

The phases are now broken into numbered steps with exact commands and file contents. The cross-references to the Proposed Solution sections (e.g., "with the full contents shown in the [env.nu section]") are a good approach that avoids duplication.

**Blocking (Step 1.3 / config.nu -- history record):** The `config.nu` code shown in the Proposed Solution section sets `$env.config.history` as a full record assignment:

```nu
$env.config.history = {
  file_format: sqlite
  max_size: 1_000_000
  sync_on_enter: true
  isolation: false
}
```

This has the same partial-overwrite risk that was identified and fixed for `$env.config.completions` in round 1. The default `$env.config.history` record includes additional fields not listed here (e.g., `max_size` has different semantics depending on format). While the four fields shown are likely the complete set for v0.100+, the safer pattern (consistent with the completions fix) is individual field assignment:

```nu
$env.config.history.file_format = "sqlite"
$env.config.history.max_size = 1_000_000
$env.config.history.sync_on_enter = true
$env.config.history.isolation = false
```

This also matches the pattern already used for completions, keeping the config.nu style internally consistent.

**Non-blocking (Step 1.8 -- chezmoi install script):** The shebang line placement is wrong. The `run_once_before_30-install-nushell.sh` code block shows:

```bash
#!/bin/bash
# run_once_before_30-install-nushell.sh
```

But later in the Chezmoi Integration section, the same script shows the comment before the shebang:

```bash
# run_once_before_30-install-nushell.sh
#!/bin/bash
```

The shebang must be the first line of the file. The implementation phases version (Step 1.8) has it correct; the Chezmoi Integration section's version has the comment first. The Chezmoi Integration section should be updated for consistency.

**Non-blocking (Step 1.9 -- .chezmoiignore):** The entry `.config/nushell/history.sqlite3` assumes nushell stores history in the config directory. As of nushell v0.100+, the default history location is `$nu.data-dir` (typically `~/.local/share/nushell/history.sqlite3`), not `$nu.default-config-dir`. The `.chezmoiignore` entry for the history file may be unnecessary (chezmoi would not manage files under `.local/share/` unless told to), and the path is incorrect if chezmoi is managing `.config/nushell/`. Worth verifying the actual history path with `$nu.history-path` during Phase 1 testing and updating accordingly.

**Non-blocking (Step 2.1 -- carapace manual cache):** The step instructs running `carapace _carapace nushell | save -f ~/.cache/carapace/init.nu` from bash, but `save` is a nushell command. This would need to be run from within nushell, or redirected in bash: `carapace _carapace nushell > ~/.cache/carapace/init.nu`. Minor, but would cause confusion if followed literally from a bash session.

### New Section: Rollback Plan

Well-structured with three escalation levels (quick fix, abandon, parallel). The wezterm config changes table is a nice touch.

**Non-blocking (Scenario 2):** The rollback step "chezmoi apply -v # Removes ~/.config/nushell/" assumes that removing `dot_config/nushell/` from the chezmoi source and running `chezmoi apply` will delete the target files. Chezmoi does not automatically delete target files when source files are removed -- it only manages files that are in the source state. To actually remove the deployed files, the user would need `chezmoi forget ~/.config/nushell` or manual `rm -rf ~/.config/nushell/` after removing the source. The rollback step should include the manual removal.

### Proposed Solution: hooks.nu (Pre-Execution Hook)

**Non-blocking:** The pre_execution hook calls `sys host | get hostname` on every command execution. The `sys host` command queries system information and may introduce measurable latency (tens of milliseconds). For a hook that fires on every single command, this adds up. The bash equivalent uses `$(hostname)` which is a fast binary. Consider caching the hostname in env.nu:

```nu
# In env.nu:
$env._HOSTNAME = (sys host | get hostname)

# In hooks.nu:
let entry = $"(date now | format date '%Y-%m-%d--%H-%M-%S') ($env._HOSTNAME) ($env.PWD) ($cmd)"
```

This eliminates the per-command `sys host` call.

### Proposed Solution: env.nu (PNPM PATH)

**Non-blocking:** The bash config includes a PNPM PATH block (`export PNPM_HOME=...` with PATH prepend). The nushell env.nu does not include this. The executive summary flags this as an open question ("pnpm divergence"). If pnpm is used in the nushell environment, the PATH entry should be added to env.nu's `path add` block:

```nu
path add ($env.HOME | path join ".local/share/pnpm")
```

This is not blocking since the executive summary explicitly defers this decision to the user.

### Document Structure / Consistency

**Non-blocking:** The document is now quite long (1653 lines). The Proposed Solution section (env.nu, config.nu, all scripts/) contains the complete file contents, and then the Implementation Phases section references them by section anchor. This works but creates two sources of truth -- if the code in the Proposed Solution is updated, the Implementation Phases descriptions must also be updated. Consider adding a note at the top of the Implementation Phases section making it clear that the Proposed Solution section is the single source of truth for file contents, and the Phases section is the execution order.

## Verdict

**Revise.** One blocking issue must be resolved:

1. The `$env.config.history` full-record assignment in config.nu has the same partial-overwrite risk previously caught and fixed for completions. It should use individual field assignments for consistency and safety.

The remaining findings are non-blocking improvements that would strengthen the document but do not prevent implementation.

## Action Items

1. **[blocking]** Change `$env.config.history = { ... }` in config.nu to individual field assignments (`$env.config.history.file_format = "sqlite"`, etc.) for consistency with the completions fix and to avoid partial record overwrite.
2. **[non-blocking]** Correct Gotcha 3 (env var scoping): `if` blocks DO propagate env changes in nushell v0.100+. The scoping boundary is closures passed to commands (`each`, `do`, `where`), not `if`/`match`/`for` blocks.
3. **[non-blocking]** Cache hostname in env.nu rather than calling `sys host | get hostname` in the pre_execution hook on every command.
4. **[non-blocking]** Fix .chezmoiignore paths: nushell history lives at `$nu.data-dir` (typically `~/.local/share/nushell/`), not under `.config/nushell/`. Verify with `$nu.history-path` during Phase 1.
5. **[non-blocking]** Fix the Chezmoi Integration section's install script to put the shebang before the comment, matching the Implementation Phases version.
6. **[non-blocking]** In Rollback Scenario 2, add manual `rm -rf ~/.config/nushell/` since `chezmoi apply` does not auto-delete files when source is removed.
7. **[non-blocking]** In Phase 2 Test 3 (auto-venv), use `virtualenv` instead of `python -m venv` for reliable `activate.nu` generation, and add a pre-check for `activate.nu` existence immediately after venv creation.
8. **[non-blocking]** Fix Step 2.1 carapace cache command to use bash redirection (`>`) instead of nushell's `save` command, since the step executes from bash.
9. **[non-blocking]** Correct Gotcha 6: OSC 133 command boundary markers come from nushell's `$env.config.shell_integration`, not from starship's `[character]` module.
10. **[non-blocking]** Update PATH verification in Phase 1 Test 4 to use explicit closure syntax (`where {|p| $p =~ ".local/bin"}`) instead of deprecated `$it`.
