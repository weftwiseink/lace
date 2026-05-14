---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T11:55:32-07:00
task_list: prebuild/legacy-builder-migration/initial-scoping
type: report
state: live
status: review_ready
tags: [prebuild, migration, weftwise, planning]
---

# Initial Migration Scoping: Off `lace prebuild` Toward Legacy-Builder Cache

> BLUF: The accepted [migration proposal](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md) has been simplified by an out-of-band change: the `wezterm-server` feature is gone from the lace tree, retiring Phase 1 (asymmetric `appPort` injection fix) entirely.
> The narrowed initial scope is: (1) clean up weftwise's `devcontainer.json` and `Dockerfile` to recent patterns and drop the stale `wezterm-server` reference, (2) flip its `prebuildFeatures` to top-level `features`, and (3) measure post-flip warm-build wall time on the still-current pre-deletion lace binary to validate the cache story end-to-end on weftwise.
> Portless integration and E2E dogfooding of wezterm-server's host-SSH replacement are explicitly carved out as a separate follow-up workstream.
> Recommendation: leave the round-2 accepted proposal untouched in place and let this report stand as a scope-clarification artifact, with a `NOTE` callout added at the head of the proposal pointing to this report.

## Current-state delta vs. the accepted proposal

The accepted proposal at [`cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md`](../proposals/2026-05-12-migrate-to-legacy-builder-cache.md) was written assuming the `wezterm-server` feature was live in lace's tree and that its asymmetric `appPort` injection was a prerequisite blocking weftwise's migration.
Both assumptions are stale.

### What has changed

1. **`wezterm-server` is no longer a lace-tree feature.**
   The current `devcontainers/features/src/` contains `claude-code`, `lace-fundamentals`, `neovim`, `portless`, `sprack` only.
   The `portless` feature is the apparent successor for the "container service that needs an asymmetrically-mapped host port" role (its manifest at `devcontainers/features/src/portless/devcontainer-feature.json` declares `customizations.lace.ports.proxyPort` with `requireLocalPort: true`).
2. **Phase 1 of the proposal is moot.**
   The phase exists to ensure the regular features-to-ports allocator path handles wezterm-server's `hostSshPort` before weftwise's features get moved out of `prebuildFeatures`.
   With wezterm-server gone, there is no `hostSshPort` declaration in any lace-tree feature; the only consumer was weftwise's `prebuildFeatures` entry pointing at the (now-defunct in lace) `weftwiseink/wezterm-server:1`.
3. **Weftwise still references the dead feature.**
   `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json:90` still has `"ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}` in `prebuildFeatures`, and the comments at lines 72 and 105 still document a `wezterm-server/authorized-keys` feature-injected mount.
   This is a documentation/config-debt situation, not a structural blocker: the feature can simply be deleted from the project config.

### Why this simplifies the initial work

The original proposal sequenced Phase 1 (wezterm-server allocator fix) before Phase 2 (weftwise migration) because Phase 2 depended on Phase 1.
With wezterm-server gone, Phase 2 stands alone as the first concrete piece of work, and the bullet about "verify the host can ssh into the container post-migration" in Phase 2's success criteria has no enforcement vector for the initial migration.
Whether and how to restore container-SSH host access is now a question for the follow-up workstream.

> NOTE(opus/prebuild/legacy-builder-migration/initial-scoping): The proposal's Phase 1 substep 4 ("static `appPort` fallback") would have been the contingency path for weftwise.
> That contingency is no longer needed; weftwise simply drops the feature.
> The user's actual SSH-into-container flow during the gap between this migration and the follow-up workstream is unverified and should be assumed broken until portless or a replacement is wired up.

## What's needed for the initial migration to weftwise

The work below is sequenced for a single per-project migration loop.
Estimated effort: half a day of focused work plus measurement runs.

### Weftwise `devcontainer.json` cleanups

File: `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`.

1. Delete `"ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {}` from `prebuildFeatures` (line 90).
2. Delete the comment at line 72 documenting the `wezterm-server/authorized-keys` feature-injected mount.
3. Delete the comment at line 105 documenting the `wezterm-server/authorized-keys` runtime mount.
4. Re-evaluate the comment block at lines 97-99 documenting "lace port allocator assigns from 22425-22499 range" and "The wezterm-server feature declares hostSshPort in its lace port metadata."
   The first half remains accurate (the allocator still runs); the second half should be removed.
5. The `sshd` feature (`ghcr.io/devcontainers/features/sshd:1`) is independently present at line 89.
   It does not declare port metadata; it installs the sshd daemon but does not bind a host port.
   Decision needed: keep it (the follow-up workstream will likely want it back when wiring portless or a replacement) or drop it.
   Recommendation: keep it. It is install-time cheap and harmless.

### Weftwise `Dockerfile` cleanups

File: `/home/mjr/code/weft/weftwise/main/.devcontainer/Dockerfile`.

1. **pnpm pin fix (orthogonal to migration, but mandatory for any clean build).**
   Lines 61-62 currently:
   ```dockerfile
   RUN corepack install -g pnpm@10.26.2+sha1.$(npm view pnpm@10.26.2 dist.shasum)
   RUN corepack enable && corepack prepare pnpm@latest-10 --activate
   ```
   The validating experiment ([`cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`](2026-05-12-experiment-legacy-builder-cache.md), Failure Mode 1) found `pnpm@latest-10` now resolves to pnpm 11.1.1, which enforces `approve-builds` and breaks the electron postinstall.
   The experiment's working fix was to bypass corepack: replace the two RUN lines with a single `RUN npm install -g pnpm@10.26.2`.
   This is a Dockerfile-drift fix orthogonal to the prebuild-deletion migration; it must happen before the migration can measure anything meaningful.

2. **`NPM_CONFIG_PREFIX` env-order conflict (the documented post-deletion issue).**
   Lines 102-103:
   ```dockerfile
   ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
   ENV PATH=$PATH:/usr/local/share/npm-global/bin
   ```
   In the current prebuild flow, features install into the base image before this ENV runs, so the conflict with the transitively-pulled `ghcr.io/devcontainers/features/node` (nvm-based) never manifests.
   In the post-deletion flow, features run on top of the user's Dockerfile and inherit `NPM_CONFIG_PREFIX`; nvm refuses to install with that ENV set and exits 11.
   The proposal's prescribed remediation (Edge Cases section, "Feature install env-order conflicts"): either delete the ENV entirely (since the features now provide npm globals dir setup) or move it from `ENV` (Dockerfile, build-time) to `containerEnv` (devcontainer.json, runtime-only).
   The validating experiment used the `ENV NPM_CONFIG_PREFIX=` (unset before feature install) trick.
   Recommendation: delete the two ENV lines from the Dockerfile and verify nothing in weftwise's runtime path depends on them.
   If something does, move them to `containerEnv` in `devcontainer.json`.

3. **`mkdir -p /usr/local/share/npm-global && chown -R node:node /usr/local/share`** (lines 65-66).
   These exist to support the deleted ENV.
   If the ENV is removed, this RUN becomes vestigial.
   Recommendation: delete.
   Risk: if the user has scripts that write to `/usr/local/share/npm-global` directly, those will break.
   Audit weftwise's package.json scripts and any `bin/*` shell scripts before deletion.

4. **`FROM lace.local/node:24-bookworm`** (line 2).
   This base image tag is produced by the legacy `lace prebuild` flow.
   Post-deletion, the prebuild image will not be regenerated.
   Two options:
   - Switch to `FROM node:24-bookworm` directly (what the validating experiment did) and accept that the first build now does the apt-get install + system tooling layer cold.
   - Keep a project-local "base prep" stage in a multi-stage Dockerfile that does the heavy apt-get work once.
   Recommendation: switch to `FROM node:24-bookworm`. The legacy builder's local layer cache will cache the apt-get layer after the first cold build; the multi-stage approach adds complexity for no gain on the single-machine constraint.

5. **Surface comparison against `whelm`'s `.devcontainer/Dockerfile`** is not actionable for weftwise: whelm's Dockerfile (`/home/mjr/code/apps/whelm/.devcontainer/Dockerfile`) was not read in this scoping pass.
   Whelm's `devcontainer.json` (`/home/mjr/code/apps/whelm/.devcontainer/devcontainer.json`) is structurally identical in pattern to weftwise but vastly simpler in content (`lace-fundamentals + ./features/sprack` only); it is not the right comparator for weftwise's heavier feature set.
   The fundamentals weftwise should mirror are: pin all pinned tools explicitly, do not duplicate feature-provided ENV/PATH setup in the Dockerfile, prefer `containerEnv` for runtime-only ENVs.

### The actual flip: `prebuildFeatures` -> `features`

After the cleanups above, weftwise's `prebuildFeatures` block (lines 87-94) becomes:

```jsonc
"features": {
  "ghcr.io/devcontainers/features/git:1": { "version": "latest" },
  "ghcr.io/devcontainers/features/sshd:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {},
  "ghcr.io/weftwiseink/devcontainer-features/neovim:1": {},
  "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
}
```

Note: this lives at the top level of `devcontainer.json`, not nested under `customizations.lace`.
The `wezterm-server` line is removed (see cleanup item above).

The `customizations.lace.{workspace, mounts, repoMounts, validate}` blocks remain unchanged.
The source-analysis report ([`cdocs/reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md`](2026-05-06-prebuildfeatures-removal-impact-analysis.md)) established that all four work identically whether features sit in `features` or `prebuildFeatures`.

### Lace code path: what runs the build

The initial migration runs against the **current (pre-deletion) lace binary**.
The proposal's Phase 4 (lace code deletion) is explicitly deferred until after per-project migrations succeed.

Confirmed via `packages/lace/src/lib/up.ts:1287-1329` (`runDevcontainerUp`):

- The invocation site already passes `--buildkit never` (line 1319).
- The `dev_container_feature_content_temp` cleanup runs before each build (lines 1323-1324).
- These two pieces are load-bearing for legacy-builder cache stability per the proposal.

So weftwise's post-flip `lace up` invocation will exercise the exact code path the validating experiment used (manual `devcontainer build --buildkit never`).
The cache behaviour should be identical to the experiment's measurements.

One nuance: the pre-deletion lace binary still has the prebuild phase block at `up.ts:393-394, 888-926`.
When weftwise's `prebuildFeatures` is empty (or absent), `hasPrebuildFeatures` resolves to `false` at line 393-394 and the entire prebuild block at 888-926 is skipped.
This is the intended fall-through behaviour and means the migration works on the current lace binary without code changes.

### Cache-hygiene measurement

The validating experiment captured the cold-vs-warm wall-time ratio (15x speedup, Build 2 at 6.65% of Build 1) on a `devcontainer build` invocation with a clean working tree.
The user's outstanding question (from the prior conversation) is: **how does the cache behave when the Dockerfile is edited in a "soft" way (single line change late in the stage chain)?**

This is not measured anywhere in the existing reports.
The validating experiment measured back-to-back identical builds (best-case cache reuse) but not the actual edit-rebuild loop a developer would experience.

Recommended measurement during the initial migration:

1. After the post-flip cold build succeeds, edit a late-stage line in weftwise's Dockerfile (e.g., change the `ELECTRON_VERSION` ARG default by a patch number).
2. Time `lace up` and grep the build output for `--> Using cache` count vs. instructions re-run.
3. Repeat for an early-stage edit (e.g., add a package to the `apt-get install -y` list).
4. Repeat for a `COPY . .` cache bust (touch a file in the source tree).

Capture each scenario's wall time and cache-hit ratio.
This produces a concrete cost-of-edit table that grounds the user's soft-migration concern in data.

Expected pattern based on legacy-builder semantics:
- Late-stage edit: all layers up to the edit cached; layers from the edit forward re-run.
- Early-stage edit: from the edit forward re-runs.
- `COPY . .` bust: only the `COPY . .` and downstream layers re-run.
- Feature install scripts cache independently of user-stage layers because they're in a later stage.

If any of these expectations fails empirically, that's a finding to surface before recommending the post-deletion lace migration ships.

## Explicitly deferred to the follow-up workstream

The user's plan partitions the work into two distinct workstreams.
The following items are **out of scope for this initial migration** and belong to the follow-up:

1. **Portless feature integration into weftwise.**
   The portless feature (`devcontainers/features/src/portless/`) is the apparent intended replacement for wezterm-server's container-side localhost subdomain routing.
   Its lace port metadata (`proxyPort` with `requireLocalPort: true`) drives lace's regular features-to-ports allocator.
   The follow-up workstream will determine how weftwise adopts portless.

2. **Host-SSH access replacement.**
   wezterm-server provided host SSH into the container via an asymmetrically-mapped port plus `authorized_keys` bind mount.
   Until the follow-up wires up an equivalent (either via the upstream `sshd` feature plus a port declaration, or via a new lace-tree feature, or via a different mechanism entirely), `wez-into` and host SSH flows to the weftwise container are broken.
   This corresponds to the proposal's Phase 1 success criterion "host can ssh into the container" which no longer applies to the initial migration.

3. **E2E dogfooding.**
   The proposal's Phase 7 (dogfood and ship) is the end-state validation that lace's own devcontainer, weftwise, and whelm all work on the post-deletion lace binary.
   The follow-up workstream owns this with portless integrated into weftwise.

4. **Lace code deletion (proposal Phase 4).**
   Cannot start until at least weftwise is verified working on the pre-deletion binary; can probably wait until the follow-up workstream has also validated portless integration.

5. **Other projects' migration (proposal Phase 3).**
   `whelm`, `clauthier`, `dotfiles`, and lace's own `.devcontainer` all have `prebuildFeatures` blocks (per the source-analysis report's inventory).
   These are trivial moves (no port-declaring features) and can happen in any order relative to weftwise, but they're not part of the initial weftwise-focused migration.

## Recommendations for proposal evolution

The accepted proposal has `last_reviewed.status: accepted` at round 2.
Editing it in place to reflect the wezterm-server deletion risks invalidating that acceptance (round-3 review needed) for a change that doesn't alter the design's correctness.

Three options were considered:

| Option | Pros | Cons |
|--------|------|------|
| Edit proposal in place | Single source of truth | Invalidates round-2 acceptance; requires re-review |
| Author a follow-up proposal that supersedes | Clean version control | Heavy ceremony for a scope-narrowing edit |
| Stand this report as scope-clarification | Lightweight; preserves acceptance | Reader of the proposal must follow a link to this report |

**Recommendation: stand this report as scope-clarification.**

Concretely:
1. Add a `NOTE(opus/prebuild/legacy-builder-migration/initial-scoping)` callout at the top of the proposal (just above the BLUF or just below it) pointing to this report.
2. Tag the callout content: "Phase 1 is moot post wezterm-server feature deletion. Initial migration scope is narrowed; see this report. Follow-up workstream owns portless integration and host-SSH replacement."
3. Leave the proposal's body unchanged. The history-agnostic framing rule applies to the proposal; the NOTE callout is the documented exception channel for "implementation has diverged from design."
4. When Phase 4 (lace code deletion) eventually runs, the proposal can transition to `status: implementation_accepted` with a normal devlog narrative covering the actual sequence.

The proposal's design is sound and remains correct; only the sequencing-of-prerequisites changed.
That's exactly what NOTE callouts are for under the writing conventions.

## Open questions for the user

1. **Should weftwise keep `sshd:1` in features post-flip, or drop it?**
   Recommendation above is keep. Confirm before edit.
2. **Should weftwise's `Dockerfile` switch `FROM lace.local/node:24-bookworm` to `FROM node:24-bookworm` now, or wait?**
   Recommendation above is switch now. The lace.local tag will not be regenerated post-prebuild-deletion, so the switch is mandatory eventually; doing it now means the initial migration measures the full real-world build behaviour.
3. **`NPM_CONFIG_PREFIX` deletion vs. `containerEnv` relocation: which?**
   Recommendation above is delete. Confirm there's no runtime dependency before pulling the trigger.
4. **Cache-hygiene measurement: how thorough?**
   The four-scenario table above (late edit, early edit, `COPY . .` bust, plus the back-to-back baseline) is one option; the user may prefer something lighter or heavier.
5. **Sequencing relative to other projects?**
   The follow-up workstream is portless+weftwise focused. Should other projects (whelm, lace's own, etc.) migrate in this workstream or wait for the follow-up?
   Recommendation: do them in this workstream since they're trivial (no port-declaring features) and migrating them surfaces any edge-order conflicts beyond weftwise's.

## Risks and complications

1. **No SSH-into-container during the gap.**
   Between this migration and the follow-up workstream completing, the host loses its `wez-into` / SSH access to the weftwise container.
   If the user depends on that flow for daily work, the gap is a productivity hit.
   Mitigation: schedule the follow-up workstream to start immediately after the initial migration's cache validation, or fall back to `podman exec -it weftwise bash` for direct shell access.

2. **The `lace.local/node:24-bookworm` base image dependency.**
   Weftwise's Dockerfile `FROM` line currently points at a lace-prebuild-produced tag.
   The instant the user runs `lace up` post-flip, the prebuild phase is skipped (no `prebuildFeatures`), so `lace.local/node:24-bookworm` will not be rebuilt and the existing one will eventually be invalidated by user-state cleanup.
   Switching the `FROM` line is therefore not optional once the flip happens; it must happen in the same commit.

3. **Untested: does `lace up` with empty `prebuildFeatures` and full `features` actually work on the current binary?**
   The proposal asserts the pre-deletion binary supports this path because `hasPrebuildFeatures` at `up.ts:393` evaluates to false and the prebuild block is skipped.
   This has not been runtime-validated end-to-end. It should be the first check after the config edit.

4. **The `wezterm-server/authorized-keys` mount might still be auto-injected** if feature metadata cache from a prior `lace up` survives.
   The weftwise project has `.lace/` artefacts from prior runs.
   Migration should include a `rm -rf .lace/` step before the first post-flip `lace up`.

5. **The validating experiment used a hand-written `devcontainer.test.json` and `Dockerfile.test`, not the project's real files.**
   Running on the real files via `lace up` is the only way to validate that lace's user-config-merge layer, mount injection, port allocator, and template resolution all work end-to-end with the flipped config.
   Treat the experiment results as necessary but not sufficient evidence.

## Suggested execution order

1. Survey: `find ~/code -name devcontainer.json -path '*/.devcontainer/*' | xargs grep -l prebuildFeatures` to confirm the inventory.
2. Snapshot weftwise: `git status` clean, capture current `lace up` cold/warm wall times for baseline.
3. Apply Dockerfile cleanups (pnpm pin, `NPM_CONFIG_PREFIX` removal, `FROM` switch) as a single commit. Run `podman build` (no devcontainer) to verify Dockerfile parses and apt-get layer succeeds.
4. Apply devcontainer.json cleanups (drop wezterm-server, scrub comments) as a second commit.
5. Flip `prebuildFeatures` -> `features` as a third commit.
6. `rm -rf weftwise/.lace/` and `lace up`. Verify success.
7. Capture cache-hygiene measurements per the four scenarios above.
8. Commit findings to a devlog under `cdocs/devlogs/`.
9. Add the NOTE callout to the proposal pointing to this report.
10. Hand off to the follow-up workstream for portless integration and host-SSH replacement.

## Citations

Proposal:
- `/var/home/mjr/code/weft/lace/main/cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md`

Supporting reports:
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-05-06-prebuildfeatures-removal-impact-analysis.md`
- `/var/home/mjr/code/weft/lace/main/cdocs/reports/2026-05-12-experiment-legacy-builder-cache.md`

Current project files surveyed:
- `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`
- `/home/mjr/code/weft/weftwise/main/.devcontainer/Dockerfile`
- `/home/mjr/code/apps/whelm/.devcontainer/devcontainer.json`
- `/var/home/mjr/code/weft/lace/main/.devcontainer/devcontainer.json`

Lace source code:
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/up.ts` (runDevcontainerUp at 1287-1329; hasPrebuildFeatures branch at 393-394)
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/portless/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/portless/install.sh`

Lace feature tree (post-wezterm-server-deletion):
- `claude-code/`, `lace-fundamentals/`, `neovim/`, `portless/`, `sprack/` only.
