---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T12:06:50-07:00
task_list: prebuild/legacy-builder-migration/weftwise
type: devlog
state: live
status: review_ready
tags: [prebuild, migration, weftwise]
---

# Migrate Weftwise Off `lace prebuild` to Legacy-Builder Cache

> BLUF: Weftwise migrated cleanly from `customizations.lace.prebuildFeatures` (6 features) to a single top-level `features` block declaring `lace-fundamentals:1` only.
> Cold `lace up --rebuild` ran 2:09.70 wall; warm `lace up --rebuild` ran 0:26.53 wall (20.4% of cold, 4.9x speedup, below the 30% pass criterion).
> `lace validate` passes; the regular features-to-ports allocator handled the `sshPort` declaration from `lace-fundamentals` automatically (allocated port 22425, mounted authorized-keys), preserving host-SSH affordance through the fundamentals feature rather than the deleted `wezterm-server` feature.

## Scope

Initial migration only, per [`cdocs/reports/2026-05-13-initial-migration-scoping.md`](../reports/2026-05-13-initial-migration-scoping.md).
Portless integration and lace code deletion (proposal Phase 4) are out of scope.

## Files edited

`/home/mjr/code/weft/weftwise/main/.devcontainer/Dockerfile`:
- `FROM lace.local/node:24-bookworm` -> `FROM node:24-bookworm`.
- Replaced the two-line corepack pnpm install (lines 61-62) with a single `RUN npm install -g pnpm@10.26.2`.
  Fixes the `pnpm@latest-10` -> 11.x dist-tag drift surfaced by the validating experiment.
- Deleted `ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global` and the `PATH` extension (lines 102-103).
- Deleted the vestigial `mkdir -p /usr/local/share/npm-global && chown ...` RUN (lines 65-66).

`/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`:
- Deleted the entire `customizations.lace.prebuildFeatures` block (was 6 features: git, sshd, wezterm-server, claude-code, neovim, nushell).
- Added a top-level `"features"` block declaring only `ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1`.
  This mirrors whelm's pattern.
  The user's `~/.config/lace/user.json` auto-injects `neovim`, `nushell`, `claude-code` into every project.
  `lace-fundamentals` provides `git` via its `dependsOn` and contributes `sshPort` + `authorized-keys` mount via its lace customizations, which the regular allocator handles.
- Scrubbed comments referencing `wezterm-server/authorized-keys` mount and "wezterm-server feature declares hostSshPort" in the lace port-allocator comment block.
- Preserved `customizations.lace.{workspace, mounts, repoMounts, validate}` blocks unchanged.

Also: `rm -rf /home/mjr/code/weft/weftwise/main/.lace/` to clear stale prebuild artefacts before the first post-flip run.

## Wall-time measurements

| Build | Wall | Notes |
|-------|------|-------|
| Cold `lace up --rebuild` (post-flip) | 2:09.70 (130s) | Some base layers likely cached in podman storage from prior validating experiments. |
| Warm `lace up` (container already running) | 0:00.68 | No rebuild path; container reuse only. |
| Warm `lace up --rebuild` | 0:26.53 (26s) | 20.4% of cold; 4.9x speedup. |

The warm-rebuild ratio (20.4%) clears the proposal's 30% pass criterion comfortably.
Cold time was notably faster than the validating experiment's 234s, likely because podman's local layer cache retains apt-get and base-image layers from prior experiments on this host.

> NOTE(opus/prebuild/legacy-builder-migration/weftwise): Lace's `up` command suppresses the verbose `devcontainer build` output entirely, so per-instruction `--> Using cache` counts are not directly observable from the captured logs (`/tmp/weftwise-{cold-build,warm-rebuild}.log`).
> Wall-time deltas are the only available cache-hit signal in the lace UX.
> The validating experiment captured `--> Using cache` counts by invoking `devcontainer build` directly; reproducing that level of detail in `lace up` would require either a `--verbose` flag or out-of-band podman observation.

## What `lace validate` revealed

The post-flip `lace validate` output (captured at `/tmp/weftwise-lace-validate.log`) confirms the migration path is structurally sound:

- 4 features resolved (lace-fundamentals + 3 user-config-injected: neovim, nushell, claude-code).
- `lace-fundamentals/sshPort` port template auto-injected and allocated to 22425.
  This means the regular features-to-ports allocator path handles the SSH port declaration cleanly, without needing the proposal's deferred Phase 1 wezterm-server allocator extension.
- `lace-fundamentals/authorized-keys` mount auto-injected and resolved to `~/.config/lace/ssh/id_ed25519.pub`.
- All user-config-merged feature mounts resolved (claude-code/config, claude-code/config-json, neovim/plugins).
- `defaultShell="/usr/local/bin/nu"` injected into the lace-fundamentals feature options.
- `lace-fundamentals-init` postCreateCommand auto-injected.

## Surprises and findings

1. **`lace-fundamentals` is a superset of the deleted `wezterm-server`'s lace-side affordances** for SSH key mounting and port declaration.
   The fundamentals feature declares `sshPort` and an `authorized-keys` mount in its lace customizations.
   This means host-SSH is NOT broken during the gap, contrary to the scoping report's Risks #1 ("No SSH-into-container during the gap").
   The scoping report appears to have under-counted what lace-fundamentals already provides.
   The container-side wezterm-server daemon (which handled the localhost-subdomain proxying) is still missing, but pure SSH-into-container at port 22425 should work.
   This was not runtime-validated as part of this initial migration; the follow-up workstream should confirm.

2. **The `dependsOn` chain works cleanly post-flip.**
   `lace-fundamentals` depends on `ghcr.io/devcontainers/features/git:1`, so explicit declaration of `git:1` (as in the old prebuildFeatures block) is redundant.
   The `sshd` feature is no longer declared anywhere; whether it's needed for the container-side sshd daemon (separate from the lace-fundamentals SSH key mount) is unclear and may be a follow-up gap.

3. **Container reuse path (warm `lace up`, no rebuild) is 0.68s.**
   Faster than I expected.
   Suggests lace's no-op detection is effective when the container is already running.

4. **Cold build at 130s was much faster than the experiment's 234s.**
   Podman's local layer cache retains base-image and apt-get layers from prior experimental builds on this host.
   A truly cold first-run on a fresh host would likely be closer to the experiment's measurement.
   This is informational, not a problem: the speedup ratio is what matters for the migration's success criterion.

5. **`/tmp/weftwise-cold-build.log` and `/tmp/weftwise-warm-rebuild.log` contain only lace's own surface output**, not devcontainer-CLI's instruction-level trace.
   Future cache-hygiene measurements per the scoping report's recommendations (late-stage edit, early-stage edit, `COPY . .` bust) would require either a lace verbose flag or out-of-band `podman build` invocation to inspect per-layer behaviour.

## Verification gaps surfaced

- **Container-side SSH not exercised end-to-end.**
  `lace up` exited cleanly and reported the container running, but I did not `ssh node@localhost -p 22425` to confirm.
  The follow-up workstream should validate this.
- **Container-side service availability not exercised.**
  None of the in-container feature-installed tools (nu, nvim, claude) were run from inside the container to confirm they're on PATH and functional.
- **Cache-hygiene under edits not measured.**
  The scoping report's four-scenario table (late edit, early edit, COPY bust, baseline) is not in this devlog.
  Should be a follow-up measurement.

## Open items for the follow-up workstream

1. Portless feature integration into weftwise (replaces wezterm-server's localhost-subdomain proxying).
2. Validate host SSH into container at the allocated port 22425.
3. Decide whether `sshd:1` is needed in the project's features list (separate from lace-fundamentals' authorized-keys mount).
4. Cache-hygiene measurement: four-scenario table per the scoping report.
5. Lace code deletion (proposal Phase 4) is unblocked from weftwise's side, modulo follow-up validation.

## Conventions

This devlog follows sentence-per-line, BLUF-up-front, no-em-dashes.
Working tree left dirty per task instructions (no commit).
