---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T12:00:00-08:00
task_list: lace/devcontainer-features
type: devlog
state: live
status: done
tags: [claude-code, neovim, devcontainer-features, proposals, documentation, weftwise, migration]
---

# Claude Code & Neovim Features, Docs + Migration Proposals: Devlog

## Objective

Three parallel workstreams in one session:

1. **Scaffold two new devcontainer features** (claude-code, neovim) that follow the wezterm-server feature conventions, each with lace mount declarations for persistent state.
2. **Propose lace documentation improvements** -- architecture overview, troubleshooting, migration guide, and contributing guidelines.
3. **Propose weftwise devcontainer migration** to lace idioms, replacing ~60 lines of manual Dockerfile/config with feature-based abstractions.

## Plan

1. Explore both codebases in parallel (lace idioms, weftwise devcontainer setup)
2. Create both proposals via `/propose` in parallel
3. Cross-reference proposals for mutual improvements
4. Review both proposals via `/review` in parallel
5. Q&A with user on design decisions (feature granularity, mount strategy, shell choice)
6. Address all blocking review items + integrate Q&A decisions in parallel
7. Scaffold claude-code and neovim features in parallel
8. Commit, devlog

## Testing Approach

Features are scaffolds only -- no runtime testing in this session. Install scripts follow the wezterm-server pattern (verified working). Testing plan will be proposed in a follow-up session.

## Implementation Notes

### Design Decisions from Q&A

**Install path (hybrid):** Generic user tools (neovim, claude-code) become devcontainer features; project-specific tools (Playwright, Electron, pnpm) stay in the Dockerfile. Lace prebuilds cache the feature installations.

**Mount strategy (per-tool, feature-injected):** Features declare their own mounts via `customizations.lace.mounts` in `devcontainer-feature.json`. Lace auto-injects these -- the project's `devcontainer.json` only needs to declare project-specific mounts (nushell-config). This keeps the project config clean while giving fine-grained control.

Final mount map for weftwise:

| Mount | Target | Declared by |
|-------|--------|-------------|
| claude-code/config | /home/node/.claude | claude-code feature |
| neovim/plugins | /home/node/.local/share/nvim | neovim feature |
| wezterm-server/authorized-keys | /home/node/.ssh/authorized_keys | wezterm-server feature |
| project/nushell-config | /home/node/.config/nushell | project devcontainer.json |

**Nushell as primary shell:** Bash history mount dropped. Nushell config + history colocate under `~/.config/nushell/`, so one mount covers both.

**Neovim plugin persistence:** Mount `~/.local/share/nvim` (not `~/.config/nvim` which comes from project's `lace/config/nvim/`). Eliminates ~30s plugin re-download on container rebuild.

### wez-into Port Discovery

Review flagged an unverified claim that `wez-into` reads `.lace/port-assignments.json`. Investigation confirmed it does NOT -- `wez-into` delegates to `lace-discover` which queries Docker container labels and port mappings at runtime via `docker ps`. Entirely Docker-label-based, not file-based. Migration proposal corrected.

### Review Outcomes

**Docs proposal (verdict: Revise, 2 blocking):**
- Contributing guide moved to `CONTRIBUTING.md` at repo root (GitHub discoverability)
- Added staleness mitigation: source-code cross-reference comments + major-version verification notes

**Migration proposal (verdict: Revise, 4 blocking):**
- wezterm-server in `features` (entrypoint) AND `prebuildFeatures` (cache), not just one
- `recommendedSource` is user guidance, not runtime fallback -- clarified throughout
- wez-into port reading corrected per investigation
- Prerequisites tracking table added

All blocking items addressed in revision pass.

## Changes Made

| File | Description |
|------|-------------|
| `devcontainers/features/src/claude-code/devcontainer-feature.json` | Feature metadata: version option, lace mount declaration for ~/.claude |
| `devcontainers/features/src/claude-code/install.sh` | POSIX install script: npm global install, config dir creation, ownership |
| `devcontainers/features/src/claude-code/README.md` | Usage docs, options table, mount persistence explanation |
| `devcontainers/features/src/neovim/devcontainer-feature.json` | Feature metadata: version option, lace mount for plugin state |
| `devcontainers/features/src/neovim/install.sh` | POSIX install script: GitHub release tarball, arch detection, no distro logic |
| `devcontainers/features/src/neovim/README.md` | Usage docs, options table, plugin persistence explanation |
| `cdocs/proposals/2026-03-03-documentation-idioms-and-usage-guide.md` | Proposal: 4 new docs (architecture, troubleshooting, migration, contributing) |
| `cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md` | Proposal: 7-phase incremental migration of weftwise to lace idioms |
| `cdocs/reviews/2026-03-03-review-of-documentation-idioms-and-usage-guide.md` | Review with 2 blocking, 8 non-blocking findings |
| `cdocs/reviews/2026-03-03-review-of-weftwise-devcontainer-lace-migration.md` | Review with 4 blocking, 6 non-blocking findings |

## Verification

**Commit:**
```
7dadccc feat: scaffold claude-code and neovim devcontainer features, propose docs and weftwise migration
 10 files changed, 1821 insertions(+)
```

**Feature file structure matches wezterm-server conventions:**
- Each feature has: `devcontainer-feature.json`, `install.sh` (executable), `README.md`
- install.sh scripts use `set -eu`, detect `_REMOTE_USER`, verify installation
- `devcontainer-feature.json` includes `customizations.lace.mounts` declarations

**Both proposals at `status: review_ready`** with all blocking review items addressed.

## Deferred Work

- Runtime testing of feature install scripts (needs container environment)
- Feature publication to GHCR (publication pipeline not yet established)
- `lace init` command for settings.json bootstrapping
- Nushell installation feature (out of scope for this session)
- Implementation of either proposal (pending user approval)
