---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-02T08:45:00-08:00
task_list: lace/devcontainer-architecture
type: report
state: archived
status: done
tags: [git, worktrees, devcontainer, agents, parallelism, btrfs, analysis]
---

# Git Parallelism Strategies for Agent-Oriented Devcontainer Workspaces

> BLUF: Lace's current bare-repo + worktree architecture is a strong default for multi-agent parallelism, but carries shared-state risks when agents run unsupervised git operations. For fully isolated agent workspaces, `git clone --local` on the host's BTRFS filesystem provides full independence with near-zero incremental disk cost via hardlinks, and BTRFS reflink copies offer an even stronger option. A widely-shared recommendation to use `git clone --local --filter=blob:none` for local blobless clones is incorrect: `--local` silently bypasses the filter, producing a full clone. This report evaluates seven strategies across safety, performance, tooling compatibility, and disk cost.

## Context / Background

Lace provisions devcontainers for AI coding agents, currently mounting a bare git repository at `/workspace/` with multiple worktrees accessible simultaneously. As agent parallelism scales (multiple Claude Code instances, multi-agent orchestration), the git strategy underpinning workspace isolation becomes a critical architectural decision.

A conversation with Gemini 2.5 recommended `git clone --local --filter=blob:none` as the optimal approach. This report independently verifies those claims and evaluates the full landscape of options against Lace's specific constraints:

- **Host filesystem:** BTRFS (supports CoW reflinks)
- **Source repository:** Local on the same machine (not network-remote)
- **Consumers:** LLM agents running with elevated permissions (`--dangerously-skip-permissions`)
- **Tooling:** VS Code, neovim, WezTerm, language servers, `git-worktree-manager` extension
- **Current architecture:** Bare repo + worktrees, all mounted into a single container

## Key Findings

- **Gemini's headline recommendation is wrong.** `git clone --local --filter=blob:none` does not produce a blobless clone. The `--local` flag bypasses the pack protocol entirely, causing `--filter` to be silently ignored. The result is a full clone with hardlinks. To get an actual local blobless clone, you must use `--no-local --filter=blob:none` or the `file://` URL scheme.
- **Gemini's comparison table is mostly accurate.** `--shared` does only share the object database (not config, hooks, or remotes). Worktree config is shared by default (per-worktree config requires opt-in via `extensions.worktreeConfig`). GC risk with `--shared` is real and documented.
- **BTRFS changes the calculus.** On a CoW filesystem, `cp --reflink=auto` of a `.git` directory produces an instant, space-efficient, fully independent clone. This is a stronger option than any git-native strategy for the local-source scenario.
- **Worktrees have a shared-stash surprise.** `git stash` entries are global across all worktrees, not per-worktree. An agent stashing in one worktree pollutes the stash list in all others.
- **VS Code added native worktree support** in v1.103 (July 2025), though bare-repo setups still have known bugs.

## Strategy Analysis

### 1. Git Worktrees (Current Lace Approach)

Worktrees share a single object store and ref namespace. Each worktree has its own HEAD, index, and working directory.

**What is shared vs. independent:**

| Shared (all worktrees) | Independent (per-worktree) |
|---|---|
| `.git/objects/` | Working directory |
| `.git/config` (default) | `HEAD` |
| All refs under `refs/` | Index / staging area |
| Remotes | `config.worktree` (opt-in) |
| Hooks | `refs/bisect`, `refs/worktree` |
| **Stashes** (surprising) | Pseudo-refs |

**Strengths for Lace:**
- Near-instant creation, minimal disk overhead
- All worktrees available simultaneously in the container
- WezTerm worktree picker already integrates with this model
- `git-worktree-manager` VS Code extension in the devcontainer config

**Risks for unsupervised agents:**
- `git gc --prune=now` in any worktree can remove objects needed by in-progress operations in other worktrees. Standard `git gc` has a 2-week grace period, but agents may invoke aggressive pruning.
- Branch deletion (`git branch -D`) affects all worktrees globally.
- `git stash push` in one worktree pollutes the global stash list.
- Each worktree must be on a different branch (enforced by git). Agents cannot simultaneously check out `main` in two worktrees without `--detach`.
- Auto-GC runs on `git pull`, `git merge`, `git rebase`, and `git commit` via `git maintenance run --auto`. Normal agent operations trigger it.

**Submodule caveat:** The git documentation still warns that "Multiple checkout in general is still experimental, and the support for submodules is incomplete." `git worktree move` and `git worktree remove` refuse to work with initialized submodules.

### 2. Blobless Clone (`--filter=blob:none`)

Clones all commits and trees but skips blobs, fetching them lazily on demand from the "promisor remote."

**The `--local` trap (Gemini's error):**

| Command | Transport | Filter Applied? |
|---|---|---|
| `git clone --filter=blob:none /path/to/repo` | Local (hardlinks) | **No** -- silently ignored |
| `git clone --local --filter=blob:none /path/to/repo` | Local (hardlinks) | **No** -- same as above |
| `git clone --no-local --filter=blob:none /path/to/repo` | Pack protocol | Yes |
| `git clone --filter=blob:none file:///path/to/repo` | Pack protocol | Yes |

When git sees a local path, it defaults to `--local` mode, which hardlinks object files directly. The `--filter` option requires the pack protocol to negotiate which objects to transfer. Since `--local` bypasses that protocol, the filter has no effect and no warning is emitted.

**Failure modes:**
- If the promisor remote becomes unreachable (container loses mount, source repo moved/deleted), any operation touching a missing blob fails with `fatal: could not fetch <hash> from promisor remote`. There is no graceful degradation.
- For the devcontainer scenario: the promisor remote would be a `file://` path. If the host mount disappears or the source path changes, the agent's repo becomes partially broken with no self-repair mechanism.

**When it makes sense:**
- Large repos with huge binary history where you want to avoid cloning all blobs upfront
- Remote (network) cloning where bandwidth is a real constraint
- Not the local-to-local scenario Lace uses, where hardlinks already minimize cost

### 3. `--shared` Clone

Creates an independent `.git` directory but shares the object store via `.git/objects/info/alternates`.

**What is independent (unlike worktrees):**
- `.git/config`, hooks, remotes, stashes, refs -- all independent
- Only the object database is borrowed

**GC corruption risk is real and documented.** The git documentation explicitly warns: "NOTE: this is a possibly dangerous operation; do not use it unless you understand what it does." If the source repo prunes objects that the shared clone still references, the clone becomes corrupt. GitLab encountered real issues with alternates + repacking at scale and contributed upstream fixes in Git v2.41.

Running `git gc` in the **clone** is safe (the `--local` flag to `git repack` avoids repacking objects from alternates). The danger is GC in the **source** after objects are made unreachable there but remain reachable in the clone.

**Verdict:** The independent config/refs/hooks are attractive for agent isolation, but the GC corruption risk makes this unsuitable for a setup where agents run unsupervised.

### 4. `--reference` and `--reference --dissociate`

`--reference` borrows objects from a local repo to reduce network transfer during a remote clone. The alternates entry remains, carrying the same GC risks as `--shared`.

`--reference --dissociate` borrows objects during the clone, then runs `git repack -a -d` to copy all borrowed objects locally and removes the alternates file. The result is a fully independent repo that was cheaper to create than a fresh remote clone.

**For Lace:** Useful if the workflow involves cloning from a remote (GitHub) but wanting to avoid redundant downloads. Not relevant for the local-source scenario where `--local` already avoids network transfer entirely.

**LFS caveat:** Git LFS does not work with `--dissociate`. LFS objects are not borrowed via alternates and are downloaded from the remote regardless.

### 5. Full Local Clone (`git clone /path/to/repo`)

The simplest option. Git defaults to `--local` mode for path-based sources, hardlinking immutable objects in `.git/objects/`. Only the working directory is fully copied.

**Disk cost on same filesystem:**
- `.git/objects/`: Zero additional space (hardlinks share inodes)
- Working directory: Full copy of checked-out files
- For a repo with 1 GB of objects and 200 MB of working tree: ~200 MB per additional clone

**Safety:** Complete isolation. Each clone is a fully independent repository. An agent running `rm -rf .git` or `git gc --prune=now` or any destructive command affects only its own clone.

**Tooling compatibility:** Perfect. It is an ordinary git repository. Every tool, extension, language server, and CI system works without modification.

**Hardlink safety:** Git objects are immutable and content-addressed. Once written, an object file is never modified in place. Hardlinks are safe because the underlying data never changes. (Note: CVE-2024-32020/32021 identified a multi-user attack vector for hardlinked files, but this is irrelevant for single-user agent setups.)

### 6. BTRFS Reflink Copy

On BTRFS (which this host uses), `cp --reflink=auto` performs a copy-on-write clone of file data blocks. The initial copy is near-instant and uses almost no additional space. Disk usage grows only as the copy diverges from the source.

```bash
cp --reflink=auto -a /path/to/source/.git /path/to/agent-workspace/.git
cd /path/to/agent-workspace && git checkout HEAD
```

This is not a git operation -- it is a filesystem-level copy. The result is a fully independent `.git` directory that happens to share physical disk blocks with the source via CoW semantics.

**Advantages over git hardlinks:**
- Hardlinks share inodes (deleting the source file does not free space until all hardlinks are removed). Reflinks share data blocks but have independent inodes and metadata.
- Reflinked files can be independently modified (CoW creates new blocks for changes). Hardlinked `.git/objects/` files cannot be modified (git objects are immutable), so this distinction is theoretical for object files but relevant for config/refs/hooks.
- `cp --reflink=auto` copies the **entire** `.git` directory, including config, hooks, and refs. `git clone --local` hardlinks only objects and copies the rest. Reflinks achieve total independence with total space efficiency.

**Disadvantages:**
- Non-standard workflow. Not a git command. Scripts must handle this explicitly.
- Requires BTRFS, XFS with reflink support, or APFS. Not portable across all filesystems.
- No `git remote` configuration in the copy (it inherits the source's remotes, which may or may not be desired).

### 7. Sparse Checkout (Overlay Strategy)

Sparse checkout can be combined with any of the above to reduce working-directory size. Each agent checks out only the directories it needs.

**With worktrees:** Per-worktree sparse patterns are supported via `extensions.worktreeConfig`. Each worktree can check out different directories from the same repo. This is the recommended pairing in the git documentation.

**With blobless clones:** The `--sparse` flag combined with `--filter=blob:none` produces the most minimal clone: only blobs for the sparse-checkout directories are fetched. GitHub's benchmarks show 93% reduction in clone times for Chromium.

**Relevance for Lace:** Lace is not a monorepo with independent subsystems. The entire codebase is a coherent project (~1700 LOC of TypeScript plus config). Sparse checkout adds complexity without meaningful benefit at this scale.

## Comparative Matrix

| Strategy | Disk Cost | Agent Isolation | Safety | Offline? | Tooling | Setup Complexity |
|---|---|---|---|---|---|---|
| **Worktrees** | Very low | Working dir only | Shared refs at risk | Full | Good | Low |
| **Blobless (`--no-local`)** | Medium | Full | Full | No (needs promisor) | Good | Medium |
| **`--shared`** | Very low | Full (except objects) | Source GC risk | Full | Excellent | Low |
| **Full local clone** | Low (hardlinks) | Full | Full | Full | Excellent | Very low |
| **`--reference --dissociate`** | High | Full | Full | Full | Excellent | Medium |
| **BTRFS reflink copy** | Very low (CoW) | Full | Full | Full | Excellent | Medium |
| **Sparse checkout** | Varies | Depends on base | Depends on base | Depends | Variable | High |

## Recommendations

### For single-container, multi-worktree (current model)

Lace's current architecture -- bare repo + worktrees in one container -- is sound for a single-agent or human-supervised setup. The shared object store minimizes disk usage, and the WezTerm worktree picker provides good UX.

**Harden with guardrails:**
- Add a git hook or alias that prevents `git gc --prune=now` (redirect to `git gc` with default expiry)
- Consider setting `gc.pruneExpire` to a longer value (e.g., `6.months.ago`) in the shared config
- Document that agents should not delete branches or force-push in shared worktrees

### For multi-container, multi-agent parallelism

When scaling to multiple agents each in their own devcontainer, **full local clone is the recommended default.** It provides complete isolation with minimal disk overhead (hardlinked objects), perfect tooling compatibility, and zero operational complexity. The command is simply:

```bash
git clone /path/to/source /path/to/agent-N
```

### For disk-optimal multi-agent on BTRFS

Since the host runs BTRFS, consider a **reflink copy** workflow for maximum space efficiency with full independence:

```bash
mkdir -p /path/to/agent-N
cp --reflink=auto -a /path/to/source/. /path/to/agent-N/
```

This produces a fully independent repo that shares physical blocks via CoW. Disk usage grows only as the agent diverges. Unlike hardlinks, this copies config, hooks, and refs as independent (but CoW-deduplicated) files.

### Avoid

- **`git clone --local --filter=blob:none`** -- The filter is silently ignored. This is a full clone that people think is partial.
- **`--shared` clones for agents** -- The GC corruption risk is real and unacceptable for unsupervised agents.
- **Blobless clones with local source** -- Adds promisor-remote dependency and failure modes for no benefit when hardlinks or reflinks already minimize cost.

## Sources

- [git-clone documentation](https://git-scm.com/docs/git-clone) -- `--local`, `--shared`, `--filter`, `--dissociate` semantics
- [git-worktree documentation](https://git-scm.com/docs/git-worktree) -- shared state, locking, submodule warnings
- [git partial-clone design notes](https://git-scm.com/docs/partial-clone) -- promisor remote, lazy fetching
- [gitrepository-layout documentation](https://git-scm.com/docs/gitrepository-layout) -- alternates mechanism
- [GitHub Blog: Get up to speed with partial clone and shallow clone](https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/)
- [GitHub Blog: Bring your monorepo down to size with sparse-checkout](https://github.blog/open-source/git/bring-your-monorepo-down-to-size-with-sparse-checkout/)
- [GitHub Blog: Scaling Git's garbage collection](https://github.blog/engineering/architecture-optimization/scaling-gits-garbage-collection/)
- [GitLab: Rearchitecting Git object database maintenance for scale](https://about.gitlab.com/blog/2023/11/02/rearchitecting-git-object-database-mainentance-for-scale/) -- real-world alternates/GC issues
- [VS Code: Git Branches and Worktrees](https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees) -- native worktree support in v1.103
- [BTRFS deduplication documentation](https://btrfs.readthedocs.io/en/latest/Deduplication.html)
- [CVE-2024-32020](https://github.com/git/git/security/advisories/GHSA-mvxm-9j2h-qjx7) -- local clone hardlink advisory
- [Git LFS --dissociate issue #5993](https://github.com/git-lfs/git-lfs/issues/5993)
- [Nick Mitchinson: Using Git Worktrees for Multi-Feature Development with AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/)
- [Dev.to: Git Worktrees: The Power Behind Cursor's Parallel Agents](https://dev.to/arifszn/git-worktrees-the-power-behind-cursors-parallel-agents-19j1)
