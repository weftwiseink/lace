# Architecture Overview

Lace is a devcontainer orchestration CLI that preprocesses your
`devcontainer.json` into a fully resolved config, then delegates to the
standard `devcontainer` CLI for container creation. Understanding this
pipeline is the key to understanding everything lace does.

## The pipeline model

When you run `lace up`, your source `devcontainer.json` flows through a
series of transformation phases. Each phase reads the config (and possibly
external state like OCI registries, settings files, or the filesystem),
mutates or enriches the config, and passes it forward. The final output is
`.lace/devcontainer.json` -- a standard devcontainer config with all lace
template expressions resolved to concrete values.

```
.devcontainer/devcontainer.json   (your source config)
        |
        v
  +-------------------+
  | Workspace Layout  |  Detect bare-worktree, set workspaceMount/Folder
  +-------------------+
        |
        v
  +-------------------+
  | Host Validation   |  fileExists checks, pre-flight assertions
  +-------------------+
        |
        v
  +-------------------+
  | Feature Metadata  |  Fetch devcontainer-feature.json from OCI
  | (OCI Registry)    |  registries, validate options + port decls
  +-------------------+
        |
        v
  +-------------------+
  | Auto-Injection    |  Inject ${lace.port()} and ${lace.mount()}
  |                   |  templates from declarations into config
  +-------------------+
        |
        v
  +-------------------+
  | Mount Validation  |  Namespace checks, target conflict detection,
  |                   |  sourceMustBe type validation, deduplication
  +-------------------+
        |
        v
  +-------------------+
  | Template          |  Resolve all ${lace.port()} and ${lace.mount()}
  | Resolution        |  to concrete port numbers and mount specs
  +-------------------+
        |
        v
  +-------------------+
  | Prebuilds         |  Bake slow features into cached local images
  | (if configured)   |  (lace.local/* Docker images)
  +-------------------+
        |
        v
  +-------------------+
  | Repo Mounts       |  Clone/update repos, generate bind-mount specs
  | (if configured)   |
  +-------------------+
        |
        v
  +-------------------+
  | Config Generation |  Merge resolved config + port entries + mounts
  |                   |  + symlinks + project name into final config
  +-------------------+
        |
        v
  .lace/devcontainer.json   (generated, gitignored)
        |
        v
  devcontainer up           (standard CLI takes over)
```

The key insight: lace does not replace the devcontainer CLI. It
preprocesses your config into a standard one that the devcontainer CLI
consumes unchanged. Everything lace adds -- port allocations, mount
resolution, prebuild images -- is expressed in standard devcontainer.json
fields.

## Layer-to-step mapping

The README documents 14 pipeline steps for `lace up`. Here is how those
steps map to the conceptual layers above. Step numbers reference the
numbered list in the [README's `lace up` section](../README.md#lace-up).

| Conceptual Layer        | README Steps | Key Operations |
|-------------------------|-------------|----------------|
| Workspace Layout        | 1           | Detect bare-worktree layout, auto-set `workspaceMount`/`workspaceFolder`/`postCreateCommand` |
| Host Validation         | 2           | `fileExists` checks against host filesystem |
| Feature Metadata (OCI)  | 3           | Fetch `devcontainer-feature.json` from registries, validate feature options and port declarations |
| Auto-Injection          | 4-5         | Inject `${lace.port()}` and `${lace.mount()}` templates from declarations; deduplicate static mounts |
| Mount Validation        | 6-7         | Validate mount namespaces, target conflicts, `sourceMustBe` type checks |
| Template Resolution     | 8-10        | Resolve all templates to concrete values; allocate ports; resolve mount paths; emit guidance |
| Prebuilds               | 11          | Build features into cached local images, rewrite Dockerfile FROM / image field |
| Repo Mounts             | 12          | Clone/update repos, generate bind-mount specs and symlink commands |
| Config Generation       | 13          | Generate `.lace/devcontainer.json` with all resolved values |
| devcontainer up         | 14          | Invoke the standard CLI with the generated config |

## Dependency flow between layers

Later phases depend on earlier ones. This is why the ordering matters:

- **Feature Metadata** must run before **Auto-Injection** because
  auto-injection reads port and mount declarations from feature metadata.
- **Auto-Injection** must run before **Template Resolution** because it
  injects the `${lace.port()}` and `${lace.mount()}` expressions that
  template resolution then resolves.
- **Mount Validation** runs between auto-injection and template resolution
  to catch configuration errors (unknown namespaces, conflicting targets)
  before allocating resources.
- **Template Resolution** must run before **Config Generation** because the
  generated config needs concrete port numbers and mount paths, not
  template expressions.
- **Prebuilds** run after template resolution because the prebuild pipeline
  needs the resolved config to determine the base image. Note that
  `${lace.port()}` expressions in `prebuildFeatures` are NOT resolved --
  prebuild features use their default option values.

## Worked example: port resolution flow

Starting with this source config:

```jsonc
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      // no explicit port value -- lace will auto-inject
    }
  }
}
```

Assuming the sshd feature's `devcontainer-feature.json` declares:
```jsonc
{
  "id": "sshd",
  "options": { "port": { "type": "string", "default": "2222" } },
  "customizations": { "lace": { "ports": { "port": { "label": "SSH" } } } }
}
```

**Step 1 -- Feature Metadata:** Lace fetches the feature's OCI manifest
and extracts the `customizations.lace.ports` declaration. It learns that
`sshd` has a port option called `port` with label "SSH".

**Step 2 -- Auto-Injection:** The user has not set an explicit value for
the `port` option, so lace injects:
```jsonc
"ghcr.io/devcontainers/features/sshd:1": {
  "port": "${lace.port(sshd/port)}"
}
```

**Step 3 -- Template Resolution:** The `${lace.port(sshd/port)}` expression
is the entire string value (a "full match"), so lace resolves it to an
integer. The port allocator checks `.lace/port-assignments.json` for an
existing assignment, or allocates a new port from the 22425-22499 range
(e.g., 22430). The config becomes:
```jsonc
"ghcr.io/devcontainers/features/sshd:1": {
  "port": 22430
}
```

**Step 4 -- Config Generation:** Lace auto-generates `appPort`,
`forwardPorts`, and `portsAttributes` entries for port 22430:
```jsonc
{
  "appPort": ["22430:22430"],
  "forwardPorts": [22430],
  "portsAttributes": { "22430": { "label": "SSH (lace)", "requireLocalPort": true } }
}
```

User-provided entries in any of these fields suppress the corresponding
auto-generated entry.

## Worked example: mount resolution flow

Starting with this source config:

```jsonc
{
  "features": {
    "ghcr.io/example/wezterm-server:1": {}
  },
  "customizations": {
    "lace": {
      "mounts": {
        "bash-history": {
          "target": "/commandhistory",
          "description": "Bash command history persistence"
        }
      }
    }
  }
}
```

Assuming the wezterm-server feature's metadata declares:
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "authorized-keys": {
          "target": "/home/node/.ssh/authorized_keys",
          "recommendedSource": "~/.ssh/id_ed25519.pub",
          "sourceMustBe": "file",
          "hint": "Run: ssh-keygen -t ed25519"
        }
      }
    }
  }
}
```

**Step 1 -- Feature Metadata:** Lace fetches the feature's OCI manifest
and extracts the `customizations.lace.mounts` declaration for
`wezterm-server/authorized-keys`.

**Step 2 -- Auto-Injection:** Both `project/bash-history` (from the
project config) and `wezterm-server/authorized-keys` (from feature
metadata) are auto-injected into the `mounts` array:
```jsonc
"mounts": [
  "${lace.mount(project/bash-history)}",
  "${lace.mount(wezterm-server/authorized-keys)}"
]
```

**Step 3 -- Mount Validation:** Lace validates that:
- `project` is a valid namespace (reserved for project-level mounts)
- `wezterm-server` matches a feature short ID in the config
- No two declarations share the same container target path
- The `wezterm-server/authorized-keys` mount has `sourceMustBe: "file"`,
  so lace checks that `~/.ssh/id_ed25519.pub` exists and is a file

**Step 4 -- Template Resolution:** For `project/bash-history`, lace
resolves the source from settings or the default path
(`~/.config/lace/<projectId>/mounts/project/bash-history`). For
`wezterm-server/authorized-keys`, the `recommendedSource` is used since
`sourceMustBe` is set. The config becomes:
```jsonc
"mounts": [
  "source=/home/user/.config/lace/myproject/mounts/project/bash-history,target=/commandhistory,type=bind",
  "source=/home/user/.ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind"
]
```

**Step 5 -- Guided Configuration:** Lace prints guidance for mounts using
default paths, showing the user how to configure custom source paths via
`~/.config/lace/settings.json`.

## Settings and state files

Lace reads from and writes to three locations:

### Per-project: `.lace/` (gitignored)

Generated artifacts specific to one workspace:

- `devcontainer.json` -- the generated config passed to `devcontainer up`
- `port-assignments.json` -- persisted port allocations (reused across runs)
- `mount-assignments.json` -- persisted mount path assignments
- `resolved-mounts.json` -- resolved repo mount specs
- `prebuild.lock` -- flock(1) exclusion file
- `prebuild/` -- temp build context, metadata, cached Dockerfile

### User-level: `~/.config/lace/`

User settings and cached data shared across projects:

- `settings.json` -- mount source overrides and repo mount overrides (JSONC)
- `cache/features/` -- OCI feature metadata cache (24h TTL for floating tags, permanent for pinned)
- `<projectId>/repos/` -- shallow git clones for repo mounts
- `<projectId>/mounts/` -- default mount source directories

### Docker daemon

- `lace.local/*` images -- local-only prebuild images, never pushed to a registry

For the complete file layout, see the [User-level data](../README.md#user-level-data)
section of the README. For hardcoded defaults (port range, cache TTL, mount prefix),
see the [Hardcoded defaults](../README.md#hardcoded-defaults) table.
