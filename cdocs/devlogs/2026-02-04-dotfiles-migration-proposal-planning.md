---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T12:00:00-08:00
task_list: lace/dotfiles-migration
type: devlog
state: live
status: wip
tags: [dotfiles, devcontainer, chezmoi, wezterm-plugin, proposal-planning]
---

# Dotfiles Migration Proposal Planning

## Initial Prompt (Full Context)

> User requested: a migration of our dotfile project /home/mjr/code/personal/dotfiles/ focused on accomplishing the following goals:
> 1. adding a lace-style devcontainer to enable safe containerized iteration on dotfiles
> 2. migration of the "personalized" wezterm/neovim configs here into the dotfiles
> 3. migration to chezmoi for dotfile management (will introduce a review step between agent changes and local application even with a bind mount)
>
> Important plans to consider:
> 1. The wezterm config that pertains to lace should be broken into a wezterm plugin: https://wezterm.org/config/plugins.html. A subagent should research how to do this without breaking the plugin into a separate repo
> 2. IFF there is any similar lace-specific config for neovim we should also make that a plugin
> 3. We'll want a way to mount our projects into one another's devcontainers in readonly for use as "dev dependencies." This should reference gitrepos in the devcontainer customization, with a separate user-level config mapping repos to local paths, and lace itself opinionated about in-container mount points.
> 4. Before returning, ensure all plans contain testing and debug iteration plans and have been through a round of /cdocs:review. Use subagents.
> 5. Subagents should callout underspecifications and points needing clarification.

## Objective

Produce a comprehensive proposal document for the dotfiles migration that addresses all five major areas:
1. Devcontainer setup for dotfiles iteration
2. Wezterm config extraction into a plugin
3. Neovim lace-specific config assessment (plugin if warranted)
4. Inter-project mounting ("dev dependencies") architecture
5. Chezmoi migration strategy

## Understanding the Current State

### Dotfiles Repo (/home/mjr/code/personal/dotfiles/)
- Currently uses a custom `setup.sh` with `setup_symlink` helper
- Contains: bash configs, tmux, vim/nvim (init.vim), firefox, tridactyl, vscode settings
- No chezmoi, no devcontainer
- README mentions "Replace custom scripts with chezmoi if it really is so great"

### Lace Wezterm Config (/var/home/mjr/code/weft/lace/config/wezterm/wezterm.lua)
Key lace-specific sections to potentially extract as plugin:
- SSH domain configuration for devcontainer access (lines 67-86)
- Devcontainer connection keybindings (Leader+D, lines 150-161)
- Worktree picker integration (lines 163-221)
- Status bar showing workspace name (lines 27-34)

Non-lace (personal preference) sections:
- Appearance settings (color scheme, font, window styling)
- Multiplexing unix domain config
- Core keybindings (pane navigation, splits, tabs)
- Copy mode

### Lace Neovim Config (/var/home/mjr/code/weft/lace/config/nvim/)
- LazyVim-based setup with plugins for: ui, editor, treesitter, telescope, lsp, colorscheme, git
- Need to assess if any of this is lace-specific vs general preference

### Lace Devcontainer Pattern
- Worktree-aware mounting strategy
- SSH domain for wezterm integration
- Command history persistence via bind mount
- Claude config persistence

## Research Subagents Needed

1. **Wezterm Plugins Research** - How to create a plugin without separate repo, plugin API capabilities
2. **Chezmoi Research** - Migration patterns, templating, hooks, agent-safe workflows
3. **Neovim Plugin Assessment** - What in lace nvim config is lace-specific vs generic
4. **Devcontainer Cross-Mounting** - Patterns for mounting sibling projects as dev dependencies

## Planning Log

### Entry 1: Initial Analysis

Read through existing code and proposals. Key observations:
- Lace has a mature devcontainer setup with worktree support that can serve as template
- Wezterm config has clear separation between lace-specific and personal-preference code
- The "dev dependencies" concept is novel and needs careful design
- Chezmoi migration has clear motivation (review step between agent changes and application)

Next: Spin off research subagents in parallel, then synthesize findings into proposal structure.

### Entry 2: Deeper Codebase Analysis

Reviewed existing lace infrastructure:

**Lace CLI (`packages/lace/`):**
- Mature TypeScript CLI with `prebuild`, `restore`, `status` commands
- Uses `customizations.lace` namespace in devcontainer.json
- Has comprehensive test infrastructure
- Pattern for extending: new capabilities fit naturally here

**Lace Wezterm Config (`config/wezterm/wezterm.lua`):**
After detailed review, lace-specific sections are clearly separable:
- Lines 52-86: SSH domains for devcontainer multiplexing
- Lines 148-221: Devcontainer connection (Leader+D, worktree picker)
- Status bar workspace display

Personal preference sections (should go to dotfiles):
- Color scheme, font, window styling (lines 13-25)
- Core keybindings (lines 89-142)
- Copy mode, gui-startup (lines 228-253)

**Lace Neovim Config (`config/nvim/`):**
- LazyVim-based with standard plugins
- Comments indicate "matching mjr's" preferences
- No obvious lace-specific integrations (no worktree/devcontainer awareness)
- **Likely does NOT need a plugin** - appears to be pure personal preference

**Key Observation on "Dev Dependencies":**
The existing devcontainer.json shows a pattern:
- `mounts` array for bind-mounting external resources
- Uses `${localEnv:HOME}` for user-specific paths
- Command history and Claude config already follow this pattern

The user's vision: separate "what" (project declares deps) from "where" (user config resolves paths).

### Entry 3: Questions to Clarify

1. **Dotfiles Devcontainer Scope:** Should the dotfiles devcontainer:
   - Be a complete development environment (like lace)?
   - Or minimal, just enough to iterate on dotfile configs?

2. **Wezterm Plugin Scope:** The current lace config has SSH domains that reference specific ports/paths. Should the plugin:
   - Be configurable (options for port, paths, domain name)?
   - Or hardcode lace-specific values and require dotfiles users to use a different config?

3. **Chezmoi + Devcontainer Integration:** How should chezmoi work with the devcontainer?
   - Source managed inside container, applied outside via bind mount?
   - Or source managed on host, applied both places?

4. **Dev Dependencies: Scope for This Proposal:** The cross-project mounting is a significant architectural addition to lace. Should it:
   - Be a full implementation proposal here?
   - Or an RFP to be elaborated later?

### Entry 4: User Clarifications Received

User responses to questions:

1. **Dotfiles devcontainer scope:** Minimal, but should use lace wezterm-server feature for dogfooding lace.

2. **Wezterm plugin configurability:** Configurable via options for now, with comments about coupled bits (e.g., `lace.local` convention) that could cause conflicts and should be candidates for future generalization.

3. **Dev dependencies:** Separate background agent tackling as independent proposal. Later, assess sequencing between proposals.

### Entry 5: Research Reports Synthesized

All four research reports completed:

**Wezterm Plugin Research:**
- Local `file://` protocol supported - can create plugin in-repo without separate repo
- Plugin lives at `config/wezterm/lace-plugin/plugin/init.lua`
- `apply_to_config(config, opts)` pattern with configurable options
- Recommended: In-repository plugin with options for ssh_port, username, workspace_path, etc.
- Open questions: Host vs container path resolution, plugin update workflow

**Chezmoi Migration:**
- Core workflow: source state (repo) -> target state (computed) -> destination state (applied)
- Migration from symlinks: `chezmoi add --follow` captures symlink targets
- Review workflow: `chezmoi diff` and `chezmoi apply -nv` before actual apply
- Agent-safe pattern: Agent edits source state in container via bind mount, user reviews/applies on host
- Naming convention: `dot_` prefix, `.tmpl` suffix for templates, `run_once_` scripts for setup

**Neovim Assessment:**
- **No lace-specific components found** - purely personal preferences
- No plugin extraction needed
- Should move to dotfiles, not stay in lace
- Future lace-nvim features could be built separately if desired (worktree picker, devcontainer detection)

**Dev Dependency Mounts:**
- Three-layer architecture: project declares (devDependencies), user maps (repos.json), lace controls (mount point)
- Repo identifier format: `github.com/user/repo`
- Container mount: `/lace/deps/<repo-name>/`
- Claude plugin path issue: recommend `${CLAUDE_PLUGIN_ROOT}` variable over path mirroring
- Dotfiles as special case with auto-apply support

### Entry 6: Proposal Structure Determined

Based on research synthesis, the proposal should cover:

1. **Dotfiles Devcontainer Setup**
   - Minimal devcontainer with wezterm-server for lace dogfooding
   - Worktree-aware mounting pattern (borrowed from lace)
   - No neovim-specific config (that goes in dotfiles themselves via chezmoi)

2. **Wezterm Plugin Extraction**
   - Create `config/wezterm/lace-plugin/plugin/init.lua` in lace repo
   - Options-based configuration (ssh_port, workspace_path, domain name)
   - Keep personal preferences in dotfiles wezterm config

3. **Chezmoi Migration**
   - Initialize chezmoi in dotfiles repo
   - Migrate existing symlink-based files
   - Set up review workflow patterns

4. **Personal Config Migration**
   - Move lace nvim config to dotfiles (as chezmoi-managed)
   - Create wezterm config in dotfiles that loads lace plugin

Note: Dev dependencies proposal being handled separately by background agent.

### Entry 7: Proposals Drafted

Created two proposals:

1. **Dotfiles Migration and Config Extraction** (`2026-02-04-dotfiles-migration-and-config-extraction.md`)
   - 6 implementation phases
   - Covers devcontainer, wezterm plugin, chezmoi migration, config consolidation
   - Status: wip, pending review

2. **Dev Dependency Cross-Project Mounts** (`2026-02-04-dev-dependency-cross-project-mounts.md`)
   - Companion proposal (created by background agent)
   - 6 implementation phases
   - Covers project declarations, user mappings, lace CLI integration
   - Status: wip, pending review

Both proposals awaiting review by cdocs:reviewer subagents.
Additionally, a sequencing assessment subagent is analyzing dependencies between the proposals.

### Entry 8: Reviews and Assessment Complete

**Dotfiles Migration Proposal Review:**
- Verdict: **Revise**
- Blocking issues:
  1. Keybinding collision when multiple projects load the plugin with different configs
  2. Plugin path detection inconsistent with dev-dependency mounts (`/workspace/main/lace/` vs `/lace.local/lace/`)
- Non-blocking: Port consistency (2222 vs 2223), SSH key naming, missing edge case documentation
- Review: `cdocs/reviews/2026-02-04-review-of-dotfiles-migration-and-config-extraction.md`

**Dev Dependencies Proposal Review:**
- Verdict: **Revise**
- Blocking issues:
  1. `lace up` command underspecified (doesn't exist yet, scope unclear)
  2. `mirrorPath` behavior with non-matching container users undefined
  3. Phase 5 implementation unclear
- Non-blocking: `/lace.local/` vs `/lace.local/deps/` namespace, schema/example consistency
- Review: `cdocs/reviews/2026-02-04-review-of-dev-dependency-cross-project-mounts.md`

**Sequencing Assessment:**
- Recommendation: **Option A (Dev Deps First) with parallel wezterm work**
- Key insight: The dotfiles devcontainer is a natural "first customer" for dev deps
- Sprint breakdown:
  1. Dev-deps Phases 1-3 + Wezterm plugin (Dotfiles 1-2) in parallel
  2. Dev-deps Phases 4-5 + Dotfiles devcontainer using devDependencies
  3. Dotfiles chezmoi migration and config consolidation
- No direct code conflicts between proposals

**Documents Created:**
- `cdocs/proposals/2026-02-04-dotfiles-migration-and-config-extraction.md` (wip, revision_requested)
- `cdocs/proposals/2026-02-04-dev-dependency-cross-project-mounts.md` (wip, revision_requested)
- `cdocs/reports/2026-02-04-wezterm-plugin-research.md`
- `cdocs/reports/2026-02-04-chezmoi-migration-research.md`
- `cdocs/reports/2026-02-04-neovim-lace-assessment.md`
- `cdocs/reports/2026-02-04-dev-dependency-mounts-research.md`
- `cdocs/reviews/2026-02-04-review-of-dotfiles-migration-and-config-extraction.md`
- `cdocs/reviews/2026-02-04-review-of-dev-dependency-cross-project-mounts.md`

### Entry 9: User Decisions on Blocking Issues

User resolved all blocking review items:

| Issue | Decision |
|-------|----------|
| **Keybindings** | Disable Leader+D/W for now. Create RFP for project picker feature that shows available projects. |
| **Plugin Path** | Use dev-deps mount. Dotfiles declares lace as devDependency, validates the feature. |
| **lace up** | New umbrella command: prebuild (if configured) → resolve-deps (if configured) → devcontainer up |
| **Namespace** | `/mnt/lace/local/dependencies` - clearer than `/lace.local/`, avoids namespace confusion |
| **mirrorPath** | Create directories with info notice. Don't error, just inform user it's happening. |

RFP created: `cdocs/proposals/2026-02-04-wezterm-project-picker.md`

Next: Update both proposals with these decisions to resolve blocking issues.

### Entry 10: Proposals Revised

Applied all user decisions to resolve blocking review issues:

**Dev Dependencies Proposal:**
- Changed mount namespace from `/lace.local/` to `/mnt/lace/local/dependencies/`
- Defined `lace up` as umbrella command: prebuild → resolve-deps → devcontainer up
- Clarified mirrorPath behavior: creates directories with info notice (non-error)
- Updated D3 design decision rationale
- Marked resolved items in underspecifications

**Dotfiles Migration Proposal:**
- Disabled keybindings (Leader+D, Leader+W) with reference to project picker RFP
- Updated plugin path detection to use dev-deps mount at `/mnt/lace/local/dependencies/lace/`
- Added devDependencies declaration example for dotfiles devcontainer.json
- Updated test plan and implementation phases to reflect keybinding changes
- Marked dev-deps integration as resolved in open questions

Both proposals now have revisions documented in frontmatter. Ready for re-review or user acceptance.

---
