---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-01T00:00:00-07:00
task_list: operations/container-lifecycle/weftwise-revival
type: devlog
state: live
status: wip
tags: [operations, podman, weftwise, devcontainer, lace_up]
---

# Cleanup Stale Lace Containers and Start Weftwise

> BLUF: User has been away from active dev for ~2 weeks.
> Goal: stop+remove the two stale lace-managed containers (`lace`, `whelm`) and bring up the weftwise project at `/home/mjr/code/weft/weftwise/main` via `lace up` to get back to working order.
> Secondary task: investigate why cdocs skills are not exposed as known skills in this Claude Code session.

## Initial State (2026-05-01)

### Running Containers (`podman ps -a`)

| Name | Created | Started | Last sprack activity | Project Folder |
|---|---|---|---|---|
| `lace` | 2026-03-26 | 2026-03-26 21:38 | 2026-03-28 (34d ago) | `/var/home/mjr/code/weft/lace/main` |
| `whelm` | 2026-04-18 | 2026-04-18 11:35 | 2026-04-18 (13d ago) | `/var/home/mjr/code/apps/whelm` |

Both containers report "Up Nd" status (long-lived), but sprack mtime on the per-project mount directory in `~/.local/share/sprack/lace/<project>` reveals the last actual development session.
13 days is the more recent of the two; both qualify as not-recently-used in the context of switching focus to weftwise.

### Weftwise State

- `/home/mjr/code/weft/weftwise/main/.devcontainer/` exists (devcontainer.json + Dockerfile + lock).
- `/home/mjr/code/weft/weftwise/main/.lace/` exists with prior generated artifacts (`devcontainer.json`, `mount-assignments.json`, `port-assignments.json`, `prebuild`, `prebuild.lock`, `resolved-mounts.json`, `runtime-fingerprint`).
- No `weftwise` container currently exists in podman.

### Threshold Decision

> NOTE(opus/weftwise-revival): User said "trust your judgement, easy to correct."
> Threshold: any container with last sprack activity older than 7 days is fair game.
> Both `lace` (34d) and `whelm` (13d) qualify.

## Plan

1. Stop and remove `lace` container (self-named, but operating from host so safe).
2. Stop and remove `whelm` container.
3. Run `lace up` from `/home/mjr/code/weft/weftwise/main` to start the weftwise container.
4. Verify container is healthy (sshd port forwarded, container accessible).
5. Investigate missing cdocs skills exposure.

## Execution

### Container Cleanup

```sh
podman stop lace whelm    # both stopped cleanly
podman rm   lace whelm    # both removed cleanly
podman ps -a              # empty
```

### `lace up` for Weftwise

First attempt failed in `templateResolution` phase:

```
Mount validation failed: Mount target conflict:
  '/home/node/.claude/.claude.json' declared by both
  'project/claude-config-json' and 'claude-code/config-json'
```

Root cause: weftwise's `.devcontainer/devcontainer.json` carries a project-level `claude-config-json` mount predating the `claude-code` feature's own `config-json` mount declaration.
The feature now provides this; the project-level declaration became redundant and started triggering target-conflict validation.

Fix: removed the project-level `claude-config-json` mount block (and its long inline justification comment) from `.devcontainer/devcontainer.json`.
Replaced with a one-line annotation in the comment listing feature-injected mounts.

Second `lace up` attempt succeeded:
- Allocated port `wezterm-server/hostSshPort: 22425`.
- Prebuild image: `lace.local/node:24-bookworm` (cached from prior runs).
- Container `weftwise` running on `0.0.0.0:22425->2222/tcp`.
- `podman exec weftwise sh -c 'whoami; ls /workspaces/'` returned `node` and `weftwise` -- workspace mount intact.

> NOTE(opus/weftwise-revival): User-level config still resolves a `project/claude-config-json` mount entry against `/home/mjr/.claude.json`, but it is now compatible (as override) with the feature's `claude-code/config-json`. No further action required.

### Final Container State

| Name | Port | Sprack |
|---|---|---|
| `weftwise` | 22425 | `~/.local/share/sprack/lace/weftwise` |

## Cdocs Skills Investigation

User asked why `/cdocs:devlog`, `/cdocs:propose`, etc. are not exposed as known skills in this session.
The Skill-tool dispatch attempt at session start (`Skill(skill="cdocs:devlog")`) failed with `Unknown skill: cdocs:devlog`.

### Findings

- The `cdocs` plugin **is installed and enabled**: `installed_plugins.json` records `cdocs@clauthier 0.1.0`.
- Plugin source lives at `/var/home/mjr/code/weft/clauthier/main/plugins/cdocs/skills/{devlog,propose,review,nit_fix,triage,implement,report,rfp,status,init}`.
- Marketplace `clauthier` is registered as a directory marketplace at `/var/home/mjr/code/weft/clauthier/main` in `~/.claude/plugins/known_marketplaces.json`.
- The enable directive `"cdocs@clauthier": true` lives in `/var/home/mjr/code/weft/lace/main/.claude/settings.json`.

### Root Cause

The session's primary working directory is `/var/home/mjr/code/weft/lace/main/packages/lace` (subdirectory).
The `enabledPlugins` setting is at the parent path `/var/home/mjr/code/weft/lace/main/.claude/settings.json`.

`CLAUDE.md` discovery walks parent directories (the system-reminder confirms it loaded `/var/home/mjr/code/weft/lace/main/CLAUDE.md`), but **`enabledPlugins` does not appear to walk parents the same way**.
Result: skills from `cdocs@clauthier` are not registered for sessions started inside `packages/lace/` or any other subdirectory.

This is consistent with the available-skills list this session received: only built-in skills (`update-config`, `simplify`, `init`, `review`, `claude-api`, etc.) appeared; no cdocs skills.

### Recommended Fix

Two options, depending on scope intent:

1. **Promote to user-level (recommended)**: Add `"cdocs@clauthier": true` to `/home/mjr/.claude/settings.json`'s `enabledPlugins` block.
   The user already uses cdocs across `lace`, `weftwise`, `whelm`, `clauthier` itself.
   Promoting eliminates per-project setup and per-subdirectory drop-out.

2. **Add a subproject `.claude/settings.json`**: Drop a settings file at `/var/home/mjr/code/weft/lace/main/packages/lace/.claude/settings.json` enabling cdocs.
   Narrower scope but fragmented; would need duplication for each subproject the user enters Claude Code from.

> NOTE(opus/weftwise-revival): Not applying the fix in this session. The user invoked `/devlog` colloquially (it was satisfied via direct `Write` to `cdocs/devlogs/`), so functionality is not blocked. Surface the recommendation and let the user decide.

## Outcome

- 2 stale lace-managed containers (`lace`, `whelm`) stopped and removed.
- `weftwise` container brought up on port 22425, workspace mounted at `/workspaces/weftwise`.
- One latent config-drift bug fixed in `weftwise/main/.devcontainer/devcontainer.json` (redundant `claude-config-json` mount).
- Diagnosed why cdocs skills are absent in subdirectory-rooted sessions; recommendation to promote `enabledPlugins.cdocs@clauthier` to user-level settings.

## Outstanding / Not Done

- Did **not** modify user settings to enable cdocs globally - awaiting user approval (config change with persistent scope).
- Did **not** verify SSH connectivity into the weftwise container from the host (e.g., via `wez-into weftwise`); only verified `podman exec` reachability.
- Did **not** run `wez-into weftwise` or open a wezterm tab; user did not request that step.

