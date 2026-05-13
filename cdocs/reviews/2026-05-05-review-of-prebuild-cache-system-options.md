---
review_of: cdocs/reports/2026-05-05-prebuild-cache-system-options.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-05T18:15:00-07:00
task_list: lace/prebuild-cache-rethink
type: review
state: live
status: done
tags: [self, fresh_agent, prebuild, caching, architecture, design_exploration]
---

# Review: Prebuild Cache System: Options for a Rethink

## Summary Assessment

The report does the core job of an exploration document well: it pulls five tangled decisions apart, names them, and shows that the current scheme is one point in a multi-dimensional space rather than a baseline.
The five-axis framing is the strongest contribution and probably the load-bearing artefact for the eventual proposal.
The bundled configurations P0-P6 are mostly distinct, but several lean toward axis-A/E variations and underuse the more radical axes (B, C, D).
The largest gap is in the "creative directions" the user explicitly invited: a remote-registry / sidecar-registry path is missing entirely, the Nix-style content-addressed-store framing is only implicit, and "what if features themselves are wrong shape" never quite surfaces.
The Lens 3 framing is genuinely honest but the recommendation-posture epilogue partially walks it back.

Verdict: **Revise (light)**. The report is usable as-is for kicking off the proposer's work, but tightening it would meaningfully widen the option space the proposer considers. Most action items are additive, not corrective.

## Section-by-Section Findings

### BLUF and Framing

**Strength.** The BLUF correctly identifies the load-bearing claim: "most existing pain comes from coupling all five axes inside one image tag; decoupling even one (especially 'where features install') collapses much of the cache complexity." That sentence alone earns the report its keep.

**Non-blocking finding.** The BLUF also implicitly endorses axis D as the highest-value lever ("especially 'where features install'"). That is a recommendation in disguise. Either own it explicitly in the Recommendation Posture section, or soften the parenthetical to remove the lean.

### Five-Axis Framing

**Strength.** The five axes are genuinely orthogonal and the small "current scheme picks: A1+B1+C1+D1+E1" summary is the right framing device.

**Blocking finding.** The axis decomposition is missing at least one axis that the user's open-design prompt invites: **distribution / sharing scope**. Where can a cached artefact come from? Today the implicit answer is "this host's runtime store". Possible answers include:

- This host only (current).
- Multiple hosts owned by the same user (shared NFS, syncthing on `~/.cache/lace/oci/`).
- A team registry (self-hosted `localhost:5000` per-machine, or a shared `prebuild.team.example.com`).
- A community / public registry of pre-baked feature combinations (analogous to a Homebrew bottle cache or a Nixpkgs binary cache).

This axis matters because it changes the answer to "is sharing across projects worth the complexity": if pre-baked combos can be pulled from a community cache, the cost of a content-hashed scheme is amortised across all users instead of paid per-laptop. It also reframes axis B (storage backend) as a special case of "where the content lives".

The report touches this only in B2 ("rsync or a registry sync") as a side benefit and in B1's con ("cross-host portability requires registry push/pull"), but never as a first-class axis. Adding it as **Axis F: Distribution scope** with options F1 (host-local, current), F2 (user-shared), F3 (team registry), F4 (public/community registry) would close the gap and may unlock the most interesting "rethink" moves.

**Blocking finding.** The axes are described as "independent in principle" but the report doesn't quite stress-test that. A few examples of axis interaction that would be worth a sentence each:

- C2 (per-feature layers) effectively forces B2 (OCI layout) or a registry, because the runtime image store doesn't natively expose individual layers as cache hits across images.
- D2 (lazy install) plus C4 (no layer reuse) is essentially equivalent to "no prebuild" with extra steps.
- E4 (trust the cache) only makes sense paired with A2/A3 — calling that out in axis E is good, but the analogous coupling between A1 and the *need* for E2/E3 is not stated.

A short paragraph at the end of the axes section listing the strongest forced-pair couplings would help the proposer reason about which axes are actually free.

### Axis A: Tag Identity

**Strength.** A1-A5 covers the standard span well. A5 (no tags) is the right escape hatch and is correctly flagged as "requires a layer between lace and the runtime."

**Non-blocking finding.** A3 ("hash inputs need a stable canonicalisation") undersells the difficulty. Canonicalising a feature spec is genuinely hard: feature options can be free-form strings, devcontainer feature install order is sometimes load-bearing, and the digest of an OCI feature artefact only stabilises if the feature publisher uses immutable tags (many don't). The smart-cache-busting RFP from 2026-01-31 already tried to enumerate impactful vs. non-impactful fields and concluded the answer is non-trivial; this report should either reference that prior work or note that A3's hash design is the place that absorbs the smart-cache-busting RFP's open questions.

**Non-blocking finding.** Missing option: **A6 — Image digest references throughout, no `lace.local/*` namespace.** If the prebuilt image is referenced by digest (`sha256:...`) in a side-channel (lace metadata, not the user's devcontainer.json), the entire `lace.local` rewrite dance disappears. The runtime sees a normal pinned image; lace's bookkeeping lives in `~/.cache/lace/`. This is closer to A5 but distinct: A5 says "no tags", A6 says "let the runtime tag, but don't rewrite user files". Worth at least a paragraph because it changes what migration looks like.

### Axis B: Storage Backend

**Strength.** B1-B4 is a reasonable span. B2 (OCI layout) is well-described.

**Blocking finding.** Missing option: **B5 — Local registry sidecar.** A `localhost:5000` registry (or `podman run -d registry:2`) hosts the `lace.local` images. The runtime pulls by digest, the registry handles GC and dedup, and cross-host sharing is `docker login` away. This is a genuinely different design point from B1-B4 — it adds a long-running process but removes the namespace-pollution problem of B1 and the materialisation step of B2. It also pairs naturally with the proposed Axis F (distribution scope).

The reason this is worth flagging as blocking: the user explicitly asked about "self-hosted localhost registry" as a creative direction probe in their review prompt. Its absence is a coverage gap.

**Non-blocking finding.** B3 (podman volumes / overlay snapshots) is described accurately but the docker-on-macOS counter-argument may be soft. The current project-internal CLAUDE.md indicates lace is increasingly podman-centric (linuxbrew podman, `containers-storage:`); if docker support is more nominal than real, B3's downside should be re-weighted. Worth a sentence acknowledging this.

**Non-blocking finding.** B4 (pre-fetched tarballs only) is interesting but underexplored. The con ("only saves network") is too quick: feature install scripts often dominate the time, but the *download* of large feature payloads (e.g., neovim, claude-code binaries that the feature internally `curl`s) can be substantial. A version of B4 that also caches the feature's *internal* downloads (e.g., a per-feature HTTP cache or a `~/.cache/lace/downloads/` symlinked into the build) is meaningfully different from the bare "OCI artefact tarball" path. Consider splitting B4 into B4a (feature OCI artefact cache only) and B4b (feature OCI + per-feature download cache).

### Axis C: Layer Reuse Philosophy

**Strength.** C1-C4 cover the span and C2 is correctly identified as "probably the most right-feeling long-term answer; also the largest investment."

**Non-blocking finding.** C2's con ("not every feature is layer-clean") is real but the report should be more specific: features that touch `/etc/passwd`, install systemd units, or `apt-get install` packages with post-install scripts that depend on already-installed packages can break under naive layer composition. The proposer needs to know this is a feature-author contract problem, not just a lace-side composition problem.

**Non-blocking finding.** Missing option: **C5 — Nix-style content-addressed store.** Each feature install produces a content-addressed directory (or layer); the project image is composed by symlinking or overlay-mounting these into a final rootfs. This is a real design point in the wider ecosystem (Nix, Bazel rules_oci, distrobox-with-toolbx). The user explicitly asked about "Nix-style content-addressed stores" as a creative-direction probe; its absence is a coverage gap.

C5 is distinct from C2 in that the unit of caching is *the post-install filesystem state*, not an OCI layer. C2 still produces images; C5 produces directories or overlay layers and assembles them at run time. The migration cost of C5 is higher but it eliminates the "is this feature layer-clean" question by construction (each feature gets its own private rootfs slice).

**Non-blocking finding.** Missing option: **C6 — Distrobox / toolbx-style: the container is the user's home, features are the user's apps.** Features become packages installed into a long-lived container, not baked into an image. The image is just a base; everything else lives in mounted volumes and persists across recreations. This is a real and growing model in the dev-environment space. It collapses to "no prebuild" (C4 + D2) for fresh containers but adds a notion of *the container is the cache*.

Worth at least a NOTE-style mention even if rejected, because it's a coherent alternative philosophy that the report otherwise treats as outside the design space.

### Axis D: When Features Install

**Strength.** D1-D4 is a clean cut and D3 (hybrid by install phase) is the most pragmatic option. The pro ("matches reality - the project already has lace-fundamentals-init as a runtime step") is the right framing.

**Non-blocking finding.** D3's split is by *install phase* (build-time vs. runtime). The user's review prompt explicitly asks "is D3 the right cut, or are there other ways to slice it?" Possible alternative cuts:

- **By feature stability.** Features that change rarely (language runtimes, system packages) are baked; features that change per-project or per-user (dotfiles, identity) are runtime. This is roughly what D3 says but framed differently.
- **By trust boundary.** Features that need root in build context vs. features that should run as the user.
- **By cost asymmetry.** Features whose install dominates wall-clock time get cached; cheap features run fresh every time. This is more like a per-feature opt-in than a hard split.
- **By failure mode.** Features whose install can fail in ways the build context can't recover from (network, auth) move to runtime where the user can retry.

Each of these motivates a different per-feature classification, and the proposer should pick a basis explicitly rather than inheriting D3's "fast invariant vs. user-facing" intuition. A short subsection under D3 listing alternative slicing axes would address the user's question directly.

**Non-blocking finding.** D4 ("every container start, no install caching") is dismissed quickly. There's a real version of D4 worth flagging: containers as ephemeral, like CI runners. If `lace up` always destroys and recreates, D4 becomes the natural model and the cache problem becomes "cache the bytes, not the state". This is closer to how GitHub Actions / GitLab CI runners work, and it's a coherent design choice if lace's audience is willing to embrace ephemeral containers. Worth a sentence.

### Axis E: Cache Validation

**Strength.** E1-E4 is the right span and E2 (label verification) is correctly identified as the smallest patch.

**Non-blocking finding.** E3 (in-image probe) is described as "100-500 ms per cache hit." That cost estimate is asserted but not sourced. A `podman run --rm <image> sh -c 'true'` on a warm cache is typically under 200 ms; a cold cache is unbounded. Either anchor the estimate or remove the parenthetical.

**Non-blocking finding.** Missing option: **E5 — Validate by re-running the build with `--cache-only` and diffing.** If the build pipeline supports a "dry build that only consults the cache", a cache hit can be verified by replaying the same logical build and confirming it would produce the same result. This is more expensive than E2 but cheaper than rebuilding, and it catches the class of bugs E2 misses (feature option drift). Probably not worth pursuing in practice but worth naming so the proposer can reject it explicitly.

### Bundled Configurations

**Strength.** P0-P6 are mostly distinct design points and the framing as "concrete combinations" is the right shape.

**Blocking finding.** Some bundles collapse into the same de-facto choice:

- **P1 vs. P6.** P1 is A2+B1+C1+D1+E1; P6 is A2+B1+C4+D1+E4. The differences (C1 vs. C4, E1 vs. E4) are weak: under per-project tags (A2), there's no collision class for E1 to fail on, so E4 is effectively safe. And C1 vs. C4 only differs if the user has multiple projects sharing a `FROM`, in which case A2 already prevents reuse. Net: P1 and P6 likely have indistinguishable runtime behaviour for a single-project user. Worth either merging them or sharpening the difference (P6 should commit to "no `lace.local/*` namespace at all" rather than just "trust the cache").
- **P2 vs. P3.** P2 is A3+B1+C1+D1+E2; P3 is A5+B2+C1+D1+E2. The user-visible difference is "tags appear in `podman images`" vs. "they don't"; the structural difference is who owns the cache. These are genuinely different but the bundle descriptions don't make the user-experience difference vivid enough.

Recommend a small table at the start of the bundles section summarising "what does the user see in `podman images` after a fresh `lace up`" for each P0-P6.

**Blocking finding.** Missing bundle: **P7 — Registry-backed shared cache.** A2/A3 + B5 (local registry) + C1 + D1 + E2 + F3 (team registry). This is the bundle that addresses the question "what if multiple developers want to share prebuilt artefacts." It's a meaningfully different design point and probably the right answer for a team setting. Its absence is the same coverage gap that motivated adding axis F.

**Non-blocking finding.** Missing bundle: **P8 — Content-addressed store, no images.** A6 + C5 (Nix-style) + D3. The cache is `~/.cache/lace/store/<sha>/` directories overlay-mounted at run time. Most architecturally clean if the team is willing to move outside OCI primitives entirely. Worth naming even if rejected as too big a lift.

### Cross-Cutting Considerations

**Strength.** The Migration subsection is honest about the three stances (auto-detect, document-and-delete, forward-compatible) and correctly notes that A3 has the "old tags become harmless leftovers" property.

**Blocking finding.** The Cleanup ownership subsection is one paragraph and underweighted relative to its importance. The cleanup story is the most user-visible operational difference between the bundles, and the report doesn't carry that weight through. Specifically:

- For each P0-P6, what is the cleanup model (user-driven `podman image prune`? `lace cache prune`? automatic LRU)?
- How does the user discover that the cache has grown to N GB and what does the error/warning look like when disk is full?
- For P3/P4 with `~/.cache/lace/oci/`, what is the migration story when the user moves this directory or it's on a network drive?

A short table mapping bundles to cleanup models would address this.

**Non-blocking finding.** The Devcontainer CLI coupling subsection is good — "once lace owns the build path, regaining devcontainer-CLI parity is non-trivial" is the right warning. Consider strengthening: there's a third option beyond "use devcontainer build" or "replace it" — *contribute upstream*. If lace's needs are general enough, a `devcontainer build --layer-per-feature` flag in the upstream CLI would be a force multiplier. Probably out of scope but worth a NOTE-callout for the proposer.

**Non-blocking finding.** Missing cross-cutting: **Failure-mode UX.** When a cache-related failure happens (collision today, materialisation failure under B2, registry unreachable under B5), what does the user see? The current incident demonstrated that exit-127-at-postCreateCommand is a terrible diagnostic. Each bundle should be evaluated on whether it makes the failure mode legible. P0 (label verification) gets this for free; P3/P4 introduce new failure modes (materialisation, layer assembly) that need their own diagnostics. Worth a paragraph.

### Lens Framing

**Strength.** The three lenses are honest in concept and Lens 3 is correctly identified as on the table.

**Non-blocking finding.** Lens framing leans toward Lens 2. The "ships in days / weeks / months" framing implicitly endorses moving fast: faster lenses look more attractive when the reader is impatient. A more neutral framing would be "smallest blast radius / preserves mental model / smallest total system complexity" — the first emphasises risk, the second status-quo bias, the third long-term cost. Right now Lens 3 reads as the brave-but-slow option; it could equally read as the simple-but-radical option.

**Non-blocking finding.** The Recommendation Posture section says "this report deliberately does not pick" and then picks. P2 is named as "the smallest jump from current that fully closes the bug class"; P3 as "more architecturally clean"; P5 as "deserves serious consideration." That's three soft recommendations — fine if owned explicitly, but it contradicts the deliberate-non-pick posture. Either:

- Drop the recommendation posture section entirely (let the lenses do the work).
- Own the soft recommendation explicitly: "If forced to pick, the author's lean is X; the reasoning is Y; the proposer should override if Z."

The current middle ground reads as having-it-both-ways.

### Open Questions for the Proposer

**Strength.** Five concrete questions, each load-bearing for a specific axis. Question 1 (multi-project usage pattern) is the right top question.

**Non-blocking finding.** Missing question: **What is the team-vs-solo audience?** The report frames lace as a single-developer tool. If lace is also targeting team adoption (shared base images, onboarding-time cache pulls, CI integration), the answer to axes B and the proposed axis F changes substantially. The proposer should know the answer before picking.

**Non-blocking finding.** Missing question: **What is the relationship between `lace prebuild` and `lace up`?** Some bundles (P5) blur the line; others (P3/P4) sharpen it. The proposer should declare whether prebuild remains a separate phase or collapses into up.

## Adequacy of Coverage on User-Probed Directions

The user explicitly asked about four specific creative directions. Coverage assessment:

| User probe | Coverage in report | Verdict |
|---|---|---|
| Self-hosted localhost registry | Mentioned in B2 con ("registry sync") only | **Missed.** Add axis F (distribution scope) and bundle P7. |
| Community registry of pre-baked feature combos | Not present | **Missed.** Same axis F and a worked example. |
| Nix-style content-addressed stores | Not present | **Missed.** Add C5 in axis C. |
| Distrobox-style approaches | Not present | **Missed.** Add C6 in axis C, or note explicitly as out-of-scope with rationale. |
| "No cache, no prebuild" minimalist (P6) | Present as P6 | **Adequate**, though P6 collapses with P1 and should be sharpened. |
| D3 alternative slicings | Not addressed | **Missed.** Add subsection under D3 listing alternative cuts. |

Three of six probes are genuinely missing. This is the strongest reason for a "Revise (light)" verdict.

## Honesty Assessment

The report mostly avoids implicit endorsement of the current scheme. Scoring:

- **Tag identity (A).** Honest. The current scheme (A1) is presented as the source of the bug, not defended.
- **Storage backend (B).** Honest. B1's pros and cons are balanced.
- **Layer reuse (C).** Slight lean toward C2 ("probably the most right-feeling long-term answer"). Acceptable as long as the language stays soft, which it does.
- **When features install (D).** Lean toward D3 ("matches reality"). The phrasing is too strong — "matches reality" is a value judgement, not a fact. Consider softening to "matches the project's existing direction with `lace-fundamentals-init`."
- **Cache validation (E).** Honest. E1 is correctly tagged as "the bug."
- **Bundles.** Slight lean toward P2 in the recommendation posture (covered above).
- **Lenses.** Neutral framing of the lenses themselves; the labels could be more balanced (covered above).

Overall the report avoids the worst form of path-dependence (presenting incremental options as inherently safer) but does accumulate small leans that, taken together, soft-endorse "P2 with D3 elements". The proposer should be aware they are receiving a tilted-but-fair starting point, not a neutral one.

## Tradeoff Clarity Assessment

Each axis option lists pros and cons. Spot-check on concreteness:

- **A1 con ("collisions when feature sets differ"):** concrete, links to incident. **Good.**
- **A3 con ("more tags accumulate"):** generic. **Tighten** to "expect O(n_projects × n_feature_combinations) tags; needs `lace cache prune` or LRU policy with size budget."
- **B2 pro ("portable; cross-host sharing is rsync"):** concrete and actionable. **Good.**
- **C1 pro ("simple to think about"):** generic. This is the kind of pro that should be cut or replaced with a concrete operational claim ("one image per project, one tag, one path through the build pipeline").
- **C4 con ("relies on podman/docker's automatic layer cache being good enough -- empirically it can be flaky for `RUN curl | sh` patterns"):** concrete and operationally useful. **Good.**
- **D2 con ("first start is much slower"):** concrete but unquantified. **Tighten** with a rough estimate (current full prebuild is 60-120s; lazy install would push that to first-container-start instead).
- **E2 con ("doesn't catch differences in feature options"):** concrete. **Good.**

About 70% of the pros/cons are concrete and actionable; about 30% are generic ("simple", "more moving parts"). The non-blocking ask is to do a pass over the generic ones and either tighten or drop them.

## Verdict

**Revise (light)**.

The report is well-structured and the five-axis framing is genuinely useful. The exploration is real, not pro-forma. The user can take this report and write a proposal from it without significant additional foundation work.

However, three of six user-requested creative-direction probes are missing (registry / Nix / distrobox), the cleanup story is under-weighted, the bundles include some near-duplicates, and the recommendation posture contradicts itself. None of these are individually fatal but together they justify a single revision pass before the report is treated as the canonical exploration document.

The blocking issues are all additive — adding axis F, bundles P7/P8, options C5/C6, and a cleanup-by-bundle table. No existing content needs to be removed.

## Action Items

1. **[blocking]** Add **Axis F: Distribution scope** with options F1 (host-local, current), F2 (user-shared), F3 (team registry), F4 (community/public registry). This addresses the registry creative-direction probe.
2. **[blocking]** Add **Option B5: Local registry sidecar** to Axis B. Describe the long-running-process tradeoff and natural pairing with axis F.
3. **[blocking]** Add **Option C5: Nix-style content-addressed store** to Axis C. Frame as "unit of caching is post-install filesystem state, not OCI layer."
4. **[blocking]** Add **Bundle P7: Registry-backed shared cache** (A3 + B5 + C1 + D1 + E2 + F3). The team-collaboration design point currently missing.
5. **[blocking]** Sharpen P1 vs. P6 distinction or merge them. P6 should commit to "no `lace.local/*` namespace at all" to differentiate.
6. **[blocking]** Expand **Cleanup ownership** cross-cutting subsection into a table mapping each bundle to a cleanup model (user-driven prune, `lace cache prune`, automatic LRU, etc.) and the disk-pressure UX.
7. **[blocking]** Add a **Failure-mode UX** subsection to cross-cutting considerations. For each bundle, name the new failure modes and required diagnostics.
8. **[non-blocking]** Add **Option C6: Distrobox / toolbx-style** to Axis C, or add a NOTE-style explicit out-of-scope rationale. Currently invisible.
9. **[non-blocking]** Add **Option A6: Image digest references, no `lace.local/*` rewrite** to Axis A. Different migration shape than A5.
10. **[non-blocking]** Under D3, add a paragraph listing alternative slicing axes (by stability, by trust boundary, by cost asymmetry, by failure mode). Address user's "is D3 the right cut" probe directly.
11. **[non-blocking]** Add a "user-visible state in `podman images`" column or table to the bundles section. Makes P2 vs. P3 vivid.
12. **[non-blocking]** Add forced-pair couplings paragraph to end of axes section (C2 -> B2 or registry, D2+C4 = no prebuild, E4 requires A2/A3).
13. **[non-blocking]** Either drop "Recommendation Posture" or own the soft recommendation explicitly. Current middle ground reads as having-it-both-ways.
14. **[non-blocking]** Pass over generic pros/cons ("simple", "more moving parts") and tighten or drop. Specifically C1 pro, A3 con, D2 con need numbers or operational claims.
15. **[non-blocking]** Soften D3 pro language: "matches reality" -> "matches the project's existing direction with `lace-fundamentals-init`."
16. **[non-blocking]** Reference the 2026-01-31 smart-prebuild-cache-busting RFP from Axis A3's canonicalisation discussion. Explicit prior-art link.
17. **[non-blocking]** Add an open question on team-vs-solo audience and another on the prebuild/up phase relationship.
18. **[non-blocking]** Anchor or remove the "100-500 ms" estimate in E3.
19. **[non-blocking]** Add a NOTE-callout on the third devcontainer CLI option: contributing upstream (e.g., `devcontainer build --layer-per-feature`).
20. **[non-blocking]** Tighten the BLUF parenthetical "(especially 'where features install')" — it's an implicit recommendation; either own it or drop the lean.

## Questions for the User (Multi-Choice)

The proposer's eventual answer depends on context the report can't access. Surface these as multi-choice rather than block on them:

1. **Audience scope.** Lace is best understood as:
   - (a) Single-developer tool. Sharing is coincidence; cleanup is per-laptop. Drives P1/P2/P3.
   - (b) Single-developer tool with multi-project users (current author profile). Sharing matters within one user's workspace. Drives P2/P3.
   - (c) Team tool. Multiple developers share base images. Drives P7 (registry-backed) and axis F.
   - (d) Open-source tool with community ecosystem. Public feature-combo registry is plausible. Drives F4.

2. **Tolerance for non-OCI primitives.** The report mostly stays inside OCI/devcontainer-spec primitives. Willingness to leave them:
   - (a) Stay inside OCI/devcontainer. C5 (Nix-style) is out.
   - (b) OCI artefacts ok, custom layer assembly ok. C2/C3 are in.
   - (c) Open to non-OCI stores (Nix, content-addressed directories). C5 is in.
   - (d) Open to non-image-based models entirely (distrobox-style persistent containers). C6 is in.

3. **Cleanup ownership stance.**
   - (a) User owns cleanup via existing `podman image prune`. Lace doesn't manage state.
   - (b) Lace owns a cache directory under `~/.cache/lace/`. `lace cache prune` is a thing.
   - (c) Cleanup is automatic (LRU with size budget). User shouldn't think about it.

4. **Shipping cadence.**
   - (a) Ship the smallest fix that closes the incident this week (P0).
   - (b) Ship a proper redesign over 2-4 weeks (P2 or P3).
   - (c) Defer; this is structural work for a quiet quarter (P4 or P5).

The answer to (1) most strongly drives axis F and bundle P7; (2) drives axes C and B; (3) drives the cross-cutting cleanup table; (4) drives lens selection.
