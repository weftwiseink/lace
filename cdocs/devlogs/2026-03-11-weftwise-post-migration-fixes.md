---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-11T21:30:00-06:00
task_list: lace/weftwise-migration
type: devlog
state: archived
status: result_accepted
tags: [weftwise, devcontainer, mounts, features, git-extensions, post-migration, cleanup]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-11T22:15:00-06:00
  round: 1
related_to:
  - cdocs/proposals/2026-03-11-weftwise-devcontainer-post-migration-fixes.md
  - cdocs/reviews/2026-03-11-review-of-weftwise-devcontainer-post-migration-fixes-r2.md
---

# Weftwise Post-Migration Fixes: Devlog

## Objective

Implement the accepted proposal
`cdocs/proposals/2026-03-11-weftwise-devcontainer-post-migration-fixes.md`
— four fixes across three phases to align the weftwise devcontainer.json with
lace's current idioms and clean up lace's own Dockerfile.

**Key references:**
- Proposal (implementation_accepted): `cdocs/proposals/2026-03-11-weftwise-devcontainer-post-migration-fixes.md`
- Round 2 review (accepted): `cdocs/reviews/2026-03-11-review-of-weftwise-devcontainer-post-migration-fixes-r2.md`
- Original migration: `cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md`
- `_REMOTE_USER` resolution: `cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md`

## Plan

### Phase 1: Update Git Feature and Add Nushell (weftwise)

Edit `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`:

1. Change `"ghcr.io/devcontainers/features/git:1": {}` →
   `"ghcr.io/devcontainers/features/git:1": { "version": "latest" }`
2. Drop `claude-code` version pin: `{ "version": "2.1.11" }` → `{}`
3. Drop `neovim` version pin: `{ "version": "v0.11.6" }` → `{}`
4. Add `"ghcr.io/eitsupi/devcontainer-features/nushell:0": {}`

**Verify:** `lace up --rebuild --skip-validation` succeeds; `git --version`
reports 2.48+; `claude`, `nvim`, `nu` all available.

### Phase 2: Remove Mount Overrides and Align Templates (weftwise)

Edit `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`:

1. Remove both manual mount strings from `mounts` array
2. Replace `"CLAUDE_CONFIG_DIR": "/home/node/.claude"` →
   `"CLAUDE_CONFIG_DIR": "${lace.mount(claude-code/config).target}"`

**Verify:** `lace up` succeeds; `.lace/devcontainer.json` shows auto-injected
mounts with resolved `/home/node/` paths; Claude Code config persists.

### Phase 3: Simplify Lace Dockerfile (lace)

Edit `/var/home/mjr/code/weft/lace/main/.devcontainer/Dockerfile`:

1. Remove `ARG ELECTRON_VERSION`, `ARG PLAYWRIGHT_VERSION`
2. Rewrite `apt-get install` to keep only `curl`, `psmisc`, `sudo`
3. Remove Electron pre-install, Playwright pre-install, `pnpm build:electron`
4. Remove Sculptor TODO comments
5. Keep: prebuild base image, corepack/pnpm, git-delta, workspace/config dirs,
   bash history, SSH dir setup, passwordless sudo, npm global dir, COPY steps

Create `/var/home/mjr/code/weft/lace/main/.dockerignore`.

**Verify:** `lace up --rebuild` succeeds in lace; no Electron/Playwright in
container; `pnpm install --frozen-lockfile` works.

## Testing Approach

Verification is primarily runtime: each phase requires a successful `lace up`
invocation and spot-checking tool availability. No unit tests are added or
modified — these are config-level changes.

Phase 1 and 2 operate on the weftwise repo; Phase 3 on lace. Each phase
should be committed independently to allow rollback.

## Implementation Notes

### Deviation: Phases 1 and 2 combined into a single commit

The proposal specified Phases 1 and 2 as separate commits. During
implementation, I discovered that the manual mount override strings in the
weftwise working copy were **never committed** — they existed only as
uncommitted workaround changes from a previous session. Since Phase 2's "remove
mount overrides" operation was effectively "don't commit them," separating the
commits would have created pointless churn (add then immediately remove). Both
phases were committed together as a single coherent change.

### Discovery: `remoteUser: "node"` required for `_REMOTE_USER` resolution

The proposal did not account for the fact that `parseDockerfileUser()` in
`dockerfile.ts:277-302` returns `null` when the Dockerfile `USER` directive
contains an ARG variable reference (e.g., `USER ${USERNAME}`). The check at
line 292 (`if (username.includes("$")) return null`) correctly treats ARG
references as unresolvable at parse time. Without explicit `remoteUser`,
`extractRemoteUser()` falls through to the default of `"root"`.

This caused the first test to produce mounts at `/home/root/.claude` instead
of `/home/node/.claude`. Adding `"remoteUser": "node"` to the devcontainer.json
resolved the issue. This is standard devcontainer practice — when the Dockerfile
sets a non-root user via build ARGs, the `remoteUser` field should be set
explicitly.

> NOTE(opus/implementation): This was not identified during proposal review
> because the review agent focused on the high-level mount resolution contract
> without tracing the `parseDockerfileUser` → ARG variable → fallback chain.
> The `_REMOTE_USER` resolution proposal tests all used literal `USER` values.

### Phase 3: `--skip-validation` required for `lace up --rebuild`

Both weftwise and lace `lace up --rebuild` required `--skip-validation` because
the git extension check (`relativeWorktrees` requires 2.48+) runs against the
**current** prebuild image before the new one is built. The prebuild's old git
(Debian 2.39.x) fails validation, but the rebuilt image installs `"latest"`
(2.53.0). This is the known chicken-and-egg issue documented in the proposal's
Edge Case E1 and the companion `rebuild-prebuild-before-validation` proposal.

### Phase 3: `lace restore` behavior

After `lace up --rebuild`, `lace restore` reverted the `FROM` line to
`node:24-bookworm`. However, the committed Dockerfile already used
`lace.local/node:24-bookworm` (it was rewritten during a previous `lace up`
and committed). I manually corrected the `FROM` line back to
`lace.local/node:24-bookworm` after restore.

## Changes Made

| File | Description |
|------|-------------|
| `weftwise/.devcontainer/devcontainer.json` | git `"latest"`, dropped version pins, added nushell feature, added `remoteUser: "node"`, removed mount overrides, `CLAUDE_CONFIG_DIR` template |
| `lace/.devcontainer/Dockerfile` | Removed Electron/Playwright ARGs, apt deps, pre-installs, build step, Sculptor TODOs |
| `lace/.dockerignore` | New file: excludes node_modules, .git, .lace, dist, .vscode, tmp, packages/*/bin |

## Verification

### Phase 1+2: Weftwise (combined)

**`lace up --rebuild --skip-validation` succeeded.**

Tool versions inside container:
```
$ docker exec weftwise git --version
git version 2.53.0

$ docker exec weftwise nu --version
0.111.0

$ docker exec weftwise claude --version
2.1.73 (Claude Code)

$ docker exec weftwise nvim --version | head -1
NVIM v0.11.6
```

Mount resolution (from `.lace/devcontainer.json`):
```
source=/home/mjr/.config/nushell,target=/home/node/.config/nushell,type=bind
source=/home/mjr/.config/lace/ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly
source=/home/mjr/.claude,target=/home/node/.claude,type=bind
source=/home/mjr/.local/share/nvim,target=/home/node/.local/share/nvim,type=bind
```

All 4 mounts auto-injected with `/home/node/` paths (no manual overrides).

`CLAUDE_CONFIG_DIR` resolved correctly:
```
$ docker exec weftwise printenv CLAUDE_CONFIG_DIR
/home/node/.claude
```

### Phase 3: Lace Dockerfile

**`lace up --rebuild --skip-validation` succeeded.**

```
$ docker exec lace git --version
git version 2.53.0

$ docker exec lace pnpm --version
10.28.1

$ docker exec lace which electron
(not found — OK)

$ docker exec lace which playwright
(not found — OK)
```

`pnpm install --frozen-lockfile` completed during Docker build (verified via
successful `lace up`).

### Commits

| Repo | Commit | Message |
|------|--------|---------|
| weftwise | `69ee410` | `feat(devcontainer): align with lace idioms — git latest, nushell, auto-mounts` |
| lace | `28913af` | `refactor(devcontainer): remove weftwise Electron/Playwright from lace Dockerfile` |
