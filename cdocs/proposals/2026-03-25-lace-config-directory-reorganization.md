---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T12:00:00-07:00
task_list: lace/config-reorg
type: proposal
state: live
status: request_for_proposal
tags: [lace, architecture, config]
---

# RFP: Lace Config Directory Reorganization

> BLUF: Lace's host-side config, state, and shared data are scattered across multiple locations with no consistent hierarchy. This proposal requests a reorganization into `~/.config/lace/shared/` for cross-container data (SSH keys, nushell history, tool caches) and `~/.config/lace/projects/<project>/` for per-project state. A cleaner structure improves discoverability, simplifies backup, and provides a foundation for future features like history persistence and shared caches.

## Objective

Define and implement a canonical directory layout for all lace-managed host-side state.
The current layout grew organically: mount data, SSH keys, caches, and project metadata live in various locations with no unifying structure.
A well-defined hierarchy makes it clear what lives where, what is safe to delete, and what should be backed up.

## Scope

The full proposal should explore:

### Proposed Layout

```
~/.config/lace/
  config.json              # user-level lace settings
  shared/                  # cross-container shared state
    ssh/                   # SSH keys for container access
    nushell/               # shared nushell history
    caches/                # tool caches (if any)
  projects/                # per-project state
    <project-name>/
      state.json           # container metadata, port assignments
      mounts/              # project-specific mount data
```

### Taxonomy Decision

- Is "shared" vs "projects" the right top-level split?
- Alternatives: "global" vs "workspace", "common" vs "local", flat structure with prefixes.
- Consider XDG compliance: should some data live under `~/.local/share/lace/` (state/data) vs `~/.config/lace/` (configuration)?

### What Goes Where

- **Shared**: SSH keys, nushell history, credential helpers, tool configs that should be identical across containers.
- **Per-project**: Container state, port allocations, mount manifests, project-specific overrides.
- **Neither (ephemeral)**: Container-internal caches, build artifacts, tmp files.

### Migration Path

- Existing installs have state in current locations.
- The proposal must define a migration strategy: automatic migration on next `lace up`, manual migration script, or graceful fallback to old paths.
- Version detection: how does lace know whether the old or new layout is in use?

### Backward Compatibility

- How long to support the old layout alongside the new one?
- Whether to emit deprecation warnings when old paths are detected.
- Impact on existing `lace.json` and `devcontainer.json` references.

## Open Questions

1. **Taxonomy**: Is "shared" vs "projects" the right mental model? Or should the split be "config" vs "state" vs "cache" (XDG-style)?

2. **XDG compliance**: Should lace follow XDG strictly (`~/.config/` for config, `~/.local/share/` for data, `~/.cache/` for caches)? Or is a single `~/.config/lace/` tree simpler and sufficient?

3. **Project identification**: What key identifies a project? Repository URL, workspace folder path, a user-defined name? This affects the `projects/<project>/` directory naming.

4. **Migration risk**: Automatic migration could break running containers. Is a "migrate on next clean start" approach safer?

5. **Backup story**: Does the new layout make it easy to answer "what do I back up?" A single `~/.config/lace/` tree is better than scattered paths, but should ephemeral state be explicitly excluded (e.g., via `.backupignore`)?
