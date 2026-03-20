---
review_of: cdocs/proposals/2026-03-20-container-aware-split-panes.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-20T14:00:00-07:00
task_list: wezterm/split-pane-regression
type: review
state: archived
status: done
tags: [self, architecture, test_plan, exec_domain, cwd_gap]
---

# Review (Round 2): Container-Aware Split Panes via ExecDomain

## Summary Assessment

The proposal was substantially revised to use WezTerm's ExecDomain mechanism instead of the original action_callback + GLOBAL cache approach.
This is a fundamentally better design: splits work via native domain inheritance rather than callback interception, removing the need for a `split_pane` helper, GLOBAL metadata lookups at keypress time, or any wezterm.lua binding changes beyond bypass bindings.
The round 1 blocking items (incomplete `port_names` sketch and `get_ssh_args` silent failure) are no longer applicable: the ExecDomain approach eliminates both code paths entirely.
The most significant remaining gap is CWD handling: the proposal acknowledges the loss of wez-into's `cd "$cd_target"` but defers it as a follow-up, despite it being a UX regression users will notice immediately.
Verdict: Revise. Two blocking items remain: CWD loss and an unverified wez-into cold-start domain name reference.

## Prior Review Status

Round 1 had two blocking items:
1. Incomplete `port_names` code sketch in `setup_port_domains`. **Resolved by redesign**: the ExecDomain approach does not need a `port_names` map in `setup_port_domains`; project name resolution is handled by `resolve_port_names` and the discovery cache.
2. Silent `nil` return in `get_ssh_args` when `ssh_key` is absent. **Resolved by redesign**: `get_ssh_args` no longer exists; SSH args are built by `build_ssh_args` in the ExecDomain fixup, which logs a warning and returns `nil` (the fixup then passes through the original command, producing a visible failure rather than a silent fallback to local shell).

## Section-by-Section Findings

### BLUF and Summary

The BLUF is effective: it names the root cause (tab mode on unix domain), the mechanism (ExecDomain with fixup), the key property (domain inheritance), and the UX addition (bypass bindings).
At 4 lines it is appropriately concise for a proposal of this scope.

The Summary clearly distinguishes three things: (a) why tab mode was adopted (SSH domain hot-reload bugs), (b) why ExecDomain is not a return to SSH domains (no mux server), and (c) what ExecDomain adds over raw SSH (domain identity for split inheritance).
This is the most important explanatory work in the proposal and it is done well.
**No issues.**

### Background: Three Domain Types

The Mermaid diagram is clear and the three-way distinction (SSH domain, ExecDomain, raw SSH) is accurately drawn.
The NOTE about wezterm-server still being needed for `hostSshPort` metadata is critical context: it prevents someone from removing the devcontainer feature under the assumption that the mux server is fully unused.

The source locations table accurately lists the three relevant repositories.
**No issues.**

### Section 1: ExecDomain Registration

The `build_ssh_args` function correctly constructs the SSH argument table from GLOBAL-stored plugin opts.
The warning log on missing `ssh_key` addresses the round 1 concern about silent failure: `wezterm.log_warn` fires, the fixup returns the unmodified command, and the pane opens with a visible error rather than silently falling back to a local shell.
This is better than the round 1 approach.

`make_exec_fixup` creates a closure over `port` and `default_user`, with user resolution deferred to spawn time via `wezterm.GLOBAL.lace_port_users`.
This is correct: user data may change between config load (when ExecDomains are registered) and spawn time (when a split actually happens).

`setup_exec_domains` appends to `config.exec_domains` (not replaces), which is correct for composability.
The 75-domain registration matches the existing SSH domain pattern.

Technical accuracy of ExecDomain mechanism: verified against WezTerm's documentation.
`wezterm.exec_domain(name, fixup_fn)` registers a domain; the fixup receives a `SpawnCommand` and returns it (possibly modified).
Setting `cmd.args` in the fixup is the correct way to override the spawned command.
Panes in an ExecDomain have `pane:get_domain_name()` return the domain name, and `CurrentPaneDomain` inheritance causes splits to re-enter the fixup.
All claims in the proposal are accurate.
**No issues in this section itself.**

### Section 2: Connection Metadata in GLOBAL

`resolve_port_names` fills the gap from round 1: it runs a Docker query at config load to populate port-to-project-name mappings.
The function is well-structured and the Docker query format string is correct.

The `apply_to_config` snippet stores both `lace_plugin_opts` (for ExecDomain fixup SSH args) and `lace_port_users` (for per-port user resolution).
The comment notes these are "overwritten on every config eval," which addresses the round 1 non-blocking suggestion about documenting GLOBAL overwrite behavior.
**No issues.**

### Section 3: Picker and wez-into Changes

**Picker change**: `mux_win:spawn_tab({ domain = { DomainName = "lace:" .. port } })` is the correct WezTerm API for spawning into an ExecDomain.
The pane will be on the `lace:<port>` domain and splits will inherit it.
Clean improvement.

**wez-into change**: `wezterm cli spawn --domain-name "lace:$port"` is a supported `wezterm cli` flag.
This simplifies `do_connect` significantly: no SSH arg construction, no key path passing, no user resolution at the CLI level.

**[blocking] CWD loss.**
The current `do_connect` at lines 561-571 of `wez-into` constructs:
```bash
ssh ... user@localhost "cd \"$cd_target\" 2>/dev/null || cd; exec $SHELL -l"
```
where `cd_target` is resolved host-side via `docker inspect` (the `resolve_workspace_folder` function).
With `wezterm cli spawn --domain-name "lace:$port"`, the ExecDomain fixup spawns `ssh ... user@localhost` with no remote command.
The user lands in the container's default directory.

The proposal acknowledges this in the NOTE and in "Edge Cases: wez-into CWD loss" and "Design Decisions: wez-into CWD handling," all of which say "the container's login shell or WORKDIR should handle initial CWD" or "this can be added to the fixup as a follow-up."

This is insufficient.
Not all devcontainers set `WORKDIR` to the workspace directory.
Lace's own devcontainer feature configures `CONTAINER_WORKSPACE_FOLDER` as an env var but does not set the Dockerfile `WORKDIR`.
Many devcontainers use `/home/<user>` as the default CWD.
The current behavior (`cd /workspace/project && exec $SHELL -l`) is an explicit UX guarantee that the shell starts in the workspace.
Losing it is a regression on top of the regression being fixed.

The fix is straightforward: store `lace_port_workspaces[port]` in GLOBAL during `setup_exec_domains` (or in a parallel Docker query), and include `cd <workspace> && exec $SHELL -l` in the SSH args built by `build_ssh_args`.
This should be part of Phase 1 or 2, not a follow-up.

### Section 4: Public Connection Metadata API

`M.get_connection_info(key)` supports lookup by project name or domain name.
This is a useful enrichment for status bar, MCP tools, and scripts.
The function is straightforward and correct.
**No issues.**

### Section 5: wezterm.lua Config Changes

The bypass bindings (`Alt+Shift+HJKL` with `domain = "DefaultDomain"`) are correct.
`"DefaultDomain"` is a valid domain specifier for `SplitPane` and resolves to the unix mux in the default config.

The proposal correctly notes that the existing `format_tab_title` pattern `lace:%d+` matches ExecDomain names (same naming convention).
No changes needed to `format_tab_title`.

The key insight: no `action_callback` is needed for the regular split bindings.
The existing `act.SplitPane` with no domain argument inherits `CurrentPaneDomain`, which for ExecDomain panes re-runs the fixup.
This is significantly simpler than the round 1 approach.
**No issues.**

### Section 6: SSH Domain Naming

Renaming SSH domains to `lace-mux:<port>` is necessary to avoid name collision with ExecDomains.
The proposal correctly identifies this and shows the code change.

**[blocking] wez-into cold-start fallback.**
The current `wez-into` at line 576:
```bash
wezterm connect "lace:$port" --workspace main &>/dev/null &
```
The proposal's Phase 2 item 3 says "Update wez-into cold-start fallback to use `lace-mux:$port`."
The proposal's Section 6 code snippet shows the correct command:
```bash
wezterm connect "lace-mux:$port" --workspace main &>/dev/null &
```
The intent is clear, but this is a critical path: if this line is not updated, cold-start uses an ExecDomain name with `wezterm connect`, which is semantically wrong (`wezterm connect` is for mux domains).
Marking as blocking because this is an easy-to-miss line buried in a fallback path.

Additionally, the wez-into help text at line 624 documents the cold-start command:
```
  wezterm connect lace:<port> --workspace main
```
This should also be updated.
The proposal does not mention help text updates.
**Non-blocking** but should be noted.

### Design Decisions

All four decisions are well-reasoned.

"ExecDomain over action_callback" is the strongest decision: it reduces the solution from "callback + GLOBAL lookup + SSH arg reconstruction + custom split helper + wezterm.lua binding rewrite" to "register ExecDomains + change spawn call."
The proposal articulates this well.

"ExecDomain is NOT SSH domain" is stated clearly and the distinction is repeated in the right places.
This prevents confusion for future readers.

"Keep SSH domains for backward compatibility" is the conservative correct choice.
The SSH domains may be useful if workspace mode is re-enabled.

"DefaultDomain for bypass splits" is more resilient than hardcoding `"unix"`.
**No issues.**

### Edge Cases

The edge cases are well-considered.
"Stale port_users after container restart" correctly identifies the staleness window and the remediation (config reload or picker invocation).
"75 ExecDomain registrations" correctly notes they are lightweight.
"Plugin not loaded" correctly notes the wez-into fallback need.

One edge case not mentioned: what happens if someone manually runs `wezterm cli spawn --domain-name lace:22425` when no container is on that port.
The ExecDomain fixup runs, SSH fails, and the pane shows the SSH connection error.
This is visible and not silent, which is fine.
**Non-blocking.**

### Test Plan

The test plan covers: picker path, wez-into path, bypass bindings, fallback (local tabs), config reload, and cold start.
All scenarios are verifiable by a human operator.

**Missing test: CWD verification.**
No test step verifies that panes (whether from picker, wez-into, or split) start in the workspace directory.
If the CWD blocking item is addressed, add: "After split, run `pwd` and verify it shows the workspace directory."

**Missing test: multi-container scenario.**
All tests assume a single container.
A test with two different projects open should verify that splits in each tab route to the correct container (not cross-contaminating).
**Non-blocking** but recommended.

**Missing test: wez-into `--dry-run` output.**
The proposal changes wez-into's `do_connect` but the dry-run path (line 493-497) still prints the raw SSH command.
A test should verify dry-run reflects the new ExecDomain approach.
**Non-blocking.**

### Verification Methodology

The methodology is solid.
The ExecDomain-specific steps (check log for registration, spawn via CLI, verify domain name) are practical.
The wezterm.lua validation correctly references the CLAUDE.md workflow (ls-fonts, show-keys diff).

Step 3 mentions debug overlay or temporary event handler.
Since `format_tab_title` already resolves ExecDomain names, verifying the tab title shows the project name is sufficient as a quick check.
**Non-blocking.**

### Implementation Phases

The five phases are well-scoped and properly ordered.
Phase 1 (ExecDomain registration) is the foundation; Phase 2 (picker/wez-into) depends on it; Phase 3 (bypass bindings) is independent; Phase 4 (documentation) and Phase 5 (end-to-end testing) follow.

Each phase has verification criteria, which is good.
**No issues.**

### Writing Convention Compliance

Sentence-per-line: followed consistently.
BLUF: present and effective.
NOTE callouts: use correct `NOTE(opus/split-pane-regression)` attribution.
Punctuation: no em-dashes detected; colons used correctly.
Emojis: none.
History-agnostic framing: the "Before/After" comments in Section 3 code blocks are appropriate for a proposal showing a change.

One minor convention note: the frontmatter `first_authored.by` uses `@claude-opus-4-6` rather than the full API model name (e.g., `@claude-opus-4-6-20250116`).
The spec says "Full API-valid model name."
**Non-blocking.**

## Verdict

**Revise.**
The ExecDomain redesign is a strong improvement over the round 1 approach: simpler, more idiomatic, and eliminates the callback complexity.
Two blocking items remain before this is implementation-ready.

## Action Items

1. **[blocking]** Address CWD handling as a Phase 1/2 deliverable rather than deferring it. The ExecDomain fixup should include workspace CWD in the SSH args (e.g., `cd <workspace> 2>/dev/null || cd; exec $SHELL -l`). Store `lace_port_workspaces[port]` in GLOBAL during config load (via Docker inspect of `CONTAINER_WORKSPACE_FOLDER` or `WorkingDir`, mirroring wez-into's `resolve_workspace_folder`). Without this, every ExecDomain pane lands in the container's default home directory instead of the workspace, which is a UX regression from the current wez-into behavior.

2. **[blocking]** Ensure wez-into's cold-start fallback (line 576: `wezterm connect "lace:$port"`) is explicitly called out as requiring update to `"lace-mux:$port"`. The proposal mentions this in Phase 2 item 3, but given that `wezterm connect` with an ExecDomain name would fail or behave incorrectly, this should be highlighted more prominently, not buried in a subitem. Also update the help text at line 624.

3. **[non-blocking]** Add a CWD verification step to the test plan: after splitting in a container tab, `pwd` should show the workspace directory.

4. **[non-blocking]** Add a multi-container test scenario: two projects open, verify splits in each tab route to the correct container.

5. **[non-blocking]** Update wez-into `--dry-run` output to reflect the ExecDomain spawn command instead of the raw SSH command.

6. **[non-blocking]** Consider using the full API model name in frontmatter `first_authored.by` per the frontmatter spec.
