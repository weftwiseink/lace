---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:45:00-08:00
task_list: lace/plugins-system
type: report
state: live
status: done
tags: [plugins, architecture, design-decisions, lace-cli, analysis]
related_to: cdocs/proposals/2026-02-04-lace-plugins-system.md
---

# Lace Plugins System Design Decisions

> BLUF: This report documents the detailed rationale behind the lace plugins system design, comparing alternatives considered, analyzing tradeoffs, and providing context for key architectural decisions. The evolution from "devDependencies" to "plugins" reflects a broader vision for extensibility. Key decisions include using repo identifiers with embedded subdirectory paths, mandatory error handling for missing plugins, symlink bridging for custom targets, and project-scoped shallow clones for non-overridden plugins.

## Context / Background

The lace plugins system evolved from the dev dependency cross-project mounts proposal, which itself emerged from research into mounting sibling repositories inside devcontainers. The user's feedback on the original proposal indicated a desire to generalize the concept into a full plugin system.

Key inputs to this design:
1. Original dev dependency proposal and its review feedback
2. User's evolution requirements specifying naming changes, format updates, and behavioral modifications
3. Existing lace CLI patterns (prebuild, devcontainer wrapping)
4. Real-world use cases (Claude plugins, dotfiles, WezTerm integration)

## Key Findings

### Finding 1: Terminology Matters

The shift from "devDependencies" to "plugins" is not merely cosmetic. The terminology influences how developers think about and use the feature.

| Aspect | devDependencies | plugins |
|--------|-----------------|---------|
| Mental model | npm-style package deps | Extensions/add-ons |
| Implied scope | Build/dev time only | Runtime and tooling |
| Expected behavior | Resolution, versioning | Configuration, activation |
| User expectation | Automatic installation | Optional enhancement |

**Decision**: Use "plugins" to set appropriate expectations. These are not packages to be installed but configurations/tools to be mounted and made available.

### Finding 2: Subdirectory Handling Approaches

The original proposal used a `subdirectory` field:
```jsonc
"github.com/user/repo": { "subdirectory": "plugins/my-plugin" }
```

Alternative: Embed subdirectory in the identifier:
```jsonc
"github.com/user/repo/plugins/my-plugin": {}
```

**Analysis**:

| Criterion | Separate field | Embedded in identifier |
|-----------|---------------|------------------------|
| Clarity | Requires reading two fields | Single string tells the full story |
| Uniqueness | repoId alone is ambiguous for same repo | Fully unique identifier |
| Consistency | Inconsistent with bare repo usage | Consistent pattern for all cases |
| Settings mapping | Harder to match overrides | Direct key lookup |
| Error messages | "repo X, subdirectory Y" | Single "repo" in messages |

**Decision**: Embed subdirectory in the repo identifier. The format `github.com/user/repo/plugins/my-plugin` is self-documenting and creates a unique key for both declaration and override mapping.

### Finding 3: Conflict Resolution Strategies

When multiple plugins would have the same mount name (e.g., two repos both named "utils"), several strategies exist:

**Strategy A: Automatic disambiguation**
The original proposal suggested prefixing with org/user: `alice-utils`, `bob-utils`.

Pros:
- Works automatically
- No user action required

Cons:
- Non-deterministic naming (depends on declaration order or alphabetical sort)
- Hard to predict the final name
- Makes referencing plugins in scripts fragile

**Strategy B: Explicit alias (chosen)**
Require an `alias` field when conflicts exist.

Pros:
- User controls the name
- Predictable and documented
- Clear error message guides resolution

Cons:
- Requires user action
- Extra configuration

**Strategy C: Full path as default name**
Use entire repo path as name: `github-com-alice-utils`.

Pros:
- Always unique automatically

Cons:
- Very long paths
- Ugly container structure
- Still need short aliases for usability

**Decision**: Explicit alias field. The slight inconvenience of requiring user action is outweighed by predictability and clarity. Error messages make resolution easy.

### Finding 4: Missing Plugin Handling

Original proposal: Warn on missing, continue unless `required: true`.
Evolution requirement: Missing plugins are errors.

**Analysis**:

| Approach | Pros | Cons |
|----------|------|------|
| Warn and continue | Faster iteration, forgiving | Unpredictable environment, silent failures |
| Error and abort | Consistent environment, explicit | Stricter setup requirements |

The "warn and continue" approach leads to:
- Containers that work differently for different developers
- Subtle bugs when expected plugins are missing
- "Works on my machine" problems

**Decision**: Error on missing plugins. If a project declares a plugin, that plugin must be available. This ensures all developers have equivalent environments.

### Finding 5: User Override Structure

Original: `~/.config/lace/repos.json` with `repos` mapping.
```jsonc
{ "repos": { "github.com/user/repo": "/path/to/checkout" } }
```

Evolution: `~/.config/lace/settings.json` with `plugins` mapping and richer structure.
```jsonc
{
  "plugins": {
    "github.com/user/repo": {
      "overrideMount": { "source": "...", "readonly": true, "target": "..." }
    }
  }
}
```

**Benefits of the new structure**:
1. **Explicit intent**: `overrideMount` clearly indicates this is an override, not the default behavior
2. **Extensibility**: Other plugin settings can be added later (e.g., `when` conditions, host setup overrides)
3. **Consolidated config**: Single file for all lace user settings
4. **Type safety**: Clear structure for TypeScript definitions

**Decision**: Use settings.json with explicit `overrideMount` structure for clarity and extensibility.

### Finding 6: Target Override vs mirrorPath

The original proposal had `mirrorPath: true` to mount at the literal host path.

**Problem with mirrorPath**:
- Boolean flag doesn't express the actual path
- Leaky abstraction (container paths depend on host structure)
- No flexibility -- either mirror or don't

**Alternative: Explicit target field**:
```jsonc
"overrideMount": {
  "source": "~/code/plugins/my-plugin",
  "target": "/home/mjr/code/plugins/my-plugin"
}
```

**Benefits**:
- Explicit about both source and target
- Works even when host and desired container paths differ
- User has full control

**Symlink bridging**:
When target differs from default (`/mnt/lace/plugins/my-plugin`), create a symlink:
```
/mnt/lace/plugins/my-plugin -> /home/mjr/code/plugins/my-plugin
```

This allows:
- Plugin code to use the canonical default path
- Tools requiring specific paths to use those paths
- Both paths to work in-container

**Decision**: Replace mirrorPath with explicit target field plus symlink bridging.

### Finding 7: Clone Management Strategy

For plugins without overrides, lace needs to make the plugin available.

**Options**:

| Strategy | Pros | Cons |
|----------|------|------|
| Full clone | Complete history | Slow, large disk usage |
| Shallow clone | Fast, small | No history, can't checkout other commits |
| Fetch on demand | Minimal initial | Requires network at runtime |
| Git submodule | Familiar pattern | Complicates project structure |

**Decision**: Shallow clone (`git clone --depth 1`).
- Fast and efficient for "just need the files" use case
- `lace resolve-mounts` can update to latest
- Project-scoped clones prevent cross-project interference

**Clone location**: `~/.config/lace/$project/plugins/$name_or_alias`
- Project scope prevents version conflicts
- Standard XDG-compliant location
- Easy to clean up per-project

### Finding 8: Command Naming

Original: `lace resolve-deps`
Evolution: `lace resolve-mounts`

**Rationale**: The command resolves mount specifications, not dependencies. "resolve-mounts" accurately describes what the command produces -- mount configurations for devcontainer.json.

### Finding 9: Mount Path Namespace

Original: `/mnt/lace/local/dependencies/`
Evolution: `/mnt/lace/plugins/`

**Analysis**:
- `/mnt/` is the conventional location for mount points on Linux
- `lace/` namespaces lace-managed mounts
- `plugins/` is clearer than `local/dependencies/`
- Shorter path is easier to type and reference

**Decision**: `/mnt/lace/plugins/$name_or_alias`

## Analysis

### Testability Considerations

The design prioritizes testability in several ways:

1. **Deterministic naming**: Explicit aliases mean tests can predict mount paths
2. **Error on missing**: Tests can verify all plugins are properly configured
3. **Separated concerns**: Settings parsing, clone management, and mount resolution are distinct testable units
4. **Output file**: `.lace/resolved-mounts.json` can be verified by tests

### Maintainability Considerations

1. **Clear schema evolution path**: Version field in output files allows future changes
2. **Extensible settings structure**: New fields can be added without breaking existing configs
3. **Idempotent operations**: `resolve-mounts` can be run multiple times safely
4. **Explicit over implicit**: Aliases > auto-disambiguation, errors > warnings

### Security Considerations

1. **Readonly by default**: Plugins are mounted readonly unless explicitly overridden
2. **Source validation**: Override sources must exist before mounting
3. **No automatic script execution**: This proposal doesn't include host setup scripts (deferred to RFP)
4. **Clone source trust**: Shallow clones come from declared git repos; users implicitly trust these

## Recommendations

### For Implementation

1. **Start with override-only mode**: Implement settings.json parsing and mount resolution before clone management
2. **Add clone support incrementally**: Clone management is more complex; can be phased
3. **Comprehensive error messages**: Each error should include remediation steps
4. **Verbose logging option**: Help users debug plugin resolution

### For Documentation

1. **Migration guide from repos.json**: For users of the original proposal
2. **Common patterns**: Show typical plugin configurations
3. **Troubleshooting guide**: Common errors and solutions

### For Future Work

1. **Plugin discovery/sharing**: Registry of common plugins
2. **Version pinning**: Specify branch/tag/commit for reproducibility
3. **Conditional loading**: `when` field for context-aware plugin loading
4. **Host setup**: Scripts for host-side prerequisites

## Related Documents

- [Lace Plugins System](../proposals/2026-02-04-lace-plugins-system.md) - Main proposal
- [Dev Dependency Cross-Project Mounts](../proposals/2026-02-04-dev-dependency-cross-project-mounts.md) - Superseded proposal
- [Dev Dependency Mounts Research](2026-02-04-dev-dependency-mounts-research.md) - Background research
- [RFP: Plugin Conditional Loading](../proposals/2026-02-04-rfp-plugin-conditional-loading.md) - Future work
- [RFP: Plugin Host Setup](../proposals/2026-02-04-rfp-plugin-host-setup.md) - Future work
