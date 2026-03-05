---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T12:00:00-05:00
type: report
state: live
status: review_ready
tags: [lace-init, devcontainer-templates, developer-experience]
---

# Lace Init and Templates Research

> BLUF: Lace should provide a `lace init` command that scaffolds a working `.devcontainer/devcontainer.json` with lace customizations, removing the current barrier of manually assembling GHCR feature references, mount declarations, workspace layout configs, and prebuild feature blocks. The devcontainer spec's template mechanism (OCI-distributed tarballs with `devcontainer templates apply`) is a viable distribution channel but is overkill for initial implementation -- a built-in scaffolder that generates config from project detection and user defaults is faster to ship and more aligned with lace's wrapper-CLI model. The recommended path is: (1) ship `lace init` with built-in templates, (2) optionally publish to GHCR later for non-lace users, (3) support user-defined default overrides via `~/.config/lace/defaults.json`.

## Context / Background

Currently, using lace on a new project requires manually creating `.devcontainer/devcontainer.json` with the correct structure, including:

- A base image or Dockerfile reference
- `customizations.lace.prebuildFeatures` with full GHCR references to features like `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`
- `customizations.lace.workspace` configuration for bare-worktree layouts
- `customizations.lace.mounts` for persistent state (bash history, Claude config)
- `customizations.lace.validate.fileExists` for host-side SSH key checks
- Feature option values (e.g., wezterm version strings)
- Environment variables referencing `${lace.mount(...).target}` template syntax

This is a significant onboarding barrier. The lace devcontainer for lace itself (`/var/home/mjr/code/weft/lace/main/.devcontainer/devcontainer.json`) is 66 lines of JSONC with comments. A user who just wants "a devcontainer with Claude Code and WezTerm access" should not need to understand mount declarations, prebuild features, or GHCR namespaces.

The `/home/mjr/code/weft/clauthier` project illustrates this: it is a Claude Code plugin marketplace with no `.devcontainer` directory. It is a normal git clone (not bare-worktree), has no `package.json` at root (plugins live under `plugins/`), and would benefit from a simple devcontainer with Claude Code and a terminal multiplexer for development.

## Key Findings

### 1. The Devcontainer Templates Spec

The [devcontainer templates specification](https://containers.dev/implementors/templates/) defines a packaging and distribution mechanism for devcontainer configurations:

- **Structure**: A template is a directory containing `devcontainer-template.json` (metadata) and `.devcontainer/devcontainer.json` (config), plus optional files (Dockerfiles, scripts, boilerplate).
- **Options**: Templates declare user-configurable options in `devcontainer-template.json` with types, defaults, proposals/enums. Placeholders like `${templateOption:optionId}` are replaced at apply time.
- **Distribution**: Templates are packaged as OCI artifacts (tarballs with media type `application/vnd.devcontainers.layer.v1+tar`) and pushed to GHCR or other OCI registries.
- **Consumption**: `devcontainer templates apply --template-id ghcr.io/namespace/template:version --template-args '{"key":"value"}'` copies files into the workspace, substituting option values.
- **Publishing**: The [devcontainers/template-starter](https://github.com/devcontainers/template-starter) repo provides a GitHub Actions workflow (`devcontainers/action@v1`) that publishes templates to GHCR, identical to how lace already publishes features.

Lace already has the CI infrastructure for OCI publishing (`devcontainers/features/` uses `devcontainers/action@v1` with `publish-features: "true"`). Publishing templates would require adding a `devcontainers/templates/` directory with the same action configured for `publish-templates: "true"`.

### 2. How Other Tools Handle Init

**`devcontainer templates apply`** (official):
- Pure file-copy with variable substitution. No project detection, no inference.
- User must know the template ID and provide all option values.
- Suitable for IDE integrations (VS Code "Add Dev Container Configuration Files..." uses this).
- Does not handle lace-specific customizations.

**`docker init`** (Docker Desktop):
- Interactive prompts: detects project language, asks about version, package manager, ports.
- Generates Dockerfile, .dockerignore, compose.yaml.
- Template-based but with project detection logic built in.
- Overwrites existing files with confirmation.

**`nix flake init`** (Nix):
- File-copy from a template flake (local or remote).
- `nix flake init -t templates#rust` copies a Rust template.
- No project detection. User selects the template.
- Templates are just directories in a flake's `templates` output.
- Simple, composable, no magic.

**Key pattern**: The most useful init commands combine detection (what kind of project is this?) with sensible defaults (what does a good config look like for this project type?) while allowing explicit template selection for users who know what they want.

### 3. What a Default Lace Devcontainer Should Include

Based on lace's current feature set and the patterns established in the lace devcontainer itself:

**Base image**: `mcr.microsoft.com/devcontainers/base:bookworm` is the safest default. It includes common utilities, a non-root user (`vscode`), and is maintained by Microsoft. For Node projects specifically, `node:24-bookworm` is appropriate but requires more project detection. The base image is the most project-dependent choice.

**Core features** (should be in every lace devcontainer):
- `ghcr.io/devcontainers/features/git:1` -- git is universally needed
- `ghcr.io/devcontainers/features/sshd:1` -- required by wezterm-server
- `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1` -- terminal multiplexing (the defining lace feature)
- `ghcr.io/weftwiseink/devcontainer-features/claude-code:1` -- Claude Code CLI

**Optional features** (profile-dependent):
- `ghcr.io/weftwiseink/devcontainer-features/neovim:1` -- for terminal-native editing
- `ghcr.io/devcontainers-extra/features/neovim-homebrew:1` -- alternative neovim install
- `ghcr.io/eitsupi/devcontainer-features/nushell:0` -- alternative shell
- Language-specific features (node, python, rust, go, etc.)

**Mounts** (should be offered with guidance):
- `bash-history` -- command persistence across rebuilds
- `claude-config` via the claude-code feature's mount declaration -- Claude credentials and session state
- `authorized-keys` via the wezterm-server feature's mount declaration -- SSH public key for WezTerm access

**Workspace layout**:
- Auto-detected: if the project is a bare-worktree, include `customizations.lace.workspace.layout: "bare-worktree"`.
- For normal clones: omit workspace config entirely (devcontainer defaults work).

### 4. What `lace init` Should Look Like

The command should operate in two modes:

**Non-interactive (default for agents/CI)**:
```bash
lace init                          # Detect project, apply defaults
lace init --profile minimal        # Minimal: just claude-code + sshd
lace init --profile node           # Node.js project defaults
lace init --image node:24-bookworm # Override base image
lace init --no-prebuild            # Use features directly, no prebuild layer
```

**Interactive (when stdin is a TTY)**:
```bash
lace init --interactive
# Detected: Node.js project (package.json found)
# Detected: bare-worktree layout
# Base image: node:24-bookworm [enter to accept, or type override]
# Include neovim? [Y/n]
# Include nushell? [y/N]
# Writing .devcontainer/devcontainer.json...
# Writing .devcontainer/Dockerfile...
```

**What it should infer vs. ask**:

| Decision | Infer | Ask |
|----------|-------|-----|
| Workspace layout (bare-worktree vs normal) | Yes (filesystem detection) | No |
| Base image | Yes (from package.json, Cargo.toml, etc.) | Override only |
| Core features (git, sshd, wezterm, claude) | Yes (always include) | No |
| Neovim | Default yes, allow opt-out | Interactive only |
| Language-specific features | Yes (from project detection) | Confirm |
| Mount declarations | Yes (standard set) | No |
| Dockerfile vs image-only | Infer (prefer Dockerfile for prebuild) | No |

### 5. User-Defined Defaults

Users should be able to customize what `lace init` generates without editing each project's config after the fact. Three mechanisms, in order of priority:

**A. `~/.config/lace/defaults.json`** (recommended primary mechanism):
```jsonc
{
  // Override base image for all new projects
  "image": "node:24-bookworm",
  // Always include these features
  "features": {
    "ghcr.io/eitsupi/devcontainer-features/nushell:0": {}
  },
  // Always include these mounts
  "mounts": {
    "bash-history": {
      "target": "/commandhistory"
    }
  },
  // Default username for Dockerfile generation
  "username": "node",
  // Default prebuild: true means features go into prebuildFeatures
  "prebuild": true
}
```

This integrates naturally with the existing `~/.config/lace/settings.json` (which handles mount source overrides). The two files have distinct concerns: `settings.json` maps per-machine paths, `defaults.json` defines per-user preferences for new project scaffolding.

**B. `~/.config/lace/template/`** (for power users):
A directory containing a complete `.devcontainer/` skeleton that `lace init` copies and then augments with detected settings. This is the "nix flake init" model -- pure file copy with optional post-processing.

**C. Profile system** (for teams):
Named profiles (`minimal`, `node`, `python`, `full`) that bundle a set of features, base images, and Dockerfile snippets. Profiles could be:
- Built-in to lace (shipped in the CLI)
- User-defined in `~/.config/lace/profiles/`
- Published to GHCR as devcontainer templates (for team-wide sharing)

### 6. The Clauthier Testbed

`/home/mjr/code/weft/clauthier` is instructive as a "what would init produce?" exercise:

- **Project type**: Claude Code plugin marketplace (JavaScript/Node adjacent, but no package.json at root)
- **Git layout**: Normal clone (`.git` is a directory, not a worktree)
- **Language signals**: No package.json, no Cargo.toml, no go.mod -- it is primarily Markdown and plugin configuration files
- **What it needs**: A basic devcontainer with Claude Code for plugin development and testing. Neovim and WezTerm for terminal access. No build toolchain needed.

A good `lace init` for clauthier would produce:

```jsonc
{
  "name": "clauthier",
  "image": "mcr.microsoft.com/devcontainers/base:bookworm",
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/devcontainers/features/sshd:1": {},
        "ghcr.io/anthropics/devcontainer-features/claude-code:1": {},
        "ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1": {
          "version": "20240203-110809-5046fc22"
        }
      },
      "mounts": {
        "bash-history": {
          "target": "/commandhistory",
          "description": "Bash command history persistence"
        },
        "claude-config": {
          "target": "/home/vscode/.claude",
          "recommendedSource": "~/.claude",
          "description": "Claude Code configuration and credentials"
        }
      }
    }
  },
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "${lace.mount(project/claude-config).target}"
  }
}
```

Note: this is image-based (no Dockerfile) because clauthier has no build dependencies to prebuild. The `prebuildFeatures` still work with image-based configs -- lace will generate a temporary Dockerfile from the image for the prebuild layer.

### 7. Publishing Lace Templates to GHCR

Lace could publish devcontainer templates alongside its features. The infrastructure is already in place:

- The `devcontainers/action@v1` GitHub Action supports `publish-templates: "true"` with `base-path-to-templates`.
- Templates would live at `devcontainers/templates/src/` (parallel to `devcontainers/features/src/`).
- Published to `ghcr.io/weftwiseink/devcontainer-templates/<template-id>`.
- Consumable by anyone: `devcontainer templates apply --template-id ghcr.io/weftwiseink/devcontainer-templates/lace-base:latest`.

This is valuable for two reasons:
1. Non-lace users can bootstrap a lace-compatible devcontainer without installing the lace CLI.
2. VS Code's "Add Dev Container Configuration Files..." UI can discover and apply published templates.

However, published templates have a limitation: `${templateOption:...}` substitution is simple string replacement, with no conditional logic. A template cannot conditionally include sections based on project detection. The template would need to be opinionated (include everything) or publish multiple variants (`lace-minimal`, `lace-node`, `lace-python`).

## Architecture Implications

### Where Init Fits in Lace's CLI

The current command structure is:
```
lace
  prebuild       # Build feature layer into Docker image
  resolve-mounts # Resolve repo mount paths
  restore        # Restore Dockerfile after prebuild
  status         # Show prebuild state
  up             # Full pipeline: validate -> prebuild -> resolve -> generate -> devcontainer up
```

`lace init` would be a new top-level command that runs *before* `lace up`, producing the `.devcontainer/` directory that `lace up` consumes. It is conceptually separate from the up pipeline.

```
lace
  init           # NEW: scaffold .devcontainer/ from detection + defaults
  prebuild
  resolve-mounts
  restore
  status
  up
```

### Init Should Not Require Lace's Dependencies

`lace init` should work without Docker, devcontainer CLI, or any running container. It is purely a file-generation command. It reads the filesystem for project detection, reads `~/.config/lace/` for user defaults, and writes `.devcontainer/devcontainer.json` (and optionally a `Dockerfile`).

### Relationship to `devcontainer templates apply`

These are complementary, not competing:
- `lace init` is the **opinionated** path: it knows about lace's features, mount declarations, workspace layouts, and prebuild conventions. It generates lace-specific config.
- `devcontainer templates apply` is the **standard** path: it works for any devcontainer user, does not require the lace CLI, and integrates with VS Code. Published lace templates provide a starting point that users can customize.

A user could use either path, or both (apply a published template, then `lace init --augment` to add lace-specific customizations on top).

### Dockerfile Generation

The current lace devcontainer uses a Dockerfile for prebuild. For `lace init`, the question is whether to generate a Dockerfile or use an image-only config:

- **Image-only** (`"image": "mcr.microsoft.com/devcontainers/base:bookworm"`): Simpler, no Dockerfile to maintain. Features handle all customization. Works for most projects.
- **Dockerfile**: Required for prebuild optimization (baking features into the image layer). Also needed for project-specific system dependencies (apt packages, build tools).

Recommendation: `lace init` should generate image-only config by default, with a `--dockerfile` flag (or auto-detection of complex projects) that creates a Dockerfile skeleton. The Dockerfile should be minimal -- just a FROM line and comments showing where to add customizations.

## Recommended Next Steps

1. **Implement `lace init` as a built-in command** with project detection (check for package.json, Cargo.toml, go.mod, pyproject.toml, etc.) and sensible defaults. Start with image-based configs only.

2. **Define a `~/.config/lace/defaults.json` schema** for user-level preferences. Keep it simple: image override, extra features, extra mounts, username.

3. **Ship 3-4 built-in profiles**: `minimal` (claude + sshd only), `base` (+ wezterm + git), `node` (+ node feature + appropriate base image), `full` (everything including neovim, nushell). Profiles are just named bundles of settings, not separate template files.

4. **Publish GHCR templates as a follow-up** once the built-in init command stabilizes. The published templates would be snapshots of what `lace init --profile X` generates, useful for non-lace users or VS Code discovery.

5. **Use clauthier as the first test case**: run `lace init` on clauthier, verify the output, iterate. Clauthier is a good test because it is a simple project with no language-specific build requirements.

6. **Consider a `lace init --from` flag** that copies from a user-defined template directory (`~/.config/lace/template/`) for users who want full control over the generated skeleton.

## Sources

- [Dev Container Templates Specification](https://containers.dev/implementors/templates/)
- [Dev Container Templates Distribution and Discovery](https://containers.dev/implementors/templates-distribution/)
- [devcontainers/template-starter](https://github.com/devcontainers/template-starter) -- reference implementation for custom template publishing
- [devcontainers/templates](https://github.com/devcontainers/templates) -- official template repository
- [docker init Documentation](https://docs.docker.com/reference/cli/docker/init/) -- Docker's project init approach
- [nix flake init Reference](https://nix.dev/manual/nix/2.18/command-ref/new-cli/nix3-flake-init) -- Nix's template copy approach
- [Templates Overview and Authoring (DeepWiki)](https://deepwiki.com/devcontainers/spec/4.1-templates-overview-and-authoring)
