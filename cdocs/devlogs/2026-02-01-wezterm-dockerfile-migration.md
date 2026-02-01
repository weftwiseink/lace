---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-01T00:00:00-08:00
task_list: lace/devcontainer-features
type: devlog
state: live
status: wip
tags: [devcontainer-features, wezterm, dockerfile-migration, phase-3]
---

# Wezterm Dockerfile Migration (Phase 3): Devlog

## Objective

Complete Phase 3 of the wezterm-server devcontainer feature proposal (`cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`). This phase migrates the inline wezterm installation from `.devcontainer/Dockerfile` to the published feature at `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`.

This also completes Phase 3 of the feature-based-tooling proposal (`cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md`), which was skipped in its implementation because it was gated on the wezterm-server feature being published.

## Plan

1. Add `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` to `devcontainer.json` features
2. Remove wezterm blocks from Dockerfile (ARG, .deb extraction RUN, runtime dir creation)
3. Retain SSH dir setup (verified: sshd feature does NOT create per-user `.ssh` directories)
4. Build devcontainer image and verify all tools present
5. Commit and push
6. Verify CI workflows pass
7. Update proposal statuses

## Testing Approach

- Full `devcontainer build` to verify the feature installs correctly alongside existing features
- Tool presence verification (`wezterm-mux-server --version`, `wezterm --version`)
- Runtime dir verification (`/run/user/<uid>` exists)
- All other tools still present (regression check)
- CI workflow verification after push

## Implementation Notes

### SSH directory setup retained

Investigated whether the sshd feature (`ghcr.io/devcontainers/features/sshd:1`) creates per-user `.ssh` directories. It does not — the feature only configures the sshd daemon and system-level directories (`/var/run/sshd`). The explicit `mkdir -p /home/${USERNAME}/.ssh && chmod 700 && chown` in the Dockerfile is necessary because:

1. The sshd feature doesn't create it
2. The bind mount of `authorized_keys` from the host would cause Docker to create `.ssh/` as root:root with wrong permissions
3. OpenSSH requires `.ssh` to be `700` and owned by the user

### Feature already published and verified

The wezterm-server feature was published in the previous session:
- `ghcr.io/weftwiseink/devcontainer-features/wezterm-server` with tags: 1, 1.0, 1.0.0, latest
- All 4 test scenarios passing in CI
- Feature options: `version` (string), `createRuntimeDir` (boolean)

## Changes Made

| File | Description |
|------|-------------|
| `.devcontainer/devcontainer.json` | Added `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` with version pin |
| `.devcontainer/Dockerfile` | Removed ARG WEZTERM_VERSION, .deb extraction RUN block, runtime dir creation (20 lines) |
| `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md` | Status: `implementation_wip` -> `implementation_accepted` |
| `cdocs/proposals/2026-01-30-devcontainer-feature-based-tooling.md` | Status: `implementation_accepted` (Phase 3 now complete) |

## Verification

**Build: SUCCESS**

```
devcontainer build --workspace-folder .
{"outcome":"success","imageName":["vsc-lace-586abe183b50cf895377abdd4f7065601d2ccc5afdd058931d99530f9a4e1c75"]}
```

Feature install log during build:
```
Feature       : Wezterm Server
Id            : ghcr.io/weftwiseink/devcontainer-features/wezterm-server
Version       : 1.0.0
Options       :
    VERSION="20240203-110809-5046fc22"
    CREATERUNTIMEDIR="true"
Installing wezterm-mux-server and wezterm CLI (version: 20240203-110809-5046fc22, arch: amd64, distro: debian)...
wezterm-mux-server and wezterm CLI installed successfully.
wezterm-mux-server 20240203-110809-5046fc22
```

**Tool verification (all PASS):**

| Tool | Binary Path | Version |
|------|------------|---------|
| wezterm-mux-server | `/usr/local/bin/wezterm-mux-server` | 20240203-110809-5046fc22 |
| wezterm | `/usr/local/bin/wezterm` | 20240203-110809-5046fc22 |
| claude | `/usr/local/share/npm-global/bin/claude` | latest |
| nvim | `/home/linuxbrew/.linuxbrew/bin/nvim` | NVIM v0.11.6 |
| nu | `/usr/local/bin/nu` | 0.110.0 |
| delta | `/usr/bin/delta` | 0.18.2 |
| git | `/usr/bin/git` | 2.39.5 |
| node | `/usr/local/bin/node` | v24.13.0 |
| pnpm | `/usr/local/bin/pnpm` | 10.28.1 |

**Environment verification (all PASS):**

- Running as `node` user (uid 1000)
- `/run/user/1000` exists, owned by `node:node`
- `/home/node/.ssh` exists, mode `700`, owned by `node:node`
- `DEVCONTAINER=true`
- `NPM_CONFIG_PREFIX=/usr/local/share/npm-global`

**Dockerfile reduction:** 167 lines -> 147 lines (20 lines removed)
