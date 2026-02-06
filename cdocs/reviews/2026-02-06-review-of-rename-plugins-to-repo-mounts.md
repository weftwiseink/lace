---
review_of: cdocs/proposals/2026-02-06-rename-plugins-to-repo-mounts.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T10:15:00-08:00
task_list: lace/rename-plugins-to-repo-mounts
type: review
state: live
status: done
tags: [self, refactor, naming, completeness-check]
---

# Review: Rename Plugins to Repo Mounts

## Summary Assessment

The proposal is a thorough, well-organized rename plan with an accurate file-by-file change list covering source, tests, fixtures, and documentation. The motivation from the analysis report is sound and clearly articulated. There are three blocking issues: (1) the BLUF inaccurately says `overrideMounts` when the actual field in settings.json is `plugins` (top-level) with `overrideMount` (singular, nested) -- this creates confusion about what is actually being renamed; (2) the `settings.json` rename from `plugins` to `overrides` is under-specified as a generic name that may collide with future override concepts; (3) the `overview_and_quickstart.md` file at the repo root also references plugin terminology and is missing from the change list. Verdict: **Revise**.

## Section-by-Section Findings

### BLUF

**[blocking]** The BLUF states "rename the `overrideMounts` field in settings.json." The actual field name in the codebase is `overrideMount` (singular), nested under `plugins` at the top level of settings.json. The BLUF should accurately describe what is being renamed: the top-level `plugins` key in settings.json becomes `overrides`, and the nested `overrideMount` field becomes `mount`.

**[non-blocking]** The BLUF is 3 sentences, which is within the 2-4 target. The structure is clear: what changes, where it changes, and why.

### Schema Changes (Proposed Solution)

**[blocking]** The settings.json rename from the top-level `plugins` to `overrides` is too generic. The settings file is lace-specific today, but the `overrides` key provides no hint about *what* is being overridden. If lace later adds override support for other configuration (e.g., feature options, port ranges), `overrides` becomes ambiguous. Consider `repoMountOverrides` or keep `repoMounts` as the top-level key in settings.json for consistency with devcontainer.json, with `localMount` or `mount` as the nested field. The decision section argues that the settings file is lace-specific so there is no ambiguity, but that reasoning ignores future settings expansion within lace itself.

**[non-blocking]** The `overrideMount` to `mount` rename inside the overrides section is well-reasoned. The redundancy elimination is a genuine improvement.

### File-by-File Change List

**[blocking]** The file `overview_and_quickstart.md` at the repo root contains plugin references (based on the grep results showing it matched `plugin`). It is absent from the change list. The proposal should either include it or explicitly note it as out of scope.

**[non-blocking]** The change list for `resolve-mounts.ts` (the lib module, not the command) is missing the `plugins` local variable (line 102: `const plugins = pluginsResult.plugins`) and the `pluginCount` variable (line 103). These are internal variables and will naturally be caught during implementation, but the proposal's thoroughness standard would benefit from including them.

**[non-blocking]** The proposal does not mention `bin/open-lace-workspace` or `bin/wez-lace-into`, both of which matched the "plugin" grep. These may contain references that need updating, or they may be referencing the lace.wezterm plugin (a separate concern). The proposal should clarify whether these are in scope.

### Important Design Decisions

**[non-blocking]** The "no backward compatibility shim" decision is well-justified. The observation that there are no external consumers is correct -- lace is not published as a library with these interfaces in its public API.

**[non-blocking]** The decision to use `repoMounts` over `repos` or `mounts` is sound and well-argued.

### Edge Cases

**[non-blocking]** The existing clone directories edge case is handled appropriately. Shallow clones are cheap to re-create.

**[non-blocking]** The cdocs document policy is correct -- historical documents should not be rewritten.

### Test Plan

**[non-blocking]** The test plan is minimal but appropriate for a pure rename. Since no behavior changes, verifying the existing tests pass with new names is sufficient. The grep verification in Phase 3 is a good completeness check.

### Implementation Phases

**[non-blocking]** The five-phase breakdown is logical but, as the final NOTE acknowledges, these must be executed atomically. The phases are better understood as a dependency-ordered checklist within a single commit rather than separable work units.

## Verdict

**Revise.** Three blocking issues need resolution before acceptance:

1. Fix the BLUF's inaccurate `overrideMounts` reference.
2. Reconsider the `overrides` naming for the settings.json top-level key -- either use `repoMounts` for consistency or justify why `overrides` is future-proof.
3. Add `overview_and_quickstart.md` to the change list or explicitly scope it out.

## Action Items

1. [blocking] Fix BLUF: replace `overrideMounts` with accurate description of what is renamed (`plugins` top-level key becomes `overrides`, `overrideMount` nested field becomes `mount`).
2. [blocking] Reconsider settings.json top-level key name. `overrides` is generic and may conflict with future settings. Evaluate `repoMounts` (consistent with devcontainer.json) or `repoMountOverrides` as alternatives.
3. [blocking] Add `overview_and_quickstart.md` to the file change list or explicitly note it as out of scope with reasoning.
4. [non-blocking] Add `plugins`/`pluginCount` local variables in `resolve-mounts.ts` to the change list for completeness.
5. [non-blocking] Clarify whether `bin/open-lace-workspace` and `bin/wez-lace-into` contain plugin references that need updating, or whether those references are about the lace.wezterm plugin (separate project).
