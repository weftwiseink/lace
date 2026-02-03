---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-02T09:15:00-08:00
task_list: lace/devcontainer-architecture
type: report
state: live
status: wip
tags: [git, worktrees, agents, parallelism, operations, sync, ecosystem, analysis]
---

# Operational Tradeoffs of Git Parallelism for Agent Workspaces

> BLUF: The preceding report ([git-parallelism-strategies-for-agent-devcontainers](./2026-02-02-git-parallelism-strategies-for-agent-devcontainers.md)) evaluated the technical fundamentals of each git strategy. This follow-up examines the pragmatic consequences: history management, state synchronization, ecosystem tooling, and the day-to-day operational costs of each approach. Worktrees have a clear ecosystem lead (Cursor, incident.io, Dagger's container-use, a growing community tool ecosystem) and provide a unified history view with zero sync overhead. Separate clones targeting a local source repo offer fine-grained control and complete isolation with moderate coordination costs -- local fetches are near-instant, and the source repo can serve as the aggregation point for branch visibility, but the sync is still an explicit step rather than automatic. The blobless-clone path adds promisor-remote state complexity on top of clone coordination for marginal benefit in the local-source scenario. For Lace's architecture, the key question is not "worktrees or clones" but "how much shared state is acceptable given unsupervised agents."

## Context

The first report concluded that full local clones (with hardlinks or BTRFS reflinks) are the safest isolation strategy, and that worktrees are the most operationally convenient. This report digs into the operational gap between those two positions: what you gain and what you pay for with each model, grounded in real-world patterns from the 2025 agent ecosystem.

## History Management

### The unified-history advantage of worktrees

In a worktree setup, `git log --all --graph` from any worktree shows every branch, every commit, every agent's work. There is one reflog per branch, one set of remote-tracking refs, one object store. This is not a minor convenience -- it is the difference between "what are my agents doing?" being a single command and being a multi-repo coordination problem.

With separate clones, an agent's commits are invisible to every other clone until pushed. In Lace's scenario, where clones target a local source repo (the bare repo on the same machine), the source repo serves as the natural aggregation point -- agents push there, and `git log --all` on the source shows all pushed branches. This is significantly more practical than requiring a network remote like GitHub as the coordination hub, but it is still an explicit step: commits are invisible until the agent pushes, and other clones must fetch to see them. Local-only branches, in-progress rebases, and stashed work remain siloed per clone.

### The stash and reflog problem

Worktrees share stashes globally. An agent running `git stash push` in worktree A pollutes the stash list in worktree B. This is a real footgun -- if agent B runs `git stash pop` expecting its own stash, it gets agent A's changes instead. The mitigation is straightforward (agents should not use `git stash`; use commits on throwaway branches instead), but it requires the agent to know this constraint.

Reflogs are per-branch in the shared `.git/logs/refs/` directory. An agent's reflog entries for branch `feat-auth` are visible from any worktree. This is mostly beneficial (audit trail), but means one agent's `git reset --hard` entries appear in another agent's reflog view for the same branch. With worktrees, each agent must be on a different branch, so this cross-contamination only matters if an agent inspects another agent's branch reflog.

With separate clones, reflogs and stashes are completely independent. Clean isolation, but no cross-visibility.

### Orphan cleanup

Worktrees: `git worktree prune` removes metadata for worktrees whose directories were deleted. `git gc` has a 3-month grace period for stale worktree metadata (`gc.worktreePruneExpire`). The community tools (Cursor's auto-cleanup at configurable intervals, `parallel-cc`'s auto-clean on exit) address lifecycle management, but it remains habit-based by default.

Separate clones: cleanup is `rm -rf`. No git-level lifecycle management. Simpler in one sense (delete the directory and it's gone), but no tooling to distinguish "this clone is abandoned" from "this clone is in use."

## State Synchronization

### Sync cost: zero vs. N local fetches

The most significant operational difference is fetch overhead -- but the magnitude depends on whether clones target a local or network source.

**Worktrees:** `git fetch` once updates remote-tracking refs for all worktrees. One operation, one pack negotiation. Every agent immediately sees the latest remote state. This is the zero-coordination baseline.

**Clones targeting a local source:** Each clone fetches independently from the local bare repo. On the same BTRFS filesystem, this is disk I/O, not network -- near-instant for incremental fetches pulling a few new commits. The practical cost is not latency but coordination: someone (a script, a hook, a post-commit trigger) must ensure agents fetch when there is new work to see. N fetches of the same objects still means N pack negotiations and N sets of pack files written, though on NVMe this is measured in milliseconds, not seconds.

The real cost of N local fetches is not performance but **orchestration complexity.** With worktrees, the shared state is always current. With local clones, you need a mechanism to keep clones in sync -- whether that is periodic polling, post-push hooks on the source repo that notify clones, or agents fetching before each operation. None of these are hard, but they are infrastructure that worktrees make unnecessary.

### Branch visibility and coordination

Worktrees enforce a constraint that is both a limitation and a safety feature: **no two worktrees can check out the same branch.** This prevents two agents from moving the same branch HEAD in conflicting directions. If agent A is on `feat-auth`, agent B physically cannot check out `feat-auth` without detaching HEAD.

With separate clones, there is no such guard. Two agents can check out `main`, both make commits, and you discover the divergence only when the second push to the source repo fails. This is a real hazard in automated workflows where agents don't coordinate.

On the other hand, worktrees share `git branch -a` output. Every agent can see every other agent's branch. This enables patterns like "check if another agent is already working on this file" before starting work -- Anthropic's best practices explicitly recommend this.

With local clones, branch visibility is available through the source repo -- but only for pushed branches. An agent can `git fetch origin && git branch -r` to see what other agents have pushed to the local source. This is a weaker form of the worktree model's automatic visibility: it requires an explicit fetch and only shows committed+pushed work, not in-progress branches. An orchestrator could mitigate this by having agents push early and often (even WIP commits), using the source repo as a real-time coordination bus.

### Propagating work back

**Worktrees:** An agent commits on its branch. That commit is immediately visible from any other worktree or from the bare repo. Opening a PR is just `gh pr create`. No intermediate push-to-self step.

**Local clones:** An agent commits locally, then pushes to the local source repo. The push is a local disk operation -- fast and reliable as long as the source is accessible. Other agents (or a human) can then fetch from the source. The source repo becomes the coordination hub, analogous to how GitHub serves this role in distributed teams but without network latency.

A useful pattern: configure a `post-receive` hook on the local source repo that logs or notifies when agents push. This gives passive visibility ("agent-3 just pushed to `agent/3/feat-billing`") without requiring agents to actively poll.

For Lace's current architecture (bare repo + worktrees in one container), the sync cost is literally zero. For a multi-container clone-based architecture targeting the same local bare repo, the sync cost is low (local push/fetch) but nonzero -- the coordination step exists even if it is fast.

### Merge conflict discovery

Both approaches defer conflict discovery to merge time. The difference is **when you find out.**

With worktrees, you can run `git diff feat-auth..feat-billing -- src/` from any worktree to see if two agents' branches touch overlapping files, before either merges. Several teams now ask the agent itself to assess conflict potential before parallelizing work.

With local clones, this analysis can be performed on the source repo itself (where all pushed branches converge), or by fetching both branches into any single clone. The source repo is the natural place to run cross-agent conflict analysis -- it sees all pushed work without needing to fetch. An orchestration script on the source repo could even block conflicting agent tasks proactively.

## Ecosystem Affordances

### Worktrees: a growing ecosystem

The agent-development ecosystem has converged on worktrees as the standard parallelism primitive. Key signals:

**IDE support:**
- Cursor's Parallel Agents are built entirely on worktrees (max 20 per workspace, auto-cleanup, `.cursor/worktrees.json` for setup scripts). Notable limitation: **no LSP in worktrees**, so agents cannot lint or type-check.
- VS Code added native worktree support in v1.103 (July 2025). Before that, `git-worktree-manager` (already in Lace's devcontainer.json) filled the gap.
- GitKraken (v10.5+), Tower (v12.5+), and lazygit (master) all support worktrees.

**Agent tooling:**
- Dagger's `container-use` combines worktrees with containers -- each agent gets a worktree for git isolation and a container for environment isolation.
- `CCManager` manages multiple Claude Code sessions across worktrees, copying session data for context continuity.
- `parallel-cc` auto-creates isolated worktrees per Claude Code session with auto-clean on exit.
- `CCPM` integrates GitHub Issues with worktrees, marking tasks `parallel: true` for concurrent development.
- `agenttools/worktree` provides Claude Code integration with tmux session management.
- incident.io's custom `w` function automates worktree creation with username-prefixed branches.

**Git tooling:**
- Git Town (v14+) is worktree-aware: skips branches unavailable in the current worktree, handles sync in linked worktrees.
- `git-branchless` shares its event log across worktrees (commits in one worktree visible in another's log).
- `gh` CLI still lacks native worktree support for `gh pr checkout` (issue #972, open since 2020), but third-party extensions (`gh-worktree`, `worktree-cli`, `ghwt`) fill the gap.

### Local clones: mature, universal, unspecialized

Separate clones work with every tool because they are just normal repos. There is no "clone management" ecosystem because there is nothing special to manage -- each clone is independent. This is both the strength (universal compatibility) and the weakness (no coordination tooling).

For local-source clones specifically, the coordination patterns are simple even if no tool automates them:
- The local source repo is a bare repo that all clones push to and fetch from. Standard git.
- `post-receive` hooks on the source repo can log agent activity, trigger cross-agent notifications, or run conflict-detection scripts.
- A simple wrapper script can create a clone, configure its remote to point to the local source, install hooks, and set agent-specific `user.name` -- all in a few lines of shell.
- The source repo's `git log --all --graph` is the unified dashboard.

The key difference from worktrees is that this coordination is **opt-in infrastructure you build** rather than **inherent properties of the shared `.git` directory.** That is a cost (you build and maintain it) and a benefit (you control exactly what is shared and when).

The cloud-agent space uses similar patterns at larger scale:
- OpenAI Codex uses full clone isolation per task in cloud containers.
- Devin 2.0 uses VM-per-task with full clones.
- Spotify's fleet agent system uses separate clones per repository (their agents span different repos entirely).

These are all "heavy isolation" patterns where the clone is ephemeral and the remote (or local source) is the source of truth. They invest in orchestration layers (GitHub Actions, Codex platform, Devin's manager agent) rather than git-level coordination tooling.

### Pre-commit hooks: a real pain point for worktrees

Hooks are shared across worktrees (they live in `.git/hooks/`). This is usually desirable but creates known bugs:

- The `pre-commit` framework has had issues installing hooks to the wrong directory in worktree setups.
- `check-added-large-files` broke in worktrees due to path resolution of `COMMIT_EDITMSG`.
- `pip-compile` as a pre-commit hook can corrupt the worktree index.
- Setting `core.hooksPath` per-worktree is unreliable with some tools.

With clones, each clone has independent hooks. No path confusion, no shared-state bugs. But hooks must be installed independently in each clone (`pre-commit install`), which is an extra setup step per agent workspace.

## The Blobless Path: Complexity Compounds

The blobless clone (`--filter=blob:none`) inherits all of the clone-based coordination costs and adds its own:

**Promisor-remote dependency:** Every `git checkout`, `git diff`, or `git log -p` that touches a missing blob triggers a fetch to the promisor remote. With a local `file://` promisor (the source bare repo on the same machine), this fetch is disk I/O, not network -- individually fast. But the dependency is structural: if the source repo becomes inaccessible (container loses its mount, path changes after a host reconfiguration), the agent's repo enters a partially-broken state. The error (`fatal: could not fetch <hash> from promisor remote`) gives no guidance on recovery. In the local-source scenario, this is less likely than with a network remote but still a failure mode that full clones and worktrees simply don't have.

**Latency is low but unpredictable:** With a local `file://` promisor, individual blob fetches are fast (sub-millisecond on NVMe). But the overhead is per-operation: each missing blob triggers pack negotiation, object resolution, and transfer. For an agent making many small reads (exploring the codebase, running `git log -p`, checking out multiple branches), these add up. A full local clone pays the cost once at clone time; a blobless clone pays it incrementally across the agent's lifetime. On local disk the absolute cost is small, but the unpredictability -- some operations are instant (blob cached), others pause for a fetch (blob missing) -- can confuse agent tooling that expects deterministic performance.

**Complexity without proportional benefit:** The blobless design solves a real problem: cloning a multi-gigabyte repo over a network. In the local-source scenario, `git clone /path/to/repo` already avoids that cost via hardlinks (zero-copy of objects, only working directory duplicated). BTRFS reflinks go further with `cp --reflink=auto` (zero-copy of everything). Blobless clones add ongoing state complexity (which blobs are present? which are promised?) for an upfront-cost savings that local clones and reflinks already achieve through simpler means.

**State is harder to reason about:** A blobless clone's `.git/objects/` is a mix of locally-present and remote-promised objects. There is no simple way to audit which blobs are present without querying the promisor remote. `git fsck` reports missing objects as expected (they are promised, not missing), but the distinction between "promised and fetchable" and "promised but unfetchable" is invisible until you try. This invisible state partition is the fundamental complexity cost: every other strategy discussed in this report gives you a repo where either all objects are present (full clone, worktree) or all are explicitly shared via a known mechanism (alternates). Blobless clones introduce a third category -- "probably fetchable" -- that resists static analysis.

## The Real Question for Lace

The first report framed this as a choice between strategies. In practice, the question is narrower: **how much shared state is acceptable for unsupervised agents?**

Lace's current architecture (bare repo + worktrees, single container) works because:
1. A human is supervising via WezTerm worktree picker
2. Agents operate on separate branches
3. The shared object store and refs are a feature, not a bug -- they enable the unified-history and zero-sync properties

The risk surface is specific and enumerable:
- `git gc --prune=now` (mitigable with hooks or config)
- Branch deletion (mitigable with branch protection patterns)
- Stash pollution (mitigable by not using stash)
- Lock contention during concurrent fetch/gc (mitigable with `git maintenance` incremental strategy)

Separate clones targeting the local source repo eliminate these risks with moderate costs:
- N local fetches instead of 0 (fast on disk, but requires orchestration to trigger)
- The source repo serves as the unified history view (not GitHub), but only for pushed work -- in-progress branches remain invisible
- No automatic branch-visibility guard, though agents can `git fetch && git branch -r` to check; the source repo can run conflict-detection scripts via `post-receive` hooks
- Per-clone hook installation, credential setup, and config management (automatable in devcontainer setup scripts)
- Fine-grained control over what each agent sees and when (a genuine advantage for orchestration scenarios where you want to stage information flow between agents)
- No existing ecosystem tooling for "clone fleet" coordination, though the patterns are straightforward (push/fetch against a shared local source)

The emerging industry pattern -- Dagger's container-use model -- suggests the answer is **worktrees for git isolation, containers for environment isolation.** This is essentially what Lace already does: a single bare repo with worktrees, inside a devcontainer that provides the compute environment.

## Recommendations

### Short-term: harden the worktree model

The current architecture's risks are all mitigable without changing the fundamental approach:

1. **Prevent dangerous GC:** Set `gc.pruneExpire = 6.months.ago` in the shared config. Add a `pre-gc` hook or git alias that blocks `--prune=now`.
2. **Isolate stashes:** Configure agents to use `git stash push --message "agent-<name>:..."` with naming conventions, or (better) avoid stash entirely in favor of WIP commits on throwaway branches.
3. **Use `git maintenance`:** Replace ad-hoc `git gc` with `git maintenance run --task=incremental-repack` for safer concurrent operation.
4. **Branch naming conventions:** Enforce agent-prefixed branch names (`agent/<session-id>/feat-auth`) to prevent collisions and enable monitoring.

### Medium-term: evaluate the hybrid model

If Lace scales to multi-container agent orchestration, the Dagger container-use pattern (worktree per agent, container per agent) maps directly onto the existing architecture. Each agent container mounts the bare repo and creates its own worktree. This preserves the unified history and zero-sync properties while adding container-level environment isolation.

### When to use local clones instead

Local clones targeting the bare source repo become the right answer when:
- **Complete GC isolation** is non-negotiable and hook-based mitigation is insufficient
- Agents need **different git configurations** (user.name, signing keys) that cannot be managed via `extensions.worktreeConfig`
- You want **explicit control over information flow** between agents (an agent only sees what it fetches, and you control when fetches happen)
- You need **independent hook configurations** per agent (different pre-commit rules, different CI integrations)
- Agents operate across **different repositories** (Spotify's pattern) -- though this is a different scenario from Lace's single-repo model

The local-source scenario makes clones significantly more practical than the network-remote case: creation is near-instant (hardlinks on same filesystem, or BTRFS reflinks for complete CoW), push/fetch is disk I/O, and the source repo serves as a natural coordination hub. The main trade is moving from automatic shared state (worktrees) to explicit sync (push/fetch against the local source) -- which is a cost in orchestration complexity but a gain in isolation and control.

## Sources

- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices) -- worktree recommendations
- [incident.io: Shipping Faster with Claude Code and Git Worktrees](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees) -- real-world worktree workflow
- [Cursor: Parallel Agents / Worktrees Documentation](https://cursor.com/docs/configuration/worktrees) -- no LSP, auto-cleanup, setup scripts
- [Dagger: container-use](https://github.com/dagger/container-use) -- worktree + container hybrid
- [InfoQ: Container Use for Isolated Parallel Coding Agents](https://www.infoq.com/news/2025/08/container-use/)
- [Spotify: Background Coding Agent (3-part series)](https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1) -- fleet-scale clone-per-repo
- [OpenAI Codex Security Documentation](https://developers.openai.com/codex/security/) -- container isolation model
- [Cognition: Devin 2.0](https://cognition.ai/blog/devin-2) -- VM-per-task isolation
- [GitHub Blog: Welcome Home, Agents (Agent HQ)](https://github.blog/news-insights/company-news/welcome-home-agents/) -- governance layer
- [gh CLI: worktree checkout support (Issue #972)](https://github.com/cli/cli/issues/972) -- still open
- [pre-commit: hooks in worktrees (Issue #808)](https://github.com/pre-commit/pre-commit/issues/808)
- [Claude Code: index.lock contention (Issue #11005)](https://github.com/anthropics/claude-code/issues/11005)
- [Git Town Changelog](https://github.com/git-town/git-town/blob/main/CHANGELOG.md) -- worktree-aware features
- [git-branchless: shared event log](https://github.com/arxanas/git-branchless/releases)
- [Nick Mitchinson: Git Worktrees for Multi-Feature Development with AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/)
- [Nx Blog: How Git Worktrees Changed My AI Agent Workflow](https://nx.dev/blog/git-worktrees-ai-agents)
- [Steve Kinney: Git Worktrees for AI Development](https://stevekinney.com/courses/ai-development/git-worktrees) -- conflict analysis before parallelizing
- Prior report: `cdocs/reports/2026-02-02-git-parallelism-strategies-for-agent-devcontainers.md`
