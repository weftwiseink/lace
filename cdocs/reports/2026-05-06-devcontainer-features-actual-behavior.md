---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-06T16:46:21-07:00
task_list: lace/prebuild-cache-rethink
type: report
state: live
status: review_ready
tags: [devcontainer, features, caching, web_research, investigation, rfp_input]
---

# Devcontainer Features: Actual Behavior in Spec and in the Field

> BLUF: The spec says features install once during image build, are cached as Docker layers, and should not re-run on container start.
> In practice, the devcontainer CLI shipped a long-standing cache-busting bug (a `Date.now()` in the build context path, issue #313) that meant builds frequently could not reuse Docker layer cache, and downstream tools like DevPod compounded this by treating restarts as rebuilds.
> The user's recollection - "features were cache-busted overly aggressively by default" - is supported by primary sources for the period in which lace was built, though incremental fixes have landed since 2023.
> Re-running on every container *start* is not specced behavior; re-running on every *rebuild* without effective cache reuse was a real, documented CLI defect.

## Context

This report supports the prebuild-cache-rethink workstream.
It is the web-research counterpart to the in-repo options report at `cdocs/reports/2026-05-05-prebuild-cache-system-options.md` and the RFP at `cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`.
The author is questioning whether the original justification for lace's custom prebuild mechanism, namely that devcontainer features re-installed too aggressively, holds up against the actual specced and observed behavior.
This report does not evaluate lace's design choices; it characterizes what devcontainer features do.

## Method

Sources searched: the official spec at `containers.dev`, the `devcontainers/spec` and `devcontainers/cli` GitHub repositories (issues, discussions, changelog), VS Code documentation, GitHub Codespaces documentation, Ken Muse's blog (a frequently cited devcontainer practitioner), DevPod's issue tracker, and related discussions.
Web search and direct fetches were used; this agent did not read the lace codebase or its in-repo cdocs.
Citations are inline and consolidated at the end.

## Spec Behavior

The specification frames features as build-time artifacts.
Per the features reference, "the `install.sh` script for each Feature should be executed as `root` during a container image build," and "each Feature's install script runs as its own distinct layer, which serves dual purposes: it helps with caching and enables rebuilding specific Features without reprocessing others" ([containers.dev features ref]).
Features are not specced to run at container start.

The lifecycle separation in the spec is explicit.
On creation, the spec states "at the end of the container creation step, a set of commands are executed inside the main container: `onCreateCommand`, `updateContentCommand` and `postCreateCommand`. This set of commands is executed in sequence on a container the first time it's created" ([devcontainer-reference.md]).
On resume from a stopped state, the spec instructs implementors to "restart all related containers" and then "execute the `postStartCommand` and `postAttachCommand`" ([devcontainer-reference.md]).
The spec contains no language requiring features to be re-evaluated or re-installed on resume.

The spec does not, however, prescribe how features should be cached across rebuilds.
That is treated as an implementation concern of the consuming tool (the CLI, VS Code, DevPod, Codespaces), and the implementations diverge.

## Field Behavior

Field reports cluster around three distinct failure modes that are easy to conflate.

**1. Effective cache loss on rebuild (a real CLI defect).**
`devcontainers/cli` issue #313 documents that `devcontainer build` "chooses to use a different `--build-context` on each build, forcing Docker to build from scratch each time."
The root cause is identified in the issue: the temporary folder name appended `Date.now()`, so each invocation produced a fresh build context path that Docker could not match against previous layer cache ([cli #313]).
The issue was opened December 2022.
A partial fix landed in `devcontainers/cli` PR #382 (merged February 2023): features are now incrementally copied "near the layer they're installed," which in measurements cited on the PR cut a single-feature-change rebuild from ~89s to ~32s, roughly 2.7x ([cli #382]).
A community discussion on GitHub captured the official posture during this window: "We are expecting that the Features are cached, however, there is a regression. There's a PR to fix this in review" ([community #45941]).

**2. Tools treating restart as rebuild (an implementation defect, not spec).**
DevPod issue #904 reports: a devcontainer built with features is "rebuilt every time it is restarted" because "the devcontainer is lost somehow, so that the next time it starts again, all the features are re-evaluated and re-installed."
The reporter explicitly contrasts this with VS Code's Dev Containers extension, which preserves the built container across restarts ([devpod #904]).
This is a downstream-tool bug, not a spec mandate, but it is part of the lived experience of users in 2023-2024.

**3. Slow extension and feature work generally.**
Independent of caching, users routinely report slow feature and extension installs.
Ken Muse's analysis identifies the structural cause: "you can't take advantage of using RUN-scoped caches to assist with package management" inside feature install scripts, because cache mounts are not exposed to features the way they are to handwritten Dockerfiles ([kenmuse features perf]).
A separate Ken Muse post recommends `build.cacheFrom` against a registry-backed image cache as the practical mitigation ([kenmuse fast start]).
A 2025 retrospective summarizes the trade-off bluntly: "features are installed when the development container is created by your IDE so you won't reap some inherent benefits like caching pre-built images" ([ivanlee 2025]).

VS Code issue #6336 ([vscode-remote-release #6336]) is worth flagging separately: there was a period where `onCreateCommand`, `updateContentCommand`, and `postCreateCommand` did *not* re-run on container recreation, the inverse of the user's recollection.
That was patched in Remote-Containers v0.223.0.

## Lifecycle Hooks Reference

The hook semantics are the load-bearing question for whether a custom prebuild is needed.
Source: the spec's JSON reference and lifecycle documentation ([containers.dev json_reference], [devcontainer-reference.md], [deepwiki spec lifecycle]).

| Hook                    | Where it runs   | When it runs                                                                                  | Frequency                                                  | Included in Codespaces prebuild? |
|-------------------------|-----------------|-----------------------------------------------------------------------------------------------|------------------------------------------------------------|----------------------------------|
| `initializeCommand`     | Host            | Before container creation and before each start                                               | Every create and every start                               | N/A (host)                       |
| Feature `install.sh`    | Image build     | During image build, as Docker layers                                                          | Once per image build; cached if Docker cache is effective  | Yes (baked into image)           |
| `onCreateCommand`       | Inside container| First create only                                                                             | Once per container lifetime                                | Yes                              |
| `updateContentCommand`  | Inside container| After `onCreateCommand`; also re-run on prebuild content updates                              | Once on create, plus prebuild updates                      | Yes                              |
| `postCreateCommand`     | Inside container| After `updateContentCommand`, after user assignment                                           | Once per container lifetime                                | No (runs after codespace create) |
| `postStartCommand`      | Inside container| Every successful container start                                                              | Every start, including the first                           | No                               |
| `postAttachCommand`     | Inside container| Every successful tool attach                                                                  | Every attach                                               | No                               |

Feature install is a build-time concern.
Lifecycle hooks are container-instance concerns.
A misconfigured hook (e.g., putting heavy installs in `postStartCommand`) will reproduce the symptom of "things rebuild every start" without features being at fault.

## The "Cache-Busting" Question

The recollection: "features were cache-busted overly aggressively by default."
Verdict: substantially supported for the 2022-2023 timeframe, partially mitigated by 2024+.

Citable evidence supporting the claim:

- `devcontainers/cli` issue #313 ([cli #313]): the CLI itself was generating uncacheable build contexts via `Date.now()` in the temp folder path. This is the canonical primary source for "cache-busted by default."
- `devcontainers/cli` PR #382 ([cli #382]): explicit acknowledgement that "the image rebuilds all features even though only the last one changed" and the fix targets exactly that.
- `devcontainers/cli` issue #508 ([cli #508]): users observed "CACHED" output even with `--no-cache`, indicating the cache semantics were confused enough that operators could not predict behavior.
- `devcontainers/spec` discussion #327 ([spec #327]): the `features` entry being an unordered object means that adding any one feature can shuffle install order via `installsAfter`, "break[ing] the container build cache of many features needlessly."

Citable evidence against the strongest form of the claim:

- The spec does not require features to re-run on container start; container *restart* preserving features is the documented expected behavior.
- VS Code's Dev Containers extension has, since at least 2022, persisted built containers across restarts; users complaining of rebuild-on-restart (e.g., DevPod #904) are reporting tool-specific bugs, not spec behavior.

The claim "I had a Dockerfile where every start would cache-bust" cannot be fully evaluated without the Dockerfile.
If the Dockerfile was being rebuilt on every start, that points to a tool driving `devcontainer up` with `--build-no-cache` semantics, or to the #313 build-context bug, or to a tool that did not preserve the container between starts.
No citable source found for "every *start* cache-busts a Dockerfile" as a specced or default behavior.

The claim "features can take a while to install" is uncontroversial.
Specific numbers in the wild: PR #382's measurements show a single-feature rebuild at ~89s before the fix and ~32s after ([cli #382]), and Ken Muse's post on cache mounts implies installs of seconds to minutes per feature depending on what is being compiled ([kenmuse features perf]).
No single canonical "feature install takes N minutes" benchmark surfaced in this search.

## Workarounds the Spec Already Provides

A developer hitting slow or repeated feature installs has, before reaching for a custom mechanism, this toolkit:

1. **Move heavy work into the Dockerfile** with `RUN --mount=type=cache,...` to use BuildKit cache mounts directly. Features cannot do this; a custom Dockerfile can ([kenmuse features perf], [docker buildkit cache]).
2. **Use `build.cacheFrom`** with a registry-pushed image to source layers from a remote cache, which makes feature layers reusable across machines ([kenmuse fast start]).
3. **Prebuild with `devcontainer build --push`** in CI and reference the resulting image in `devcontainer.json`, reducing client-side rebuild to an image pull ([containers.dev prebuild guide], [devcontainer.community prebuild]).
4. **Place idempotent setup in `onCreateCommand` / `updateContentCommand`** so prebuild systems can bake the result into the image, rather than in `postStartCommand` which runs every start ([github docs prebuilds], [deepwiki spec lifecycle]).
5. **Mount package caches via lifecycle events** (e.g., a Docker volume on `/root/.cache/pip`) so feature work that cannot be moved to build time at least amortizes across rebuilds ([kenmuse features perf]).
6. **Use `installsAfter` and `dependsOn`** to stabilize feature ordering and reduce cache-invalidation cascades when adding features ([containers.dev features ref], [spec #327]).

The spec already covers the cases that "do work once, reuse it" requires.
The realized convenience depends on whether the implementation honors them.

## Codespaces Prebuilds

GitHub Codespaces prebuilds are the official, hosted prebuild story.
Per GitHub's documentation, prebuilds "create a snapshot with all features already loaded," include the dev container configuration, dependencies, tools, `onCreateCommand` and `updateContentCommand` results, and the repository code at the prebuild branch ([github docs prebuilds], [community #45941]).
`postCreateCommand` is intentionally not part of the prebuild because it is meant to depend on user-specific state.

Codespaces prebuilds run as GitHub Actions on push or schedule, push the result to GHCR, and codespaces created from that branch start from the prebuilt image rather than rebuilding ([sitepoint codespaces prebuilds]).
This is essentially the same architectural pattern as `devcontainer build --push` plus an automated trigger, with hosted ergonomics layered on top.
For a self-hosted user, the equivalent is the `devcontainers/ci` GitHub Action documented at devcontainer.community ([devcontainer.community prebuild]) plus a `cacheFrom`-aware client.

So: yes, Codespaces prebuilds cover the same ground a local prebuild mechanism would, for users on Codespaces.
For users who run devcontainers via the CLI or via VS Code locally, Codespaces prebuilds are not directly applicable, and the equivalent self-hosted pattern is supported but not turnkey.

## What Changed 2024-2026

From the `devcontainers/cli` CHANGELOG ([cli changelog]):

- **0.30.0 (Feb 2023):** "Incrementally copy features near the layer they're installed" - the structural cache fix from PR #382.
- **0.51.0 (Aug 2023):** Added `--cache-to` to `devcontainer build`, enabling registry-backed cache export.
- **0.50.0 (Jul 2023):** Feature dependencies recorded in lockfiles, reducing churn from version drift.
- **0.69.0 (Aug 2024):** Improved template metadata caching.
- **0.83.0 (Jan 2026):** "Added `BUILDKIT_INLINE_CACHE` support for container Feature paths," streamlining cross-build cache availability.

The trajectory is incremental improvement, not a step-function fix.
Users on roughly 0.50-0.70 (the window in which lace appears to have been built per the user's framing) had `--cache-to`/`--cache-from` available but did *not* have the inline-cache-on-feature-paths integration that landed in 0.83.0.
The "cache-busted by default" experience was less defensible by 2026 than it was in 2023, but the gap between "cache exists" and "cache works for features without configuration" persisted across the entire window.

The spec itself ([spec #345]) still has an open issue from 2023+ about exposing BuildKit `RUN --mount=type=cache` to feature authors, indicating that features still cannot use Docker's strongest caching primitive directly.

## Citations

- [containers.dev features ref] https://containers.dev/implementors/features/ - Official spec for feature install behavior, dependsOn, installsAfter, layering.
- [containers.dev json_reference] https://containers.dev/implementors/json_reference/ - Official metadata reference for lifecycle hooks.
- [containers.dev prebuild guide] https://containers.dev/guide/prebuild - Official prebuild guide; recommends `devcontainer build --push` plus CI.
- [devcontainer-reference.md] https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-reference.md - Canonical spec for create-vs-resume lifecycle.
- [deepwiki spec lifecycle] https://deepwiki.com/devcontainers/spec/2.3-dev-container-lifecycle - Secondary summary of lifecycle ordering.
- [cli #313] https://github.com/devcontainers/cli/issues/313 - "`devcontainer build` does not use docker build cache"; documents the `Date.now()` cache-bust bug.
- [cli #382] https://github.com/devcontainers/cli/pull/382 - Merged Feb 2023; incremental feature copy; ~2.7x rebuild speedup on single-feature change.
- [cli #508] https://github.com/devcontainers/cli/issues/508 - "`--no-cache` doesn't appear to prevent cache"; semantic confusion in CLI cache flags.
- [cli changelog] https://github.com/devcontainers/cli/blob/main/CHANGELOG.md - Release notes; tracks cache-to, BUILDKIT_INLINE_CACHE, dependency lockfiles.
- [spec #327] https://github.com/devcontainers/spec/discussions/327 - Discussion on rebuild performance, feature ordering, and pinning.
- [spec #345] https://github.com/devcontainers/spec/issues/345 - Open issue: integrate BuildKit cache mount into features.
- [spec #477] https://github.com/devcontainers/spec/issues/477 - Differences between onCreateCommand, updateContentCommand, postCreateCommand.
- [community #45941] https://github.com/orgs/community/discussions/45941 - Maintainer confirms cache regression and that Codespaces prebuilds bake features in.
- [devpod #904] https://github.com/loft-sh/devpod/issues/904 - DevPod rebuilds features on restart; user contrasts with VS Code behavior.
- [vscode-remote-release #6336] https://github.com/microsoft/vscode-remote-release/issues/6336 - onCreate/updateContent/postCreate not re-running on recreation; fixed in v0.223.0.
- [github docs prebuilds] https://docs.github.com/en/codespaces/prebuilding-your-codespaces/configuring-prebuilds - Official Codespaces prebuilds documentation.
- [sitepoint codespaces prebuilds] https://www.sitepoint.com/github-codespaces-prebuilds-ci-cd-optimization/ - Walkthrough of Codespaces prebuild CI/CD.
- [devcontainer.community prebuild] https://devcontainer.community/20250303-prebuild-devcontainer/ - Self-hosted prebuild via `devcontainers/ci` GitHub Action.
- [kenmuse features perf] https://www.kenmuse.com/blog/improving-dev-container-feature-performance/ - Practitioner analysis of feature caching limits and lifecycle-mount workarounds.
- [kenmuse fast start] https://www.kenmuse.com/blog/fast-start-dev-containers/ - `build.cacheFrom` plus registry-backed cache as fast-start strategy.
- [ivanlee 2025] https://ivanlee.me/devcontainers-in-2025-a-personal-take/ - 2025 retrospective; explicit on features-vs-cached-images trade-off.
- [docker buildkit cache] https://docs.docker.com/build/cache/backends/inline/ - Docker docs on inline cache and BUILDKIT_INLINE_CACHE.
