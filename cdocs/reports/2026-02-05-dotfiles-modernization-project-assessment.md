---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:45:00-08:00
task_list: lace/dotfiles-migration
type: report
state: live
status: done
tags: [status, dotfiles, executive-summary, project-assessment, cross-proposal, sequencing, chezmoi, nushell, wezterm, firefox]
supersedes:
  - cdocs/reports/2026-02-05-dotfiles-modernization-executive-summary.md
synthesizes:
  - cdocs/proposals/2026-02-05-dotfiles-legacy-archive-clean.md
  - cdocs/proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md
  - cdocs/proposals/2026-02-05-dotfiles-nushell-setup.md
  - cdocs/proposals/2026-02-05-dotfiles-firefox-chezmoi-migration.md
  - cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md
---

# Dotfiles Modernization: Project Assessment

> BLUF: Five proposals chart a path from a cluttered dotfiles repo to a focused modern stack (chezmoi + wezterm + nvim + nushell). The archive proposal has been rewritten as a chezmoi-agnostic file reorganization (R1 accepted). The container username mismatch is resolved by a new plugin proposal that queries `docker inspect` at connection time (R1 accepted). The nushell proposal is ready (R3 accepted). The launcher elimination proposal has been amended to depend on the plugin work. Only the firefox proposal remains deferred. Recommended sequence: archive first, nushell second, plugin username lookup third, launcher elimination fourth, firefox as a final followup.

## Context / Background

The dotfiles repository (`/home/mjr/code/personal/dotfiles/`) has accumulated configuration for multiple generations of tooling. A planning session produced four proposals to modernize it, plus a fifth plugin proposal to resolve a cross-cutting username issue, each reviewed through multiple rounds. This report assesses the proposals in relation to one another, documents cross-cutting issues found during review, records user decisions, and provides an updated implementation plan.

### Proposal Inventory

| Proposal | Status | Reviews | Verdict |
|----------|--------|---------|---------|
| [Legacy Archive Migration (Clean Rewrite)](../proposals/2026-02-05-dotfiles-legacy-archive-clean.md) | **R1 accepted** | R1 accepted | Clean rewrite: chezmoi-agnostic file reorganization. Legacy chezmoi artifacts archived. Supersedes [original](../proposals/2026-02-05-dotfiles-legacy-archive-migration.md). |
| [Docker User Lookup (Plugin)](../proposals/2026-02-05-lace-wezterm-docker-user-lookup.md) | **R1 accepted** | R1 (revisions applied) | Plugin queries `docker inspect` for per-container username at connection time. Unblocks launcher elimination. |
| [Eliminate Workspace Launcher](../proposals/2026-02-05-dotfiles-eliminate-workspace-launcher.md) | **Amended, needs re-review** | R2 (revision requested) | Amended to depend on plugin proposal. Design Decision 6 replaced (no more `remoteUser: "node"`). Dotfiles container keeps `vscode` user. |
| [Nushell Setup](../proposals/2026-02-05-dotfiles-nushell-setup.md) | **Ready** | R1-R3 (R3 accepted) | Adapted for new archive proposal. Ready to implement. |
| [Firefox Chezmoi Migration](../proposals/2026-02-05-dotfiles-firefox-chezmoi-migration.md) | **Deferred** | R1 (revision requested) | Template bug unresolved. Deferred to final followup. Existing manual symlink works. |

### What Has Already Been Done

Two P0 wezterm fixes were applied earlier in this session:
- **Plugin path fix**: Updated `dotfiles/dot_config/wezterm/wezterm.lua` to point to the `lace.wezterm` repo, rewrote plugin section for the new API
- **Stale config override**: Removed `WEZTERM_CONFIG_FILE` override from `lace/bin/open-lace-workspace` (pointed to a deleted file)

## Key Findings

### Finding 1: Chezmoi Is the Deployment Mechanism (Resolved)

The original archive proposal incorrectly stripped chezmoi references. This has been resolved by rewriting the archive proposal from scratch as a [chezmoi-agnostic file reorganization](../proposals/2026-02-05-dotfiles-legacy-archive-clean.md). The new approach separates concerns cleanly: the archive migration is purely repo-level file moves (`cp`, `git rm`, `git add`, `git commit`) with no chezmoi commands. Chezmoi bootstrap happens separately -- either before or after the archive migration. Legacy chezmoi artifacts (the `run_once` scripts for blesh and tpm) are archived under `archive/legacy/chezmoi_run_once/`, preventing them from running on future `chezmoi apply`. The starship `run_once` script stays at repo root because starship is shared with nushell.

**Impact:** The archive migration is now cleanly decoupled from chezmoi. Chezmoi setup is handled separately by the user.

**User decision:** "The archive proposal has to be reworked or rewritten to account for the fact that we don't want to get rid of chezmoi." (Resolved by the clean rewrite.)

### Finding 2: Container Username Mismatch (Resolved)

The lace.wezterm plugin hardcodes `username = "node"` for all 75 pre-registered SSH domains. This breaks any devcontainer using a different user (e.g., `vscode` in the dotfiles container). This is now resolved by the [docker user lookup proposal](../proposals/2026-02-05-lace-wezterm-docker-user-lookup.md) (R1 accepted).

The solution: when the user selects a project via the WezTerm project picker, the plugin updates the SSH domain's username to match the discovered container user (from `docker inspect`) before connecting. This preserves all SSH domain configuration (identity file, multiplexing, `StrictHostKeyChecking`) while overriding only the username. The `wez-lace-into` CLI path already handles this correctly via `lace-discover`. Direct `wezterm connect lace:PORT` continues to use the configured default.

**User decision:** "The wezterm plugin should query docker for the active user state or something. We'll need to do another round of work on that plugin regardless."

**Impact:** The launcher elimination proposal has been amended: Design Decision 6 (override container user to `node`) is replaced with reliance on the plugin enhancement. The dotfiles container keeps its native `vscode` user. The launcher elimination now depends on the plugin proposal being implemented first.

### Finding 3: Firefox Template Bug Is Under Investigation

The firefox proposal's `run_onchange_after_` script uses:
```
{{ include (joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini") | sha256sum }}
```
If `profiles.ini` doesn't exist, chezmoi template rendering fails. An investigation subagent is assessing the practical impact and identifying the correct chezmoi template guard.

**User decision:** Firefox is a final followup after the other three proposals. "We'll consider the firefox proposal a final followup though, to unblock the other work."

### Finding 4: Nushell Proposal Is Solid

The nushell proposal went through three review rounds and incorporated extensive user feedback:
- Removed Python/venv content (no longer relevant)
- Replaced blesh visual mode with WezTerm copy mode reference
- Reframed from cautious experiment to daily driver
- Collapsed three phases to two
- Simplified rollback to a single wezterm.lua change

No cross-proposal conflicts. The only dependency is that the archive migration should complete first (so bash config is at `archive/legacy/bash/` as expected).

### Finding 5: Executive Summary Was Stale

The [previous executive summary](2026-02-05-dotfiles-modernization-executive-summary.md) (now superseded) contained several inaccuracies:
- Referenced the superseded "bin launcher migration" proposal, not the "eliminate launcher" replacement
- Described nushell as "opt-in secondary" -- user clarified it is the primary shell
- Stated chezmoi was "functional" and "already true" -- it hasn't been applied
- Omitted the firefox proposal entirely
- Included time estimates (user prefers not to have these)

## Cross-Proposal Dependency Analysis

```
┌─────────────────────┐
│   Legacy Archive     │  ← chezmoi-agnostic file reorganization
│   (clean rewrite)    │
└──────────┬──────────┘
           │
           │ (bash archived, workspace clean)
           v
┌──────────────────┐
│  Nushell Setup   │  ← needs chezmoi functional to deploy config
│  (Phase 1-2)     │
└──────────────────┘
           .
           . (can proceed in parallel with nushell)
           v
┌────────────────────────┐
│  Plugin Docker User    │  ← independent of nushell/archive
│  Lookup (lace.wezterm) │
└──────────┬─────────────┘
           │
           │ (plugin resolves per-container usernames)
           v
┌──────────────────┐
│    Launcher      │  ← depends on plugin proposal
│   Elimination    │
└──────────────────┘
           .
           . (all core work complete)
           v
┌──────────────────┐
│    Firefox       │  ← final followup, deferred
│ (chezmoi-based)  │
└──────────────────┘
```

### Hard Dependencies

| Downstream | Depends On | Reason |
|------------|-----------|--------|
| Nushell Phase 1 | Archive complete | Config references `archive/legacy/bash/` paths |
| Nushell Phase 1.5 | Chezmoi functional | `chezmoi apply` deploys nushell config to `~/.config/nushell/` |
| Launcher elimination | Plugin docker user lookup | Plugin must resolve `vscode` username for dotfiles container |
| Firefox | Chezmoi functional | Entirely chezmoi template-driven |

### Soft Dependencies (Sequencing Preference)

| Task | Better After | Reason |
|------|-------------|--------|
| Plugin user lookup | Archive | Can proceed in parallel, but cleaner to do after archive |
| Launcher elimination | Nushell | Fewer moving parts if shell migration is done first |
| Firefox | Everything else | Lowest priority, most chezmoi-dependent |

## The Big Decision: Plugin Username Handling (Resolved)

The lace.wezterm plugin hardcoded `username = "node"` for all 75 SSH domains. The user chose to modify the plugin rather than force all containers to conform. This decision is now codified in the [docker user lookup proposal](../proposals/2026-02-05-lace-wezterm-docker-user-lookup.md) (R1 accepted).

The chosen approach is **domain re-registration**: when the user selects a project via the picker, the plugin updates the existing `lace:PORT` SSH domain's username to match the discovered container user (from `docker inspect`), then connects via the domain as before. This preserves all SSH domain configuration while only overriding the username. Three approaches were evaluated:

| Approach | Verdict |
|----------|---------|
| A. Domain re-registration (mutate `domain.username` before connecting) | **Chosen** -- preserves identity file, multiplexing, ssh_option |
| B. `ConnectToUri` (`ssh://user@localhost:port`) | Rejected -- bypasses SSH domain config, loses identity file |
| C. Dynamic domain creation (create `lace:PORT:user` domains at discovery time) | Rejected -- creates extra domains, may not work post-config-load |

The `apply_to_config` options still accept a `username` field (default `"node"`) as the fallback for pre-registered domains and direct `wezterm connect lace:PORT` usage. The plugin work is a prerequisite for the launcher elimination, but not for archive or nushell.

## Recommended Sequencing

### Phase 1: Archive Migration (chezmoi-agnostic)

Archive migration goes first because it cleans the workspace for everything that follows. The [clean rewrite](../proposals/2026-02-05-dotfiles-legacy-archive-clean.md) is purely repo-level file moves -- no chezmoi commands. Legacy bash/tmux/vscode/blackbox files move to `archive/legacy/`, `dot_bashrc` source paths are rerouted, VSCode symlinks are materialized.

**Current status:** R1 accepted. Ready to implement.

**Key moments:**
- Phase 2: Copy legacy files to `archive/legacy/` (both old and new paths coexist)
- Phase 3: Reroute `dot_bashrc` source paths + manual `cp dot_bashrc ~/.bashrc` to deploy
- Phase 5: `git rm` originals, single atomic commit

### Phase 2: Nushell Setup

Nushell is entirely additive. Creates new files under `dot_config/nushell/`, installs carapace, and changes wezterm's `default_prog`. Requires chezmoi to be functional for `chezmoi apply` in Step 1.5.

**Current status:** R3 accepted. Ready to implement after archive migration.

**Key moments:**
- Step 1.2: Create all config files in the dotfiles repo
- Step 1.5: `chezmoi apply` to deploy nushell config
- Step 1.6: Set wezterm `default_prog` to nushell (the "point of no return" for daily driving)

### Phase 3: Plugin Docker User Lookup

The [plugin proposal](../proposals/2026-02-05-lace-wezterm-docker-user-lookup.md) modifies the lace.wezterm project picker to override the SSH domain username with the discovered container user before connecting. This is a small, focused change to `setup_project_picker()` in `plugin/init.lua`. Can proceed in parallel with nushell if desired.

**Current status:** R1 accepted (revisions applied). Ready to implement.

**Key moments:**
- Phase 1: Pass `config` to `setup_project_picker` signature
- Phase 2: Insert domain username override before `SwitchToWorkspace`
- Phase 5: Validate with dotfiles container (post-launcher-elimination)

### Phase 4: Launcher Elimination

The dotfiles devcontainer adopts the lace port-range model (port 22426, shared SSH key). The existing lace ecosystem handles discovery and connection. The 374-line launcher script is deleted.

**Current status:** Amended (Design Decision 6 replaced, dependency on plugin proposal added). Needs re-review.

**Key moments:**
- Prerequisite: Plugin docker user lookup implemented
- Phase 1: Change dotfiles devcontainer port to 22426, unify SSH key
- Phase 3: Delete the launcher script

### Phase 5 (Followup): Firefox Chezmoi Migration

Deferred until the other proposals are complete. The existing manual symlink continues to work.

**Current status:** R1 revision requested. Template bug unresolved. Deferred.

## Open Items

### Blocking (Must Resolve Before Implementation)

1. **Launcher elimination re-review** -- amended to depend on plugin proposal and remove `remoteUser: "node"`. Needs another review round before implementation.

### Non-Blocking (Can Resolve During Implementation)

2. **Firefox profiles.ini template fix** -- investigation in progress. Deferred; not blocking any other work.
3. **Carapace installation method** -- nushell proposal documents Go install with binary fallback; COPR could be added
4. **Port assignment convention** -- should 22425 be formally reserved for lace? No enforcement mechanism exists
5. **Known hosts automation** -- `StrictHostKeyChecking=accept-new` handles most cases; full automation deferred
6. **Plugin config path fix** -- deployed `wezterm.lua` points to stale plugin path; must be fixed locally before testing plugin changes (documented in plugin proposal)

### Resolved (User Decisions and Completed Work)

7. Chezmoi is the deployment mechanism going forward (not abandoned)
8. Archive proposal rewritten from scratch as chezmoi-agnostic (R1 accepted)
9. Plugin docker user lookup proposed and accepted (R1) -- concrete solution for per-container username resolution
10. Launcher elimination amended to depend on plugin proposal (Design Decision 6 replaced)
11. Nushell proposal adapted for new archive proposal (R3 accepted)
12. Firefox is a final followup (existing symlink works meanwhile)
13. Nushell is the primary shell (not an experiment)

## Recommendations

1. **Start implementation with the archive migration.** It is R1 accepted, chezmoi-agnostic, and has no dependencies. It cleans the workspace for everything that follows.

2. **Proceed to nushell after archive.** The nushell proposal is R3 accepted and ready. Chezmoi must be functional before nushell Step 1.5.

3. **Implement the plugin docker user lookup.** It is R1 accepted and can proceed in parallel with nushell if desired. It is a small, focused change to `setup_project_picker()` in the lace.wezterm plugin.

4. **Re-review the launcher elimination proposal** after the plugin is implemented. The amendment is done but the proposal needs another review round to confirm the changes are consistent.

5. **Do not rush firefox.** The manual symlink has worked since 2022. The chezmoi migration is a quality-of-life improvement, not urgent.
