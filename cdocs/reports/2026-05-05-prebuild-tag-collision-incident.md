---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-05T16:58:42-07:00
task_list: lace/prebuild-cache-collision
type: report
state: live
status: done
last_reviewed:
  status: accepted
  by: "@claude-opus-4-7"
  at: 2026-05-05T18:05:00-07:00
  round: 1
tags: [prebuild, cache-collision, lace-fundamentals, postCreateCommand, robustness, future_work, incident]
---

# Prebuild Tag Collision Strands whelm's lace-fundamentals Feature

> BLUF: A `lace up` in `~/code/apps/whelm` that the user expected to be near-instantaneous took ~2m 17s and failed (`lace-fundamentals-init: not found`, exit 127).
> Root cause: `generateTag()` derives the prebuild tag solely from the original `FROM` image, so two projects with the same base but different prebuild feature sets (whelm vs. weftwise) collide on `lace.local/node:24-bookworm`.
> The cache-hit check verifies the tag exists but never confirms its baked feature set matches the requesting project, so weftwise's image silently substitutes for whelm's.
> Recommend `lace up --rebuild` as immediate remediation, then move to per-project or content-hashed prebuild tags plus a label-based feature-set verification.

## Context / Background

User ran `lace up` in `~/code/apps/whelm` on 2026-05-05 expecting near-zero work, since no config had changed since the last successful run on 2026-04-18.
Wall time was ~2m 17s.
The lace-side phases ran in ~5s; `devcontainer up` consumed the rest, ending in exit 1 with a `postCreateCommand` failure.
The container is now running but is unprovisioned (no chezmoi, no git identity, no dotfiles applied).

This report separates two compounding effects (image cache miss vs. feature-set substitution) so that downstream design work doesn't conflate them.

## Key Findings

- `lace up`'s own pipeline executed correctly and quickly. The slowness and failure both originate from the `devcontainerUp` phase.
- The runtime fingerprint matched (`c7e93b54e35ee805` stored == current). This was **not** a config-drift recreation.
- The previous `vsc-whelm-...` workspace image and any prior whelm container were absent at the start of this run, forcing a full image build (~48s) and fresh `podman run` (~80s). Most plausible explanation: a prune or storage event in the 17 days since 2026-04-18.
- The prebuild base image `lace.local/node:24-bookworm` was rebuilt 4 days ago (2026-05-01) by a *different project* (weftwise), with a *different* feature set. whelm's `contextsChanged()` check is per-project and saw no local change, so lace declared "Prebuild is up to date" and reused the wrong image.
- The `devcontainer.metadata` label on `lace.local/node:24-bookworm` confirms only weftwise's features are baked in: `git`, `node`, `sshd`, `nushell`, `neovim`, `claude-code`, `wezterm-server`. **`lace-fundamentals` is absent.**
- `up.ts` unconditionally injects `lace-fundamentals-init` into `postCreateCommand` whenever the feature is *requested* in `features` or `prebuildFeatures`, regardless of whether it is *actually present* in the resolved image. This is what surfaces the build-time substitution as a runtime exit 127.

## Symptom Detail

Tail of `~/code/apps/whelm/.lace/logs/2026-05-05T21-42-16-2f75bd.log` (lines 849-850):

```
/bin/sh: 1: lace-fundamentals-init: not found
postCreateCommand from devcontainer.json failed with exit code 127. Skipping any further user-provided commands.
```

LACE_RESULT line:

```
LACE_RESULT: {"exitCode":1,"failedPhase":"devcontainerUp","containerMayBeRunning":true}
```

Inside the running container:
- `which lace-fundamentals-init` -> not found
- `which chezmoi` -> not found
- `/usr/local/bin/` does not contain any `lace-*` binaries
- `PATH=/usr/local/share/nvm/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/share/npm-global/bin` (no custom additions)

## Analysis

### Cause A: workspace image and container were both gone

Two layered images are involved; keep them distinct:
- The **prebuild base** `lace.local/node:24-bookworm` — built by `lace prebuild`, shared across projects, the subject of Cause B.
- The **workspace image** `vsc-whelm-c33b14...-uid` — built by `devcontainer up` on top of the prebuild base, project-specific, the subject of Cause A.

`podman ps -a --filter name=whelm` listed only the just-started container.
There was no stopped whelm container to reuse, and the workspace image had to be rebuilt from scratch (Step 1/19 through commit, 21:42:21 -> 21:43:09).
This accounts for ~48s of the build time and explains why the user perceived `lace up` as non-idempotent even though no project config had changed.

This is a **container-store reality check** issue, not a lace bug per se: lace correctly invoked `devcontainer up`, and `devcontainer up` correctly rebuilt the missing image.
The user's mental model ("no config changes => instantaneous") implicitly assumed image and container persistence that wasn't there.

### Cause B (root cause of failure): prebuild tag collision

`generateTag()` in `packages/lace/src/lib/dockerfile.ts:116-140`:

```
return `lace.local/${imageName}:${tag}`;   // tag-based path
```

The tag is derived only from the original `FROM` image (`imageName`, `tag`, `digest`).
The feature set baked into the image is **not** part of the tag.

Both projects use `FROM node:24-bookworm`, so both projects produce the same prebuild tag:

| project | prebuild features (from `.lace/prebuild/.devcontainer/devcontainer.json`) | metadata timestamp |
|---|---|---|
| whelm | neovim, nushell, claude-code, **lace-fundamentals**, sprack | `2026-03-27T22:32:27.690Z` |
| weftwise | neovim, nushell, claude-code, **git, sshd, wezterm-server** | `2026-05-01T22:05:07.926Z` |

Both record `prebuildTag: "lace.local/node:24-bookworm"`.

The retagging step is explicit: `devcontainer build --image-name <prebuildTag>` runs in each project's prebuild and tags whatever was just built with the same shared name, so the most recent build "wins" the tag with no warning.
The per-project metadata file is not refreshed on cache hit — `writeMetadata` is only called on the reactivation and full-build paths, never on the `prebuild.ts:226` pure cache-hit return — so the per-project timestamp does not advance and cannot be used to detect that another project has overwritten the shared tag.

The "is up to date" check at `packages/lace/src/lib/prebuild.ts:206-254`:
1. `contextsChanged()` compares the temp build context to the **per-project** `.lace/prebuild/.devcontainer/` snapshot. whelm's snapshot didn't change, so this returns false. Cache is "fresh".
2. `podman image inspect <prebuildTag>` confirms the tagged image *exists*. Step passes.
3. The Dockerfile already has `FROM lace.local/...` so no rewrite is needed.
4. Returns "Prebuild is up to date." No rebuild.

What the check **never** does:
- Read the image's `devcontainer.metadata` label and confirm every project-requested feature ID is baked in.
- Compare the image's actual creation timestamp against the per-project metadata timestamp (the latter would have flagged the 4-day discrepancy here).

The result: weftwise's `lace.local/node:24-bookworm` is silently used as whelm's base, missing `lace-fundamentals` (and `sprack`, though `sprack` is a local feature that may not have surfaced in this run).

### Cause C (related fragility): runtime injection assumes build-time presence

`packages/lace/src/lib/up.ts:842-868` auto-injects `lace-fundamentals-init` into `postCreateCommand` whenever the feature short id appears in the *requested* feature list:

```ts
const fundamentalsRef = allFeatureRefs.find((ref) =>
  extractFeatureShortId(ref) === "lace-fundamentals",
);
if (fundamentalsRef) {
  // inject lace-fundamentals-init into postCreateCommand
}
```

The injection has no coupling to whether the resolved image actually contains the script.
When Cause B fires, the image is wrong but the postCreateCommand still references `lace-fundamentals-init`, producing exit 127 at runtime.
Exit 127 makes the failure look like a PATH/runtime bug, hiding the upstream build-cache invariant violation.

### Why this will keep flip-flopping

After running `lace up --rebuild` in whelm, the shared tag will hold *whelm's* feature set.
The next time weftwise runs `lace up`, weftwise will hit the same bug in the opposite direction (its `contextsChanged()` will still pass, the image will exist, but its features will now be wrong for weftwise).
Without a structural fix, this is a permanent thrash between any two projects that share a `FROM` and disagree on prebuild features.

## Evidence Trail

- Run log: `~/code/apps/whelm/.lace/logs/2026-05-05T21-42-16-2f75bd.log`
- Drift fingerprint match: `~/code/apps/whelm/.lace/runtime-fingerprint` = `c7e93b54e35ee805`, current fingerprint computed identical.
- whelm prebuild context + metadata: `~/code/apps/whelm/.lace/prebuild/.devcontainer/devcontainer.json`, `~/code/apps/whelm/.lace/prebuild/metadata.json`
- weftwise prebuild context + metadata: `~/code/weft/weftwise/main/.lace/prebuild/.devcontainer/devcontainer.json`, `~/code/weft/weftwise/main/.lace/prebuild/metadata.json`
- Image feature labels: `podman inspect lace.local/node:24-bookworm --format '{{json .Config.Labels}}'` -> `devcontainer.metadata`
- Image creation timestamp at the time of the incident: `podman image inspect lace.local/node:24-bookworm --format '{{.Created}}'` -> 2026-05-01 (4 days before the failing run; matches weftwise's metadata timestamp, contradicts whelm's 2026-03-27 metadata timestamp).
  > NOTE(opus/lace/prebuild-cache-collision): After the post-incident `lace up --rebuild`, this image's `Created` is now 2026-05-06 (whelm's bake), not the 2026-05-01 captured here.
  > A re-running of the inspection will show the post-fix value.
- In-container probe: `/usr/local/bin/lace-fundamentals-init` absent; `chezmoi` absent.

## Recommendations

### Immediate (whelm, today)

Run `lace up --rebuild` in `~/code/apps/whelm`.
Forces the prebuild image rebuild and recreates the container.
Acknowledged side effect: the next weftwise run will trip the inverse failure.

### Short-term (lace, no API break)

1. **Verify image features after a cache hit.**
   In `prebuild.ts` cache-hit branch, read `Config.Labels."devcontainer.metadata"` from the tagged image and ensure every project-requested feature id is present.
   On mismatch, force a rebuild and emit a warning that explains the collision.
   This alone closes Cause B without changing tag layout.

2. **Detect the lace-fundamentals-init invariant before container start.**
   After image build (or after a verified cache hit), `podman run --rm <image> sh -c 'command -v lace-fundamentals-init'`.
   On miss when the feature is requested, fail the `prebuild`/`generateConfig` phase with a structured error that names the responsible feature, instead of exiting 127 in postCreateCommand.

### Structural (lace, design choice)

Two viable directions; the report does not pick one:

- **Per-project prebuild tags**, e.g. `lace.local/<projectName>/node:24-bookworm`.
  Cheapest, eliminates the collision class entirely.
  Cost: loses cross-project image sharing even when the feature sets *do* agree.
  Storage cost is non-trivial for users with many projects (the whelm and weftwise images are each ~3.8 GB).

- **Content-hashed tags**, e.g. `lace.local/node:24-bookworm-<hash(features+dockerfile+args)>`.
  Preserves sharing when feature sets agree, distinct tags otherwise.
  Cost: more tags to garbage-collect; need a sweep policy for stale `lace.local/*` images.

A hybrid is possible (content-hash by default, with a project-name fallback when hashing is undesirable), but should be designed in a proposal, not decided here.

### Adjacent improvement (Cause A)

Optional fast path in `lace up`: when fingerprint matches **and** a container with the expected name exists in `Up` state **and** all expected mounts are intact, skip the `devcontainer up` call entirely.
Would meet the user's expectation that an unchanged-config `lace up` is near-instantaneous.
This is independent of the prebuild fix and could ship separately.

## Out of Scope

- Why the prior `vsc-whelm-...` image was deleted (Cause A's trigger). Likely host maintenance; no evidence of a lace-side cleanup.
- The unidentified local feature in the weftwise image's `devcontainer.metadata` label (one entry has no `id`); not load-bearing for this incident.
- The status of `sprack` (whelm's other local prebuild feature). It would also be missing from the substituted image; whether anything in postCreateCommand or the container assumes its presence wasn't probed.
