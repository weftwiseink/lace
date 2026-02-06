---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T23:45:00-08:00
type: report
state: live
status: review_ready
tags: [analysis, architecture, plugins, devcontainer-features, extensibility]
---

# Plugin Architecture Analysis: Devcontainer Features as the Extensibility Mechanism

> **BLUF:** The devcontainer feature spec already provides most of what lace needs for an extensible plugin system -- mounts, env vars, lifecycle hooks, typed options, and OCI distribution. Rather than inventing a parallel "managed plugin" concept, lace should lean into features as the plugin unit and limit its own role to host-side orchestration that features cannot do: git-repo cloning, dynamic port assignment, and template variable resolution via `customizations.lace`. This reframes lace's "plugins" as what they actually are -- **mounted repos** -- and positions devcontainer features as the mechanism for bundling environment config like wezterm server setup or Claude Code access.

## Context / Background

### What prompted this report

The mount-enabled plugin workstream produced a proposal for adding Claude Code access to lace containers. During review, the concept of a "managed plugin" -- a built-in plugin that generates mounts, env vars, and devcontainer features without a git repo -- was identified as architecturally suspect. The core objection: it's not really a plugin, it's a hardcoded feature of lace dressed up in plugin vocabulary.

The broader goal is an extensible plugin system that can bundle entangled devcontainer config (a wezterm plugin needs both a feature *and* a port mapping; a Claude plugin needs a feature *and* mounts *and* env vars *and* lifecycle commands). The question: what's the right extensibility mechanism?

### User direction (verbatim)

> "the plugin system I was imagining was effectively a `(devcontainerJson) => devcontainerJson` transform, but I'm not sure that kind of under-the-covers processing makes sense with our setup"

> "looking deeper at the devcontainer feature spec, it seems to me it has most of what we want. We could use the lace customizations to do the templating"

> "I do want the plugin system to be extensible. That's why I don't want to implement wezterm or claude features directly in lace, I want them to be provided as plugins."

### What lace's plugin system does today

The current system has two unrelated mechanisms sharing the "plugin" name:

**1. Git-repo mounts** (`customizations.lace.plugins`): Declared as `github.com/user/repo` keys. Lace clones the repo (or uses a local override from `~/.config/lace/settings.json`), generates a `type=bind,source=...,target=/mnt/lace/plugins/<name>` mount spec, and merges it into the extended config. Plugins can have aliases for name conflict resolution. Mounts are readonly by default. This is purely a mounting system -- plugins cannot declare env vars, features, lifecycle commands, or port mappings.

**2. Port auto-assignment** for wezterm SSH: Hardcoded in `runUp`. Scans ports 22425-22499, assigns the first available, writes to `appPort` in the extended config. Not a plugin -- just a built-in feature of `lace up`.

Both feed into `generateExtendedConfig`, which reads the original `devcontainer.json`, applies transforms (add mounts, symlink commands, port mappings), writes `.lace/devcontainer.json`, and passes it to `devcontainer up --config`.

## Key Findings

### What devcontainer features provide

The feature spec (`containers.dev/implementors/features/`) defines a self-contained unit of environment configuration with:

| Capability | Mechanism | Notes |
|-----------|-----------|-------|
| Tool installation | `install.sh` (runs as root during build) | Separate Docker layer per feature |
| Environment variables | `containerEnv`, `remoteEnv` | Static (build-time) and dynamic (attach-time) |
| Mounts | `mounts` array (Docker `--mount` syntax) | Supports `${devcontainerId}` substitution |
| Lifecycle hooks | `onCreateCommand`, `postCreateCommand`, `postStartCommand`, `postAttachCommand` | All formats: string, array, object |
| Port forwarding | `forwardPorts`, `portsAttributes` | Port numbers or `host:container` pairs |
| Typed options | `options` map with `string`/`boolean` types | Passed to `install.sh` as uppercased env vars |
| Dependencies | `dependsOn` (hard), `installsAfter` (soft) | Topological sort with cycle detection |
| Distribution | OCI registries (ghcr.io, etc.) | Semver tagging, collection metadata |
| Composition | Merge rules for all properties | Feature hooks run before user-defined hooks |

Features can also set `privileged`, `init`, `capAdd`, `securityOpt`, and `entrypoint`.

### What features cannot do

| Gap | Why it matters |
|-----|---------------|
| No `initializeCommand` (host-side) | Can't clone repos, check host state, or assign ports before container starts |
| No `appPort` | Can set `forwardPorts` but not the raw Docker port mapping lace uses |
| No `workspaceMount` / `workspaceFolder` | Can't control how the workspace is mounted |
| No `runArgs` | Can't pass arbitrary Docker flags |
| No dynamic config | Declarations are static -- no "assign an available port" logic |
| Limited templating | Only `${devcontainerId}` in mounts/entrypoint, no general variable system |
| Option types limited to `string`/`boolean` | No arrays, objects, or paths |

### The delta: what lace still needs to handle

Features cover container-side concerns well. The gap is **host-side orchestration**:

1. **Git-repo cloning and local overrides** -- features can't run on the host before the container exists
2. **Dynamic port assignment** -- features declare static port forwards; lace needs to scan for available ports
3. **Template variable resolution** -- bridging host-side dynamic values into feature declarations (e.g., injecting the assigned port into a feature's env var)
4. **Host path resolution** -- mounts need host paths that vary per machine (e.g., `~/.claude/`)

This is a small, well-defined surface area. Everything else -- env vars, lifecycle hooks, tool installation, mount declarations, option schemas -- can live in the feature spec.

## Analysis

### Reframing the architecture

Instead of lace having its own plugin system that duplicates feature capabilities, the architecture should be:

```
devcontainer.json
├── customizations.lace.repos     ← git-repo mounts (renamed from "plugins")
│   └── lace handles: clone, override, mount generation
├── customizations.lace.features  ← lace-managed feature declarations with templating
│   └── lace handles: variable resolution, then passes to devcontainer CLI
└── features                      ← standard devcontainer features (untouched)
    └── devcontainer CLI handles everything
```

A **wezterm server plugin** would be a devcontainer feature (`ghcr.io/weftwiseink/devcontainer-features/wezterm-server`) that declares its `install.sh`, `postStartCommand`, `containerEnv`, etc. The lace-specific part -- dynamic port assignment -- would be handled via `customizations.lace.features` templating:

```jsonc
{
  "customizations": {
    "lace": {
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          "port": "${lace.local.openPort()}"
        }
      }
    }
  }
}
```

Lace resolves `${lace.local.openPort()}` to `22430` (or whatever is available), then writes the feature declaration with the concrete value into `.lace/devcontainer.json`. The feature's `install.sh` and lifecycle hooks handle everything container-side.

Similarly, a **Claude access setup** could be a feature that declares its own mounts, env vars, and lifecycle hooks. The lace-specific part -- resolving the host `~/.claude/` path, forwarding the API key -- would use lace template variables:

```jsonc
{
  "customizations": {
    "lace": {
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/claude-code:1": {
          "hostClaudeDir": "${lace.local.home}/.claude",
          "containerUser": "${lace.container.username}"
        }
      }
    }
  }
}
```

### Template variable system

The user proposed variables like `${lace.local.openPort()}`, `${lace.container.username}`, and `${input.version}`. A minimal but useful set:

| Variable | Resolves to | Source |
|----------|------------|--------|
| `${lace.local.openPort()}` | Available port in 22425-22499 | Host TCP scan |
| `${lace.local.home}` | Host home directory | `os.homedir()` |
| `${lace.local.workspaceFolder}` | Host workspace path | `process.cwd()` or `--workspace-folder` |
| `${lace.container.username}` | Container remote user | `remoteUser` / `containerUser` / `root` |
| `${lace.container.home}` | Container user home | Derived from username |
| `${lace.container.workspaceFolder}` | Container workspace path | `raw.workspaceFolder` or default |

These would be resolved by lace before writing `.lace/devcontainer.json`. The `${localEnv:...}` and `${containerEnv:...}` syntax from the devcontainer spec would pass through unmodified (they're resolved by the devcontainer CLI at a later stage).

### What features can own vs. what lace templates

Consider the wezterm server case. The feature (`devcontainer-feature.json`) would declare:

```jsonc
{
  "id": "wezterm-server",
  "version": "1.0.0",
  "options": {
    "version": { "type": "string", "default": "latest" },
    "port": { "type": "string", "default": "2222" }
  },
  "containerEnv": {
    "WEZTERM_SSH_PORT": "${containerEnv:WEZTERM_SSH_PORT}"
  },
  "postStartCommand": "wezterm-server start --port ${WEZTERM_SSH_PORT:-2222}",
  "forwardPorts": ["${WEZTERM_SSH_PORT:-2222}"]
}
```

But `forwardPorts` in a feature is static -- it can't use the dynamically assigned port. This is where lace's templating fills the gap. The feature handles installation and startup; lace handles port assignment and writes the concrete port into the feature's options *and* into `appPort`.

### Terminology reconsideration

The current terminology conflates two distinct concepts:

| Current term | What it actually is | Suggested term |
|-------------|-------------------|---------------|
| "plugin" (`customizations.lace.plugins`) | A git repo mounted into the container | **repo mount** or **mounted repo** |
| "managed plugin" (proposed) | A hardcoded config transform in lace | (eliminate -- use features instead) |
| "plugin system" | Mount resolution + config generation | **lace orchestration** |

The word "plugin" implies behavioral extensibility -- code that runs and changes things. Git-repo mounts are data, not behavior. Devcontainer features are the actual behavioral extensibility mechanism.

Proposed schema:

```jsonc
{
  "customizations": {
    "lace": {
      // Git repos to clone and mount (currently "plugins")
      "repos": {
        "github.com/user/dotfiles": {},
        "github.com/user/utils": { "alias": "my-utils" }
      },
      // Features with lace-specific templating
      "features": {
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          "port": "${lace.local.openPort()}"
        }
      }
    }
  }
}
```

Standard `features` (top-level in devcontainer.json) remain untouched -- those are handled entirely by the devcontainer CLI. `customizations.lace.features` is the subset that needs lace's template resolution before being merged into the extended config.

### How to get feature metadata idiomatically

For lace to understand what a feature provides (its options schema, mounts, env vars), it needs to read the feature's `devcontainer-feature.json`. There are three idiomatic approaches, from lightest to heaviest:

**1. OCI manifest annotation (no download required)**

Every published feature stores its full `devcontainer-feature.json` as a `dev.containers.metadata` annotation on the OCI manifest. Lace can read this with a single registry API call:

```bash
# Using oras (OCI registry client)
oras manifest fetch ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1 \
  | jq -r '.annotations["dev.containers.metadata"]' \
  | jq .
```

Or via the registry HTTP API directly:

```bash
# Get token
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:weftwiseink/devcontainer-features/wezterm-server:pull" | jq -r .token)
# Fetch manifest
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.manifest.v1+json" \
  "https://ghcr.io/v2/weftwiseink/devcontainer-features/wezterm-server/manifests/1"
```

This is fast (~100ms) and requires no disk I/O. Good for validation and option schema discovery.

**2. Collection metadata (batch discovery)**

Each feature namespace publishes a `devcontainer-collection.json` at the `latest` tag, aggregating metadata for all features in the collection. One fetch gives you the full catalog:

```bash
oras manifest fetch ghcr.io/weftwiseink/devcontainer-features:latest
```

This is useful for tooling that needs to enumerate available features or present option UIs.

**3. Tarball extraction (full access)**

Download and extract the feature tarball to get `devcontainer-feature.json`, `install.sh`, and all supporting files. The devcontainer CLI already does this during `devcontainer up`. Lace could cache extracted features alongside its repo clones in `~/.config/lace/<project>/features/`.

```bash
oras pull ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1
```

**Recommendation:** Use approach 1 (manifest annotation) for metadata inspection during `lace up` -- it's fast and doesn't require downloading the feature. Use approach 3 only if lace needs to inspect `install.sh` or other files (unlikely). The `devcontainer` CLI handles actual feature installation during `devcontainer up`.

**Practical concern:** For locally-developed features (referenced by path, e.g., `./features/wezterm-server`), the metadata is just `devcontainer-feature.json` in that directory. No registry fetch needed.

### What lace's role becomes

With features as the extensibility unit, lace's responsibilities narrow to:

1. **Repo mount orchestration** -- clone repos, resolve overrides, generate mount specs (existing capability, renamed)
2. **Template variable resolution** -- resolve `${lace.*}` variables in `customizations.lace.features`, write concrete values into `.lace/devcontainer.json`
3. **Feature promotion** -- move resolved features from `customizations.lace.features` into the top-level `features` object of the extended config (so the devcontainer CLI processes them normally)
4. **Port management** -- the `${lace.local.openPort()}` function, plus writing the port to `appPort`
5. **Config assembly** -- the existing `generateExtendedConfig` role, now with features folded in

Everything else -- tool installation, env vars, lifecycle hooks, mount declarations -- lives in the feature spec and is handled by the devcontainer CLI.

## Themes of Lace's Value-Add

Lace's contributions to the devcontainer ecosystem fall into three categories. Any future extensibility mechanism -- whether devcontainer features, lace-templated features, or repo mounts -- should serve one of these themes.

### 1. Performance improvement via prebuilds

Pre-building feature layers into cached images (`lace.local/*`) moves expensive tool installations out of container startup. This is a build-time optimization that the devcontainer spec has no native answer for -- features always install fresh on each `devcontainer up` unless the image layer is cached. Lace's prebuild system makes the cache explicit and project-scoped.

> NOTE: Lace's prebuild mechanism fills a genuine gap for local, non-CI prebuild workflows, but it does so by building a parallel caching and rewrite system that is neither idiomatic nor composable with the spec's own mechanisms. The devcontainer CLI's `devcontainer build --image-name` is designed for CI pipelines that push images to registries; it has no concept of a local prebuild cache with incremental skip logic. Lace's approach of rewriting Dockerfile `FROM` lines to point at `lace.local/` images is clever host-side orchestration that the spec cannot express. However, the approach carries real cost: it mutates the Dockerfile in-place (requiring `lace restore` to undo), introduces a proprietary metadata layer (`.lace/prebuild/`), and makes the devcontainer.json non-portable -- anyone without lace sees a broken `FROM` reference. The spec does support `build.cacheFrom` for pulling cached layers from registries, and Docker's own layer caching means that features which have not changed will not be reinstalled on subsequent builds. The value is real for workflows where network pulls are slow or CI is not available, but the idiom is fragile. If the devcontainer CLI ever gains a `--cache-to local` flag or the spec adds a first-class `prebuildFeatures` concept, lace's implementation becomes technical debt. A more durable approach would be to produce and tag local images without rewriting source files, using `build.cacheFrom` pointed at the local tag.

### 2. Cross-project devcontainer coordination via repoMounts

Making git repos available inside containers -- for dotfiles, local tool mirrors, peer project dependencies -- is a host-side concern that features cannot address. Features run inside the container after it exists; repo cloning and local path resolution must happen before the container starts. The `customizations.lace.plugins` system (being renamed to `repoMounts`) handles this: shallow-clone repos on the host, resolve user-level local overrides from `settings.json`, and generate bind-mount specs for the extended config.

> NOTE: The repo-mount system is where lace adds the most unambiguous value relative to the devcontainer spec. The spec's `mounts` property is static -- you write a host path and a container path, and that is it. The spec's `initializeCommand` runs on the host before the container starts, so a user could theoretically write a `git clone` there and a static `mounts` entry pointing at the clone destination. But this falls apart immediately in practice: there is no override system for swapping a remote clone with a local working copy during development, no conflict detection across mount names, no alias resolution, no automatic symlink generation inside the container, and no per-user settings file to vary behavior by machine. Every user would have to reinvent this multi-step host-plus-container coordination workflow from scratch. The spec intentionally does not address "provision a dependency repo and mount it" as a unit of work. Lace's approach is genuinely non-redundant here. The one caveat the report correctly identifies: the "plugin" terminology is misleading, since these are mounted repos (data), not behavioral plugins (code). The mechanism is sound; the naming creates false expectations about what the system does.

### 3. Build/runtime automation affordances

Eliminating manual configuration and action-at-a-distance between the host and container. Concrete examples:

- **Automatic port discovery** for wezterm SSH: scanning 22425-22499 and injecting the assigned port into `appPort`, so multiple containers coexist without manual port allocation.
- **Runtime user detection** for mount targeting: querying the container's actual user (via `docker inspect`) so mounts land in the right home directory without hardcoding usernames.
- **Session bridge path encoding**: deriving workspace paths and project IDs from the host filesystem so the container's tooling (wezterm domains, SSH config) connects to the right place automatically.

These affordances share a pattern: they resolve dynamic, host-dependent values at orchestration time and inject them into the static devcontainer config. This is the core gap that lace's template variable system (`${lace.local.*}`, `${lace.container.*}`) is designed to fill.

> NOTE: This theme is the most nuanced mix of redundancy and genuine gap. For port forwarding: the spec's `forwardPorts` is the idiomatic way to expose container ports, and the spec itself says `appPort` is effectively superseded by `forwardPorts`. But `forwardPorts` is static -- you declare port 2222 and the tooling forwards it, but you cannot express "find me an unused port in a range and use that." Lace's dynamic port assignment genuinely cannot be expressed in the spec, and multi-container setups with wezterm SSH servers on different projects require exactly this kind of host-side port arbitration. The `appPort` usage in lace is non-idiomatic (the spec recommends `forwardPorts` and requires `0.0.0.0` binding for `appPort`), but the dynamic assignment logic that feeds it is irreplaceable. For user detection: the devcontainer features spec provides `_REMOTE_USER`, `_REMOTE_USER_HOME`, `_CONTAINER_USER`, and `_CONTAINER_USER_HOME` as environment variables inside feature `install.sh` scripts at build time. This means a wezterm-server feature can already use `_REMOTE_USER` in its install script to set up per-user configuration without any lace templating. Lace's proposed `${lace.container.username}` template variable is partially redundant with what features get natively inside the container. The gap is narrower than the report suggests: lace only needs user detection for host-side decisions (like the lace.wezterm plugin's domain re-registration, where the host needs to know which username to embed in the SSH connection URI). The report should draw a sharper line between container-side user detection (already solved by the spec) and host-side user detection (the actual gap lace fills).

## Recommendations

1. **Adopt devcontainer features as the behavioral plugin unit.** Don't build a parallel plugin system. The feature spec covers env vars, mounts, lifecycle hooks, options, and distribution. Lace adds host-side orchestration on top.

2. **Rename `customizations.lace.plugins` to `customizations.lace.repos`** (or `mounts`). These are repo mounts, not plugins. The rename clarifies what they are and frees "plugin" terminology for actual extensibility.

3. **Add `customizations.lace.features`** as the lace-templated feature section. Features declared here get template variable resolution before being merged into the extended config's top-level `features`. Features declared in the standard `features` section pass through untouched.

4. **Implement a minimal template variable system** (`${lace.local.*}`, `${lace.container.*}`) for host-side dynamic values that features can't resolve on their own.

5. **Use OCI manifest annotations** to fetch feature metadata when needed (option validation, schema discovery). Don't download tarballs -- let the devcontainer CLI handle installation.

6. **Deprecate the mount-enabled plugin workstream's "managed plugin" framing.** The Claude access work is still valid -- it just needs to be restructured as a devcontainer feature with lace templating, not as a hardcoded transform in lace's codebase.

7. **Evaluate the detailed implementation proposals** (`2026-02-05-lace-claude-access-detailed-implementation.md` and `2026-02-05-lace-mount-enabled-claude-plugin.md`) for what can be preserved. The `generateExtendedConfig` extension work (features/env/postStartCommand merging) remains useful -- that's the "feature promotion" mechanism. The `claude-access.ts` module becomes the content of a devcontainer feature rather than lace-internal code.
