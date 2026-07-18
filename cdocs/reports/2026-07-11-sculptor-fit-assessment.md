---
first_authored:
  by: '@claude-opus-4-8'
  at: 2026-07-11T17:05:00.000Z
task_list: sculptor-assessment/synthesis
type: report
state: live
status: wip
tags:
  - investigation
  - architecture
  - sculptor
  - comparison
guid: pD6m2A66weTZ7
---

# Sculptor Fit Assessment: Integrate or Replace lace?

> BLUF: Sculptor (Imbue) is a mature, MIT-licensed but experimental desktop product for supervising coding agents in parallel: an Electron shell over a standalone Python/FastAPI backend and a React renderer.
> It should **not replace lace**, because it deliberately discards exactly what lace provides: per-workspace container isolation, `devcontainer.json` support, symmetric port allocation, and prebuild caches.
> Imbue intentionally removed per-*agent* Docker; agents run as subprocesses on git worktrees inside a single backend process, with no scheduler and no per-agent resource isolation, which makes it *weaker* than lace at genuinely heavy parallelism even though its supervision UX is far richer.
> The runtime is not laptop-locked, though: a first-class Custom Backend Command lets the *entire* backend, and therefore all agents, run inside a Docker container, a VM, a remote SSH host, or a cloud platform (the `Environment` abstraction is provider-agnostic and already runs under Modal). The isolation granularity is the whole app, configured once, not the workspace.
> The realistic opportunity is **complementary**: Sculptor is an orthogonal multi-agent supervision-and-review surface that could run on top of lace-provided environments, and it preserves nearly all Claude Code power (plan, effort, subagents, MCP, your own `~/.claude` skills) so cdocs would work unchanged.
> Recommendation: keep lace as the environment/orchestration layer, mine Sculptor for design ideas, and only spike a Sculptor-in-devcontainer integration if a GUI supervision surface is a real product goal.

## Context / Background

The question: is Sculptor (`/home/mjr/code/apps/sculptor`) a good fit to integrate with or replace lace for heavy multi-tasking Claude agentic coding?
lace today is a terminal-native stack: a TypeScript devcontainer-orchestration CLI (`packages/lace`), a Rust tmux session browser (`packages/sprack`), git-worktree parallel dev, portless routing, and podman-first isolation, with no GUI.

This report synthesizes three in-depth companion reports:
- Architecture and tech stack: `cdocs/reports/2026-07-11-sculptor-architecture.md`
- Parallelism and container/environment model: `cdocs/reports/2026-07-11-sculptor-parallelism-containers.md`
- Harness, skills, and UX: `cdocs/reports/2026-07-11-sculptor-harness-skills-ux.md`

## Key Findings

- **Scale and maturity:** ~197k LOC Python (907 files) plus ~1,034 TS/TSX frontend files, 1,718 commits, ~4 core authors, 1,000+ test files, Alembic migrations, a 49-rule ratchets system, pyrefly typing, Sentry/PostHog. Internally rigorous.
- **License is MIT but "open in name only":** external PRs are gated (CONTRIBUTING.md), positioned as an experimental research preview, loopback-only (`127.0.0.1`) trust boundary. It is a released product, not a library or embeddable orchestration layer.
- **Architecture:** three cooperating processes - Electron main spawns a standalone Python FastAPI/uvicorn backend (the heavyweight core) and a React/Jotai renderer. The backend streams derived UI view-models to the frontend over a single WebSocket (snapshot + deltas, a backend-for-frontend design) over a SQLite event-log DB. The "async" backend is actually thread-based (custom `ConcurrencyGroup`/`ObservableThread`).
- **Isolation model is the opposite of lace's, at the workspace granularity:** a workspace is a **bare git worktree** (`git worktree add`), and agents run as **subprocesses** sharing one backend process and one filesystem. There is no `devcontainer.json` support, no per-workspace image, no prebuild cache, and no per-workspace port mapping. `docs/history.md` states Imbue *removed* per-agent Docker on purpose because isolation blocked cross-agent visibility and confused users. The remaining isolation lever is coarse: containerize/relocate the *whole* backend (see next bullet), which isolates the app from the host but not agents from each other.
- **Concurrency is unbounded thread-per-task** (`concurrent_implementation.py`), each thread spawning an agent subprocess, gated only by host CPU/RAM. No scheduler, no per-agent cgroup/CPU/memory quota, no OOM isolation. Self-hosted manifests size for "a few concurrent agents" (`openhost.toml`: 4 GB / 4 cores).
- **Runtime is pluggable, not laptop-locked:** the default mode is a local backend, but a first-class (experimental) **Custom Backend Command** (`SETTINGS_CUSTOM_BACKEND_COMMAND`, Settings > Experimental) spawns the entire backend anywhere that prints a URL. The shipped `container/recipes/docker/run-backend.py` runs the whole backend in Docker with a persistent volume (`sculptor-data`) and port mapping; `docs/help/experimental/container_backend.md` generalizes the same seam to a VM, a remote SSH host, or a cloud host. `docs/history.md` states this whole-app container/VM model is what *replaced* per-agent Docker ("easier and equivalent"). The `Environment` abstraction is provider-agnostic (`to_host_path`/`to_environment_path` remapping, volume/image lifecycle, `run_as_root`), and `LocalEnvironment` carries explicit accommodations for running under Modal's cloud PID namespace (`local_environment.py:50,399`) - so "Local" means "same environment as the backend," not "your laptop."
- **No cloud *service* dependency:** the only hard external dependency is the agent model API (Claude Code / Pi) plus GitHub for PRs. `offload*.toml` is Imbue's own CI test distribution on Modal (irrelevant to users); `openhost*` is an optional single-container self-hosted web deployment. There is no per-workspace cloud scheduler, and nothing forces execution off the user's machine.
- **Claude Code is a first-class native harness:** it advertises all 15 capability bools true - plan mode, 5 effort levels (low/medium/high/xhigh/max), fast mode, model selection, subagents, skills, images, compaction, interruption. MCP survives additively (`--mcp-config` without `--strict-mcp-config`). Sculptor also ships the Pi harness and can run *any* terminal-based agent as a degraded tier.
- **Skills complement, not conflict:** Sculptor's skills are ordinary Claude Code plugin skills (`SKILL.md` + `plugin.json`), and it surfaces the user's own `~/.claude/skills`, `~/.claude/commands`, and repo `.claude/` in the `/` picker. cdocs would appear unchanged. The only overlap is philosophical: `sculptor-workflow` (spec/mock/architect/plan/build/review) is a rival opinion to cdocs (propose/review/implement/devlog), but both are just skills you can ignore.
- **UX is a GUI supervision surface, not a multiplexer:** the unit of parallelism is a GUI tab (`Cmd+K`, agent/workspace tabs). No native tmux/wezterm integration, no per-workspace SSH. The `sculpt` CLI (`agent create/send/list`, `workspace`, `run`, `signal`) is an API client that requires the desktop backend running, so it does not replace `claude -p` in a tmux pane.

## Analysis

### lace and Sculptor solve different layers

The two tools are not competitors on the same axis; they sit at orthogonal layers of the stack.

| Concern | lace | Sculptor |
|---|---|---|
| Primary role | Environment/isolation/orchestration layer | Multi-agent supervision + review UI |
| Isolation unit | Devcontainer (podman-first), one container per project | Bare git worktree on host, no container per workspace |
| Parallelism substrate | git worktrees + tmux panes, browsed via sprack | git worktrees + GUI tabs, one backend process |
| Env reproducibility | `devcontainer.json`, OCI features, prebuild caches | None: uses whatever is on the host |
| Ports / preview | Symmetric allocation (22425-22499), portless routing | None: no port mapping |
| Resource bounding | Container-level (cgroups via podman) | None: unbounded thread-per-task |
| Interface | Terminal-native, no GUI | Electron desktop GUI (+ backend-dependent CLI) |
| Claude Code integration | Runs the real TUI in a pane; sprack reads status | Native harness with full capability surface |
| Remote/SSH | wezterm SSH domains / tmux into containers (historical) | Whole-app only via experimental container backend |
| Maturity/security | Personal tooling, actively evolving | Product-grade internals, loopback-only, PR-gated |

### Interrogating the "local-only" claim: it is about granularity, not location

An initial reading suggested Sculptor is a laptop-bound, local-filesystem-only tool.
That is imprecise and worth correcting, because it changes the integration calculus.
Two distinct facts were conflated:

1. **Per-agent isolation is intentionally absent.**
   Imbue ran each agent in its own Docker container in an earlier iteration and removed it deliberately (`docs/history.md`): the isolation blocked the cross-agent visibility they found powerful, confused users, and depended on Docker Desktop's macOS performance. This is a product stance, not a missing feature.
2. **Whole-backend runtime is fully configurable.**
   The Custom Backend Command runs the entire backend (and thus every agent and worktree) wherever a shell command can print a URL: a Docker container, a VM, a remote SSH host, or a cloud platform. The `Environment` interface is provider-agnostic by construction, and `LocalEnvironment` already carries cloud accommodations (Modal PID-namespace handling). "Local" denotes co-location with the backend, not the user's laptop.

The correct summary: **Sculptor's isolation boundary is the whole application, chosen once at the runtime layer, whereas lace's boundary is the individual workspace.**
That is a fundamental difference in the *problem being solved*, not merely a difference in capability. lace exists to give each workspace a reproducible, isolated, port-mapped environment; Sculptor exists to let many agents collaborate over one shared substrate whose location you configure globally.

### As a replacement: no

Replacing lace with Sculptor means adopting its Electron/Python/SQLite stack whole (no supported embedding mode), inheriting a local-only loopback security model, and - critically - **losing every isolation and reproducibility guarantee lace exists to provide**.
For "heavy multi-tasking" specifically, Sculptor is the weaker engine: unbounded thread-per-task concurrency with no scheduler and no per-agent resource isolation means a single runaway agent competes with all others and the UI, and agents can even share one worktree's files simultaneously.
Its strength is supervising a *handful* of agents with a good review UX, not safely fanning out to many resource-bounded environments.

### As an integration: plausible but with real friction

Because the tools occupy different layers, the interesting shape is **Sculptor on top of lace**, and the Custom Backend Command is a cleaner seam than first assessed.
Point Sculptor's backend command at a **lace devcontainer**: lace provisions the reproducible, podman-isolated, port-mapped, prebuilt container, and Sculptor runs its backend inside that one lace-provided environment, supervising N agents across worktrees within it.
This maps naturally onto Sculptor's own model, since its supported container-backend mode already runs the whole app in one container: **one lace environment = one Sculptor substrate, many agents inside.**
lace supplies exactly what Sculptor omits (reproducibility, host-isolation, ports, prebuilds); Sculptor supplies the multi-agent supervision UI and skills.

Residual friction:
- The unit is *one* lace environment shared by all of that instance's agents, not one-per-agent. That is acceptable, since per-agent isolation is the thing Sculptor deliberately rejected, but it means lace's per-workspace isolation is not exploited at agent granularity.
- The custom backend command is explicitly labeled unstable, with a changing backend interface, and has rough edges (double identity prompts, manual macOS `claude` auth, manual restarts).
- The `sculpt` CLI is a client of a running desktop backend, so it does not slot into tmux panes the way `claude -p` does; lace's terminal-native workflow does not survive inside the Sculptor UI.
- The Sculptor *desktop app* still runs on the host and connects in; only the backend relocates into the lace container.

A lighter-weight alternative is to treat Sculptor purely as an optional GUI front-end launched against a lace-managed repo on the host, accepting that agents then run *outside* lace's containers. That is the path of least resistance but forfeits isolation.

### What is worth borrowing regardless

- The **backend-for-frontend WebSocket view-model streaming** (snapshot + deltas over one socket) is a clean pattern if lace ever grows a richer status surface beyond sprack.
- The **capability-bool harness abstraction** and additive-MCP handling are a tidy reference for how to wrap Claude Code without clobbering user config.
- The **skills-as-plugins model** confirms cdocs is portable: it already works inside Sculptor unchanged, which de-risks any future GUI experiment.

## Recommendations

1. **Do not replace lace with Sculptor.** They are different layers; Sculptor discards lace's core value (reproducible, resource-bounded, port-mapped isolated environments) and is weaker at true heavy parallelism.
2. **Keep lace as the environment/orchestration layer.** It remains the right substrate for many resource-bounded, reproducible parallel agents.
3. **Treat Sculptor as a supervision-UX reference, not a dependency.** Mine its BFF streaming and harness-capability patterns; adopt none of its stack.
4. **If a GUI supervision surface is a genuine goal, spike the Custom-Backend-Command-into-lace integration.** Concretely: set Sculptor's Custom Backend Command to launch its backend inside a lace devcontainer (adapting `container/recipes/docker/run-backend.py`), confirm agents inherit lace's isolated, port-mapped environment, and measure the residual friction above (unstable interface, shared-substrate granularity, host-side desktop app). Scope it as a throwaway experiment. Expect the terminal-native workflow to be the casualty.
5. **Do not wait for per-workspace container backends.** Per-agent isolation is a deliberate product rejection in Sculptor, not a roadmap gap, so it is unlikely to arrive. The realistic ceiling for composition is the whole-backend seam in recommendation 4; evaluate against that, not against a hypothetical per-workspace-container Sculptor.

> NOTE(claude-opus-4-8/sculptor-assessment): This is a reference assessment, not a decision proposal.
> A follow-up proposal should be authored only if the user decides to pursue the integration spike in recommendation 4.
