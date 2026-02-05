---
review_of: cdocs/proposals/2026-02-04-lace-plugins-system.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T21:00:00-08:00
task_list: lace/plugins-system
type: review
state: archived
status: done
tags: [fresh_agent, architecture, plugins, cli_integration, test_plan]
---

# Review: Lace Plugins System (Round 1)

## Summary Assessment

This proposal successfully evolves the dev dependency concept into a comprehensive plugins system. The core architecture is sound: git repo identifiers with subdirectory support, explicit aliases for conflict resolution, consolidated settings.json, and symlink bridging for custom targets. The rename from "devDependencies" to "plugins" better reflects the feature's scope. The test plan is thorough and implementation phases are well-sequenced.

However, several areas need clarification before implementation:
1. The shallow clone update strategy needs specification
2. Symlink creation timing and mechanism needs detail
3. The `$project` derivation for clone paths is underspecified

**Verdict: Revise** -- addressable issues, solid foundation.

## Section-by-Section Findings

### BLUF and Objective

**Assessment: Strong**

The BLUF clearly articulates all key changes from the previous proposal:
- Rename to plugins
- Subdirectory format in repo identifiers
- Alias field for conflicts
- settings.json consolidation
- Missing plugins as errors
- Symlink bridging for target overrides
- Shallow clone behavior

The objective correctly identifies the four-layer separation of concerns.

### Background

**Assessment: Good**

The evolution from dev dependencies is well-documented. The link to the superseded proposal and research is helpful. The motivating use cases cover the expected scenarios.

**Minor**: The WezTerm integration use case mentions "host-side setup (SSH keys, mux server)" but this proposal explicitly defers that to an RFP. Should clarify that this proposal handles the mount, not the setup.

### Proposed Solution: Layer 1 (Project-Level Declaration)

**Assessment: Good with minor clarifications needed**

The plugin declaration format is clean:
```jsonc
"github.com/user/claude-plugins/plugins/my-plugin": {}
```

The subdirectory-in-identifier approach is well-justified in the design decisions report.

**Clarification needed**: The proposal shows `alias` as the only option field. Should empty object `{}` be required, or can it be omitted entirely? Example:
```jsonc
// Option A: Empty object
"github.com/user/dotfiles": {},
// Option B: No value (just presence)
"github.com/user/dotfiles": null,
// Option C: Omit entirely? Not possible with object syntax
```

The schema shows `PluginOptions` with only `alias?`. If a plugin needs no options, `{}` is the only valid value. This is fine but worth documenting explicitly.

### Proposed Solution: Layer 2 (User-Level Configuration)

**Assessment: Good**

The settings.json structure is well-designed:
- Clear `overrideMount` nested object
- Sensible defaults (readonly: true)
- Optional target with symlink behavior

**Clarification needed**: The discovery order mentions `LACE_SETTINGS` environment variable. Should this point to a file path or directory? Given the name, file path makes sense, but should be explicit.

### Proposed Solution: Layer 3 (Plugin Resolution and Mounting)

**Assessment: Needs more detail (blocking)**

This section has the most underspecification.

#### Shallow Clone Mechanics

The proposal says:
> "Uses `git clone --depth 1` for efficiency"

Questions:
1. Which branch is cloned? Default branch? Main? Master?
2. What remote URL format? HTTPS? SSH? Depends on user's git config?

The proposal also says:
> "`lace resolve-mounts` updates the clone (`git fetch --depth 1 && git reset --hard origin/HEAD`)"

Questions:
1. What if the user has local changes in the clone? (Shouldn't happen if readonly, but could if something goes wrong)
2. What if fetch fails (network issue)? Skip update and use cached? Error?
3. Is `origin/HEAD` always correct? Some repos use `origin/main`, `origin/master`, etc.

**Recommendation**: Specify:
- Clone uses HTTPS URL derived from repo identifier (e.g., `https://github.com/user/repo.git`)
- Fetch origin's default branch (whatever HEAD points to)
- If fetch fails on existing clone, warn and continue with cached version
- If clone fails on new plugin, error

#### Symlink Creation

The proposal says:
> "If `target` is specified, lace creates a symlink in the container"

Questions:
1. When is the symlink created? Part of mount injection? postCreateCommand?
2. What if the symlink already exists? Recreate? Error?
3. What if the symlink target's parent directories don't exist?

The edge cases section (E6) addresses parent directories but not creation timing.

**Recommendation**: Add a "Symlink Creation Mechanism" subsection specifying:
- Symlinks are created via an injected postCreateCommand
- Existing symlinks are removed and recreated
- Parent directories are created as needed (mkdir -p)

#### $project Derivation

The proposal mentions:
> "Shallow clone to `~/.config/lace/$project/plugins/$name_or_alias`"
> "`$project` is derived from the workspace folder name"

Questions:
1. What exactly is "workspace folder name"? The directory name? Full path hash?
2. What if two projects have the same name in different locations?
3. Is this the devcontainer workspace folder or the git root?

**Recommendation**: Specify exact derivation:
- `$project` is the basename of the `--workspace-folder` argument (or auto-detected workspace)
- If collision risk is a concern, include a path hash: `$project-$hash`
- Document that this means same-named projects share plugin clones (or don't, depending on design)

### Lace CLI Commands

**Assessment: Good**

The `lace resolve-mounts` command is well-specified with clear error conditions. The output format is comprehensive.

**Non-blocking**: The output format shows `"errors": []` but the behavior section says errors abort. Should the file even be written if there are errors? Probably not -- the array may be for warnings that don't abort.

### Schema Definitions

**Assessment: Good**

TypeScript definitions are clear and match the examples.

### Design Decisions

**Assessment: Strong**

All eight decisions (D1-D8) are well-reasoned with clear rationale. The detailed design decisions report provides additional depth.

### Edge Cases

**Assessment: Comprehensive**

Nine edge cases cover the expected failure modes:
- E1: Clone fails (error)
- E2: Override source missing (error)
- E3: Name conflict (error with guidance)
- E4: Subdirectory missing (error)
- E5: settings.json missing (proceed with clones)
- E6: Symlink parent missing (create directories)
- E7: Windows (partial support)
- E8: Circular references (non-issue)
- E9: Large repos (subdirectory mitigation)

**Non-blocking**: E7 (Windows) could be scoped out entirely per the prebuild proposal precedent, rather than defining partial behavior.

### Test Plan

**Assessment: Thorough**

Test tables cover:
- Settings parsing
- Plugin extraction
- Name derivation
- Mount resolution
- Integration tests for resolve-mounts
- Integration tests for lace up

**Minor gap**: No explicit test for symlink creation/behavior.

### Implementation Phases

**Assessment: Clear progression**

Seven phases from settings parsing through documentation. Dependencies between phases are implicit but logical.

**Non-blocking**: Phase 3 (Clone Management) and Phase 4 (Mount Resolution) could potentially be done in parallel by different contributors, but the current linear sequence is fine for a single implementer.

### Future Work (RFPs)

**Assessment: Appropriate scope**

The two RFPs (`when` field and host setup) correctly defer complex features to future work. Links to the RFP documents are helpful.

### Open Questions

**Assessment: Appropriate**

Four open questions identify genuine uncertainties that don't block the core implementation:
1. Sparse checkout (complex, defer)
2. Version pinning (useful but not v1)
3. Clone cache sharing (tradeoff decision)
4. Plugin discovery (ecosystem question)

## Verdict

**Revise**

The proposal is solid and addresses the evolution requirements well. The blocking issues are:
1. Shallow clone mechanics (branch, URL format, update failure handling)
2. Symlink creation mechanism (timing, idempotency)
3. $project derivation specification

These are clarifications, not architectural changes.

## Action Items

1. **[blocking]** Specify shallow clone behavior: URL format (HTTPS from identifier), branch (default/HEAD), update failure handling (warn and continue with cache)

2. **[blocking]** Specify symlink creation: postCreateCommand injection, idempotent (remove and recreate), parent directory creation

3. **[blocking]** Specify $project derivation: Exact algorithm for deriving from workspace folder, collision handling

4. **[non-blocking]** Clarify whether empty object `{}` is required for plugins with no options, or document as the only valid "no options" format

5. **[non-blocking]** Clarify LACE_SETTINGS env var: file path expected

6. **[non-blocking]** Consider scoping out Windows entirely (per prebuild proposal precedent)

7. **[non-blocking]** Add symlink behavior to test plan

8. **[non-blocking]** Clarify .lace/resolved-mounts.json `errors` field semantics (probably "warnings that didn't abort")
