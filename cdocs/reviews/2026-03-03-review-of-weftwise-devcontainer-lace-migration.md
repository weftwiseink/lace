---
review_of: cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-03T14:00:00-08:00
task_list: lace/weftwise-migration
type: review
state: live
status: done
tags: [fresh_agent, architecture, migration, prerequisite_tracking, mount_portability, incremental_rollout]
---

# Review: Migrate Weftwise Devcontainer to Lace Idioms

## Summary Assessment

This proposal defines a seven-phase incremental migration of weftwise's manually-configured devcontainer setup to lace's declarative abstractions. The document is thorough, well-structured, and demonstrates deep familiarity with both the weftwise codebase and every relevant lace subsystem. It correctly maps each manual weftwise configuration to its lace equivalent, with verified references to actual source files. The most significant concern is that the proposal underspecifies the prerequisites that do not yet exist (claude-code and neovim features, GHCR publication pipeline) and does not provide a timeline or dependency graph that would let a reader assess when end-to-end migration is realistically achievable. Verdict: **Revise** -- the core migration plan is sound but needs sharper prerequisite tracking and several clarifications before it can serve as an actionable migration guide.

## Section-by-Section Findings

### BLUF

The BLUF is comprehensive -- arguably too comprehensive. At 12 lines with nested parenthetical lists, it reads more like an abstract than a BLUF. The purpose of BLUF is to let a reader decide in 2-3 sentences whether to read further.

- **[non-blocking]** The BLUF should be tightened to 3-4 sentences covering: what is being migrated, why, and the key constraint (incremental, seven phases). The detailed subsystem mapping belongs in the Background section, which already covers it well.

### Objective

Clear and well-scoped. The five goals are concrete, measurable, and each maps to a specific deficiency in the current setup. No issues.

### Background: Weftwise Current State

Accurate and well-organized. The Dockerfile line-count breakdown (186 lines, ~60 replaceable) was verified against the proposal's target Dockerfile, which retains the project-specific lines. The categorization of what stays vs. what migrates is correct.

- **[non-blocking]** The weftwise Dockerfile and devcontainer.json files are described in the proposal but not included in the lace repo itself. A reader without access to the weftwise repo cannot independently verify the line numbers and content. Consider adding a footnote that the weftwise files are in a separate repository and these references are as of a specific commit or date.

### Background: Lace Capabilities Used

The mapping table is accurate. All seven source files referenced in the "Key Source File" column exist in the lace repo and implement the described functionality. Verified:

- `port-allocator.ts` -- uses 22425-22499 range, persists to `.lace/port-assignments.json`, has `allocate()` with conflict detection. Matches the proposal.
- `workspace-layout.ts` -- `applyWorkspaceLayout()` handles bare-worktree detection, `workspaceMount`/`workspaceFolder` generation, `postCreateCommand` injection, and VS Code settings merge. Matches.
- `workspace-detector.ts` -- `classifyWorkspace()` reads `.git` file, follows `gitdir:` pointer, identifies bare repo root. Matches.
- `host-validator.ts` -- `runHostValidation()` with `fileExists` checks, `--skip-validation` downgrade. Matches.
- `prebuild.ts` -- `runPrebuild()` with `contextsChanged()` caching, `devcontainer build` shell-out, Dockerfile `FROM` rewriting. Matches.
- `template-resolver.ts` -- `${lace.port()}` and `${lace.mount.source()}` patterns. Matches.
- `wezterm-server` feature -- `install.sh` is near-identical to the quoted weftwise Dockerfile excerpt. `devcontainer-feature.json` declares `installsAfter` for sshd, `hostSshPort` option, and `customizations.lace.mounts.authorized-keys`. Matches.

### Exact Duplication Section

The side-by-side code comparison between the weftwise Dockerfile and the lace feature's `install.sh` is compelling and accurate. This section provides strong justification for the migration. No issues.

### Target devcontainer.json

The proposed target config is well-structured. Several observations:

- **[blocking]** The `wezterm-server` feature appears in `customizations.lace.prebuildFeatures` (line 197) but NOT in the top-level `features` section. Yet in Phase 2, the proposal says to add it to `features` (line 449: `"ghcr.io/weftwiseink/lace/wezterm-server:1": {}`). The target config and Phase 2 are inconsistent -- the target shows it only in `prebuildFeatures`, but Phase 6 says moving it there is "optional." The target should either include it in both places or clearly document that the final state has it only in `prebuildFeatures`. The note on line 621 acknowledges this ambiguity but does not resolve it for the target config.

- **[non-blocking]** The `features` section retains `ghcr.io/devcontainers/features/sshd:1` but the sshd feature is needed for WezTerm SSH domain functionality. If wezterm-server moves entirely to `prebuildFeatures`, sshd should likely move there too (or remain in `features` with wezterm-server). The interaction between prebuilt and runtime features for interdependent tools like sshd+wezterm deserves a note.

- **[non-blocking]** The SSH key mount from the wezterm-server feature targets `/home/node/.ssh/authorized_keys` (hardcoded in `devcontainer-feature.json` line 35). This path assumes the container user is `node`. If another project uses a different user (e.g., `vscode`), the feature's mount target would be wrong. This is a known limitation of the feature, not the proposal, but worth noting since the proposal positions this as a reusable pattern.

### Target Dockerfile

Clean and well-commented. The `# REMOVED:` comments are helpful for migration tracking. The git-delta installation remains inline, which is consistent with Open Question 2.

### Design Decisions

All six decisions are well-reasoned and follow the "decision / why" format consistently.

- **[non-blocking]** The "Incremental Migration, Not Big Bang" decision claims phases can be adopted "in any order," but this is not strictly true. Phase 7 (lace up as entry point) depends on having lace CLI installed (a Phase 1 constraint). Phase 6 (prebuilds) requires new feature packages that do not yet exist. Phase 3 (port allocation) depends on Phase 2 (wezterm-server feature) being present for the `hostSshPort` metadata. The statement should say "phases are designed to be adoptable independently where possible" rather than "in any order."

### Edge Cases

Comprehensive coverage. The build context path rewriting claim references `up.ts` lines 660-679. The actual code spans lines 657-686 (the build.context rewriting is at lines 681-686, slightly beyond the cited range). This is a minor inaccuracy.

- **[blocking]** The "Multiple Worktrees With Different Containers Running" edge case states that `wez-into` "already reads port assignments." This should be verified -- does the `wez-into` CLI actually read `.lace/port-assignments.json`? If it reads from a different mechanism (e.g., `wezterm cli list` or a config file), the migration steps for host WezTerm config updates may be incomplete.

### Implementation Phases

The phases are well-structured with clear goals, file lists, changes, and verification steps.

**Phase 1 (Workspace Layout):**
- **[blocking]** The constraint says "This phase requires `lace up` to be available on the host." This is a significant prerequisite that is not captured anywhere as a dependency. How is lace CLI installed? Is it published to npm? Is there a `pnpm add -g @weftwiseink/lace`? The proposal should specify the lace CLI installation prerequisite and link to documentation or a setup guide.

**Phase 2 (wezterm-server Feature):**
- The phase correctly handles Dockerfile removals and `postStartCommand` replacement.
- **[non-blocking]** The verification step "Verify `/usr/local/share/wezterm-server/wezterm.lua` exists" is good. Consider also verifying the entrypoint script exists and is executable.

**Phase 3 (Port Allocation):**
- **[non-blocking]** The phase says lace's template resolver "auto-injects `${lace.port(wezterm-server/hostSshPort)}`." This auto-injection mechanism should be referenced more precisely -- it happens in `autoInjectPortTemplates()` in `template-resolver.ts`. A reader unfamiliar with the codebase would benefit from knowing where to look if the auto-injection does not fire as expected.

**Phase 4 (Mount Declarations):**
- **[blocking]** The phase says "Without settings, verify lace uses recommended source paths and validates they exist." But the constraint says "Team members must create `~/.config/lace/settings.json` before the first `lace up` after migration, or mounts will resolve to lace-managed default paths (empty directories)." These two statements create confusion about default behavior. Does lace use `recommendedSource` as the default when no settings override exists? Or does it use its own managed path under `~/.config/lace/<projectId>/mounts/`? The `MountPathResolver` in `mount-resolver.ts` derives defaults under `~/.config/lace/<projectId>/mounts/<namespace>/<label>`, not from `recommendedSource`. The proposal should clarify that `recommendedSource` is documentation/guidance, not a runtime default, and that without settings overrides the mounts will resolve to empty lace-managed directories.

**Phase 5 (Host Validation):**
- Clean and purely additive. The note about two-layer validation (fileExists in Phase 0b, sourceMustBe during template resolution) is a good architectural callout. No issues.

**Phase 6 (Prebuilds):**
- **[blocking]** The prerequisites state "Create `claude-code` devcontainer feature" and "Create `neovim` devcontainer feature." These features do not exist in the lace repo (verified: no `devcontainers/features/src/claude-code/` or `devcontainers/features/src/neovim/` directories). The proposal should either include a sub-proposal for creating these features, link to an existing proposal that covers them, or explicitly mark Phase 6 as blocked with a tracking issue reference. As written, Phase 6 is unimplementable.

- **[non-blocking]** The target `devcontainer.json` uses local path references for the not-yet-created features (`"./devcontainers/features/src/claude-code"`, `"./devcontainers/features/src/neovim"`). These paths are relative to the lace repo, not the weftwise repo. The proposal should clarify how weftwise would reference features from a different repository via local paths, or note that these would become OCI references once published.

**Phase 7 (lace up as Entry Point):**
- **[non-blocking]** The fallback note ("devcontainer up still works as a fallback using the static `.devcontainer/devcontainer.json`") is important but understated. After Phase 4, the static devcontainer.json will no longer have `mounts`, `appPort`, or `workspaceMount` declarations. Running `devcontainer up` directly would produce a container without bind mounts or port mappings. The fallback is not truly functional after Phase 4 unless the static config retains these declarations. This should be called out explicitly.

### Open Questions

All five open questions are legitimate and well-framed.

- **[non-blocking]** Open Question 3 (settings.json bootstrapping via `lace init`) is arguably more than an open question -- it is a usability blocker for team adoption. If the first `lace up` fails with a validation error about missing settings, new team members will have a poor onboarding experience. Consider promoting this from "open question" to a prerequisite for Phase 4 at minimum.

- **[non-blocking]** Open Question 4 about `CLAUDE_CONFIG_DIR` correctly identifies a coupling between the container env var and the mount target. The deferral to the mount accessor API (Phase 3 of the mount template variables proposal) is appropriate, but the related_to frontmatter should also reference `cdocs/proposals/2026-02-15-mount-accessor-api.md` (the superseding proposal for mount template variables).

## Verdict

**Revise.** The core migration plan is architecturally sound, well-researched, and correctly maps each weftwise manual configuration to its lace equivalent. The incremental phasing is appropriate for an active development environment. However, three blocking issues must be addressed before this can serve as an actionable migration guide:

1. The wezterm-server feature placement in the target config is inconsistent with Phase 2.
2. The `wez-into` port assignment claim needs verification, and the mount resolution default behavior needs clarification (Phase 4).
3. Phase 6 has unresolved hard prerequisites (claude-code and neovim features do not exist) with no tracking mechanism.

## Action Items

1. [blocking] Resolve the wezterm-server feature placement inconsistency: decide whether the target config shows it in `features`, `prebuildFeatures`, or both, and make Phases 2 and 6 consistent with that decision.
2. [blocking] Clarify Phase 4 mount resolution defaults: document that `recommendedSource` is guidance for the user when creating settings, not a runtime fallback, and that without settings overrides mounts resolve to lace-managed empty directories under `~/.config/lace/`.
3. [blocking] Verify the `wez-into` claim about reading `.lace/port-assignments.json`. If it uses a different mechanism, update the Phase 3 edge case documentation accordingly.
4. [blocking] Add a prerequisite tracking section (or table) that lists: (a) lace CLI installation method, (b) GHCR publication pipeline for wezterm-server, (c) creation of claude-code feature, (d) creation of neovim feature. Each should have a status indicator and a link to the relevant proposal or issue.
5. [non-blocking] Tighten the BLUF to 3-4 sentences. Move the detailed subsystem mapping to the Background section.
6. [non-blocking] Correct the `up.ts` line reference from "lines 660-679" to "lines 657-686" for the build context path rewriting.
7. [non-blocking] Add `cdocs/proposals/2026-02-15-mount-accessor-api.md` to the `related_to` frontmatter (it supersedes the referenced mount-template-variables proposal).
8. [non-blocking] Clarify the "phases can be adopted in any order" claim: Phases 3 depends on 2, Phase 6 depends on new feature packages, and Phase 7 depends on all prior phases.
9. [non-blocking] Address the Phase 7 fallback claim: after Phase 4, `devcontainer up` without lace will produce a container without mounts or port mappings. Document whether the static config should retain a minimal fallback or whether lace becomes mandatory after Phase 4.
10. [non-blocking] Consider promoting Open Question 3 (`lace init` for settings bootstrapping) to a prerequisite for Phase 4, given the onboarding friction it creates for team members.
