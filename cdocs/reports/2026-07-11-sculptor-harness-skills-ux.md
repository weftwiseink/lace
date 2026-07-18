---
first_authored:
  by: '@claude-opus-4-8'
  at: 2026-07-11T17:00:00.000Z
task_list: sculptor-assessment/harness-skills-ux
type: report
state: live
status: wip
tags:
  - investigation
  - sculptor
  - workflow
guid: p46Vc0GO_iLOn
---

# Sculptor: Harness Integration, Skills, and Workflow/UX

> BLUF: Sculptor is a GUI-desktop app for running coding agents in parallel across isolated git-worktree workspaces.
> Claude Code is its first-class, deeply-integrated harness (run as a streaming-JSON SDK process, not a scraped TUI), with Pi as a second native harness and a "terminal agent" tier that runs any TUI program (including Claude Code's own TUI) with only status-signal integration.
> Its skills are ordinary Claude Code plugin skills, so they compose with lace's cdocs skills rather than competing.
> Nearly all of Claude Code's power survives: MCP (user servers merge additively), subagents, plan mode, effort (5 levels), fast mode, model selection, and custom `~/.claude/` skills.
> The core mismatch for a terminal-native power user is architectural: Sculptor's unit of parallelism is a GUI tab backed by a per-workspace worktree and a running desktop backend, not a tmux pane or an SSH session into a devcontainer.

## Investigation scope

Codebase: `/home/mjr/code/apps/sculptor`.
Primary sources: `docs/help/*.md`, `docs/competitors.md`, `docs/history.md`, the harness abstraction under `sculptor/sculptor/agents/` and `sculptor/sculptor/interfaces/agents/`, the `sculptor-workflow` / `sculptor-plugin` / `sculptor-experimental` skill packages, the `sculpt` CLI under `tools/sculpt/`, and the terminal-agent spec at `agent_docs/terminal-agents/spec.md`.

## 1. Agent harness model

### The seam
The harness abstraction is a clean, deliberate ABC: `sculptor/sculptor/interfaces/agents/harness.py`.
Every harness advertises a typed, all-bool capability set (`HarnessCapabilities`) with **no defaults**, so adding a capability forces an edit at every harness site (a grep-complete capability matrix).
The 15 capability bools are: `supports_chat_interface`, `supports_interactive_backchannel`, `supports_skills`, `supports_sub_agents`, `supports_image_input`, `supports_fast_mode`, `supports_context_reset`, `supports_compaction`, `supports_background_tasks`, `supports_session_resume`, `supports_tool_use_rendering`, `supports_file_attachments`, `supports_interruption`, `supports_file_references`, `supports_model_selection`.

The registry `sculptor/sculptor/agents/harness_registry.py` is the single module naming every concrete harness and agent. Four harnesses are registered: `CLAUDE_CODE_HARNESS`, `PI_HARNESS`, `HELLO_HARNESS` (a demo), and `TERMINAL_HARNESS`.

### Is Claude Code first-class?
Yes, unambiguously.
Claude Code is the only harness that advertises **all 15 capabilities True** (`sculptor/sculptor/agents/default/claude_code_sdk/harness.py:136`).
`docs/help/integrated_harnesses.md` states of Claude's integrated harness under "Not available": *"Nothing. Claude Code supports every capability described above."*
The frontend default model list is Claude-only (`ModelSelector.stories.tsx`: opus-4-8, sonnet-4-6, haiku-4-5), and the default effort is `EXTRA_HIGH` (`sculptor/sculptor/state/messages.py:150`).

Sculptor runs Claude Code as a streaming-JSON subprocess with the stdin control protocol enabled, not as a scraped text stream.
The launch command is assembled in `process_manager_utils.py:get_claude_command` (line 45):

- `--dangerously-skip-permissions --permission-prompt-tool stdio` (sandboxed, auto-approved tool permissions)
- `--output-format=stream-json --verbose --input-format stream-json --include-hook-events`
- `--mcp-config <inline sculptor SDK server>` plus `--disallowed-tools AskUserQuestion,ExitPlanMode`: Sculptor **substitutes** Claude's native ask-question and exit-plan-mode tools with its own `mcp__sculptor__*` tools so it can render native panels and answer on Claude's behalf.
- `--append-system-prompt <addendum>` telling Claude to prefer the replacement tools and to record task dependencies (which draws the dependency graph).
- `--model`, `--effort {low|medium|high|xhigh|max}`, `--settings {"fastMode":true}` (all three set at launch; a change applies on the next message).
- Three bundled plugins via `--plugin-dir`: `sculptor-plugin`, `sculptor-workflow`, `sculptor-experimental`.

> NOTE(opus/sculptor-assessment): The main chat command does **not** pass `--strict-mcp-config`.
> Only the `/btw` background context-probe process does (`btw_process_manager.py:79`).
> So the user's own MCP servers from `~/.claude.json` / project `.mcp.json` merge additively with Sculptor's injected SDK server for the primary agent.

Surfaced Claude features: plan mode (chat toggle, backed by the substituted ExitPlanMode tool; a finished plan opens in the editor pane), effort (Low/Medium/High/Extra High/Max), fast mode, model picker, sub-agents, skills, image input, file references, interruption, compaction (via a registered pre-compaction hook that raises a "Compacting..." indicator), and a per-turn context-window-fullness probe rendered as a "% context" chip.

### Pi and "any terminal-based agent"
Pi (`sculptor/sculptor/agents/pi_agent/`) is a second **native** harness run in RPC mode (structured requests, not text scraping), with a backend-sourced dynamic model catalog and mid-session model switching. Pi lacks fast mode and context-usage reporting (`integrated_harnesses.md` "Not available").

"Any terminal-based agent" is the **terminal-agent** tier (`TERMINAL_HARNESS`, spec at `agent_docs/terminal-agents/spec.md`).
This is explicitly a lower-integration tier: Sculptor does **not** parse the message stream and provides **no chat UI**.
A terminal agent is either a plain shell in the workspace `code/` dir, or a *registered* agent that launches a predetermined program.
Integration is purely additive via a local HTTP event API wrapped by `sculpt signal busy|idle|waiting|files-changed|session-id`; a broken integration degrades to a plain terminal.

The reference registration ships out of the box: Claude Code's own **TUI** as a terminal agent (`samples/terminal_agents/claude-code/`).
Its `claude-code.toml` launches `$SCULPT_CLAUDE_BIN --dangerously-skip-permissions --settings <hooks.json> --plugin-dir ...` and resumes via `--resume {session_id}`.
The hooks JSON maps Claude Code lifecycle hooks (`SessionStart`, `UserPromptSubmit`, `Stop`, `PreToolUse`/`PostToolUse`, `Notification`) to `sculpt signal` calls for tab status dots and diff refresh.
Motivation stated in the spec: let users keep subscription pricing via the TUI, and fall back to the TUI for Claude features Sculptor cannot yet visualize.

So the harness layer is a genuine three-tier abstraction, but Claude Code is a first-class citizen twice over: as the richest native harness **and** as the bundled terminal-agent reference.

## 2. Skills system

Sculptor skills **are** Claude Code skills. They ship as Claude Code plugin packages (`.claude-plugin/plugin.json` + `skills/*/SKILL.md` with standard `name`/`description` frontmatter), loaded into every native Claude agent via `--plugin-dir`.
Verified: `sculptor/sculptor-workflow/skills/spec/SKILL.md` is a normal SKILL.md.

Three bundled plugins:

- **`sculptor-plugin`** — helpers: `/sculptor:help`, `/sculptor:sculpt-cli` (drive the app from the `sculpt` CLI), `/sculptor:build-sculptor-extension`.
- **`sculptor-workflow`** — an opinionated pipeline: `spec → mock → architect → plan → build → review`, plus standalone `setup-repo` and `fix-bug`. Each stage runs as its own renamed agent tab and writes a durable on-disk artifact (`mocks.html`, `architecture.md`, a `plan/` folder of self-contained task files, `review.md`) that the next stage reads. `setup-repo` writes `.sculptor/{code,testing,docs}.md` config the other skills consume.
- **`sculptor-experimental`** — `handoff`, `stack`, `restack`: move work to a fresh agent or a stacked workspace, built on the `sculpt` CLI.

Critically, `docs/help/skills.md` documents that Sculptor **also surfaces the user's own** `~/.claude/skills/`, `~/.claude/commands/`, and repo `.claude/` skills in the `/` picker alongside the built-ins.
The chat `/` picker also carries conversation commands (`/clear`, `/compact`, `/context`, `/copy`) and general skills (`/batch`, `/btw`, `/loop`, `/simplify`).

**Relationship to cdocs**: complementary, not competing. cdocs is itself a Claude Code plugin/skill set (`.claude/rules/`, `plugins/cdocs/`), so a lace user's cdocs skills would appear in Sculptor's `/` picker unchanged. The only overlap is conceptual: `sculptor-workflow` is a rival *opinion* about how to structure feature work (spec/architect/plan/build/review with on-disk artifacts) versus cdocs (propose/review/implement/devlog with frontmatter'd markdown). Both are just skills; a user can ignore either.

## 3. Terminal integration

`docs/help/terminal.md`: Sculptor has a built-in terminal per workspace, scoped to the workspace `code/` dir, opened via `Cmd+K` -> Terminal. Multiple tabs, each an independent shell, renamable, `Ctrl+L` to clear.

This is a real PTY shell, so you can drop to a real terminal and run anything.
Workspaces live on disk at `~/.sculptor/workspaces/<id>/code/` (`docs/help/workspaces.md`), and the top-bar repo menu offers "Open in terminal" / "Open in editor" / "Copy path", so a user is never locked out of their own filesystem.

Compared to lace's tmux/sprack/wezterm model: Sculptor's terminal is a **panel inside the GUI**, not a first-class multiplexer. There is no evidence of native tmux integration, no wezterm domain, no SSH-in story for reaching the workspace remotely except the experimental **Container Backend** (`docs/help/experimental/container_backend.md`), which runs the whole backend in Docker or on a remote machine via a custom backend command. That is whole-app remoting, not per-workspace SSH like lace's devcontainer approach. lace's model (tmux panes, wezterm SSH domains into devcontainers) is terminal-native and multiplexer-first; Sculptor's is GUI-panel-first with the terminal as a secondary affordance.

## 4. Collaboration / multi-agent

Two orthogonal axes of parallelism:

- **Workspaces** (`docs/help/workspaces.md`): each is an isolated worktree (default) on its own branch, so many agents run in parallel without merge chaos. Also `clone` and `in-place` modes (Settings -> Experimental).
- **Multiple agents per workspace** (`docs/help/agents.md`): an agent tab bar sits between chat and terminal; `+` opens another agent **sharing the same working copy**. Each agent has its own conversation but they edit the same files, so the doc explicitly warns about conflicting simultaneous edits and advises partitioning work.

`docs/history.md` notes Sculptor **abandoned per-agent Docker isolation** deliberately, because letting agents inspect each other's work proved powerful and per-agent isolation confused users. This is a philosophical divergence from lace's per-devcontainer isolation.

Navigation is GUI-centric: the command palette (`Cmd+K`, `docs/help/command_palette.md`) switches workspaces/agents, jumps to files, toggles panels. Agent tabs and workspace tabs are the primary parallelism UI.

## 5. Settings / config / extensibility for power users

`docs/help/settings.md` is entirely a GUI settings tour (theme, harness defaults, keybindings, repos, git/PR automation, a "CI Babysitter" that auto-fixes CI failures, env-var files at `~/.sculptor/.env` and per-repo `.sculptor/.env`, saved one-click prompt "Actions").

The genuine power-user seams:

- **`sculpt` CLI** (`tools/sculpt/`): a full HTTP client for the Sculptor API. Subcommands: `workspace`, `agent` (`create`, `list`, `show`, `send`, `rename`, `delete`, `status`, `messages`), `extension`, `repo`, `schema`, `signal`, `run`. `sculpt run "<prompt>" --repo <path> --model <opus|sonnet|...> --strategy worktree` launches a one-shot headless agent. Every Sculptor agent shell exports `SCULPT_AGENT_ID` / `SCULPT_WORKSPACE_ID` / `SCULPT_PROJECT_ID`, so agents can drive Sculptor from inside a workspace. This is the scriptable/automatable surface, but it **still requires the Sculptor backend to be running** (it is an API client, not a standalone runner).
- **Extensions** (`docs/help/extensions.md`): runtime-loaded JavaScript modules adding panels, widgets, home views, overlays. Loaded from `~/.sculptor/extensions/` or a dev-server URL, hot-reloadable via `sculpt extension load`. Bundled: Linear, Sculpty, Pomodoro. This extends the **GUI**, not the agent runtime.
- **MCP**: user MCP servers merge additively for the primary Claude agent (see §1 NOTE). There is no GUI for managing MCP servers; you configure them the normal Claude Code way (`~/.claude.json`, `.mcp.json`).
- **Custom agent config**: per-agent model/effort/fast-mode, per-repo setup command and branch pattern, and user-scope terminal-agent registrations under `~/.sculptor/terminal_agents/` (declarative TOML + hooks JSON; no repo-scope, no settings UI in v1).

Bottom line: it is **not** GUI-only. A power user can script agent/workspace creation and messaging via `sculpt`, register arbitrary terminal agents, and extend the UI. But the automation orbits a running desktop app, and the primary interaction model is the GUI.

## 6. Overall UX philosophy and target user

`docs/competitors.md` positions Sculptor as *"a desktop application"* and an *"open source alternative"* to Claude Code Desktop, Cursor, Conductor, Factory, Devin, etc., that *"uniquely focuses on providing defaults for teams spinning up on agent development."*
Stated reasons to use it: "you like thoughtfully designed interfaces", "you want to use pi-agent alongside Claude Code", "you like open source".
It runs fully locally (self-hostable for remote access), unlike Codex Web / Jules.

Target user: a developer (or team) who wants a **designed desktop environment** for supervising many agents in parallel with rich diff review, live plan panels, PR automation, and Linear integration, out of the box.
That is a review-and-supervise persona, not a terminal-multiplexer persona.

## Deviations and gaps surfaced

- **No native tmux/wezterm/SSH-per-workspace integration.** Remote access is whole-app (experimental container backend), not per-devcontainer SSH.
- **Shared-working-copy multi-agent trades isolation for collaboration**, the opposite of lace's per-container isolation, and the docs themselves flag the conflict risk.
- **`sculpt run` is not a standalone headless runner**: it needs the backend up, so it does not replace a plain `claude -p` in a tmux pane for pure-CLI automation.
- **`--strict-mcp-config` on the `/btw` probe only**: I did not exhaustively confirm the primary agent inherits every user MCP server in every mode (worktree vs container backend); the code path for the main command omits the strict flag, which is the load-bearing evidence, but runtime verification was out of scope.
- The competitors doc is candid and low-substance ("you like the vibes we give off"); it is a positioning statement, not a rigorous comparison, so claims of parity should be treated as marketing.
</content>
</invoke>
