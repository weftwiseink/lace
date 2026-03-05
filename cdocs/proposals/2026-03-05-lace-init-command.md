---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T16:00:00-06:00
task_list: lace/init
type: proposal
state: live
status: request_for_proposal
tags: [lace-init, devcontainer-templates, developer-experience, scaffolding]
related_to:
  - cdocs/reports/2026-03-05-lace-init-and-templates-research.md
  - cdocs/proposals/2026-03-05-worktree-conversion-script.md
  - cdocs/proposals/2026-02-04-prebuild-image-based-config-support.md
---

# RFP: `lace init` Command

> BLUF: `lace init` scaffolds a working `.devcontainer/devcontainer.json` with lace customizations by detecting project type and git layout, so that getting into a devcontainer does not require fiddling with per-project config details -- GHCR feature references, mount declarations, workspace layout, prebuild blocks, and container environment variables.
>
> - **Motivated by:** `cdocs/reports/2026-03-05-lace-init-and-templates-research.md`

## Objective

Setting up lace on a new project currently requires manually creating `.devcontainer/devcontainer.json` with the correct structure. The lace devcontainer for lace itself is 66 lines of JSONC with comments covering prebuild features, mount declarations, workspace layout config, template variable syntax, and container environment variables. A user who just wants "a devcontainer with Claude Code and WezTerm access" should not need to understand any of that.

`lace init` should make this a single command. It inspects the project directory, determines the right base image, features, mounts, and workspace layout, and writes a complete `.devcontainer/devcontainer.json` that `lace up` can consume immediately. No Docker, devcontainer CLI, or running container required -- it is purely a file-generation command.

## Scope

The full proposal should explore:

### Project Type Detection

Detect the project's primary language/runtime by scanning for manifest files at the workspace root:

- `package.json` / `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` -- Node.js, select `node:24-bookworm` or equivalent base image
- `Cargo.toml` / `Cargo.lock` -- Rust, select a Rust-oriented base image or add the Rust devcontainer feature
- `go.mod` / `go.sum` -- Go
- `pyproject.toml` / `requirements.txt` / `Pipfile` -- Python
- `Gemfile` -- Ruby
- No recognized manifest -- fall back to `mcr.microsoft.com/devcontainers/base:bookworm`

Detection should be best-effort and overridable. The proposal should define what happens when multiple signals are present (e.g., a repo with both `package.json` and `pyproject.toml`), and whether monorepo structures (manifests in subdirectories, not root) are addressed in phase 1 or deferred.

### Git Layout Detection

Detect whether the project uses a bare-worktree layout or a normal clone:

- If `.bare/` directory and `.git` file (not directory) exist at the parent level, or `classifyWorkspace()` returns `worktree` or `bare-root` -- generate `customizations.lace.workspace.layout: "bare-worktree"` with appropriate `mountTarget`.
- If `.git` is a directory (normal clone) -- omit workspace config entirely, letting devcontainer defaults apply.
- If not a git repository at all -- warn but proceed (the generated config will still work, just without workspace-specific optimizations).

This should reuse the existing `classifyWorkspace()` from `workspace-detector.ts` rather than reimplementing detection logic.

### Built-In Profiles

Named profiles that bundle a set of features, base images, and configuration choices:

- **`minimal`**: Claude Code + sshd only. The lightest possible lace devcontainer. Use case: AI-assisted editing in a project that already has its own build toolchain.
- **`base`**: minimal + WezTerm server + git. The standard lace experience. Use case: most projects.
- **`node`**: base + Node.js feature + appropriate base image. Use case: JavaScript/TypeScript projects.
- **`full`**: base + neovim + nushell + all optional features. Use case: the "full lace experience" for users who want everything.

Profiles are named bundles of settings, not separate template files. The proposal should define how profiles are selected (auto-detection with override, explicit `--profile` flag), how they compose with project detection (does `--profile base` on a Node project still pick a Node base image?), and whether the profile list is fixed or extensible.

### Core vs. Optional Features

Every `lace init` output should include the core feature set:

- `ghcr.io/devcontainers/features/git:1`
- `ghcr.io/devcontainers/features/sshd:1`
- `ghcr.io/weftwiseink/devcontainer-features/wezterm-server:1`
- `ghcr.io/anthropics/devcontainer-features/claude-code:1`

Optional features added by profile or detection:

- `ghcr.io/devcontainers-extra/features/neovim-homebrew:1`
- `ghcr.io/eitsupi/devcontainer-features/nushell:0`
- Language-specific features (node, python, rust, go, etc.)

The proposal should clarify where features are placed -- in top-level `features` or in `customizations.lace.prebuildFeatures` -- and what the default recommendation is for new projects.

### Standard Mounts

Every generated config should include mount declarations for:

- `bash-history` -- command persistence across rebuilds
- `claude-config` -- Claude credentials and session state (via the claude-code feature's mount declaration)

The mount target paths should be derived from the detected container username (`vscode` for base images, `node` for node images, etc.). The proposal should define how mount source paths are handled -- are they left to `~/.config/lace/settings.json` resolution at `lace up` time, or does `lace init` write recommended sources?

### User-Defined Defaults via `~/.config/lace/defaults.json`

Users should be able to customize what `lace init` generates across all projects without editing each project's config after the fact. The proposal should define:

- Schema for `defaults.json`: image overrides, extra features, extra mounts, username preference, prebuild preference.
- Precedence: how `defaults.json` merges with profile settings and project detection. Does user default override detection, or is detection always authoritative for things like base image?
- Relationship to `~/.config/lace/settings.json`: settings.json handles per-machine mount source paths, defaults.json defines per-user preferences for new project scaffolding. These are distinct concerns and should remain separate files.
- Whether a `~/.config/lace/template/` directory (complete `.devcontainer/` skeleton) should be supported as a power-user escape hatch.

### Handling Existing `.devcontainer/`

What happens when `.devcontainer/devcontainer.json` already exists:

- **Refuse** (safest): error with "`.devcontainer/devcontainer.json` already exists. Use `--force` to overwrite or `--augment` to merge lace customizations."
- **Merge/augment**: add `customizations.lace` sections to an existing config without overwriting user settings. Complex and error-prone with JSONC comments.
- **Backup and overwrite**: rename existing to `.devcontainer/devcontainer.json.bak` and write fresh. Simple but lossy.

The proposal should recommend a default behavior and define what `--force` and any other conflict-resolution flags do.

### Interactive vs. Non-Interactive Mode

Two operating modes:

**Non-interactive** (default, suitable for agents and CI):
```bash
lace init                          # Detect project, apply defaults
lace init --profile minimal        # Explicit profile
lace init --profile node           # Node.js defaults
lace init --image node:24-bookworm # Override base image
lace init --no-prebuild            # Features in top-level, not prebuildFeatures
```

**Interactive** (when `--interactive` is passed or stdin is a TTY with no profile specified):
```bash
lace init --interactive
# Detected: Node.js project (package.json found)
# Detected: bare-worktree layout
# Base image: node:24-bookworm [enter to accept, or type override]
# Include neovim? [Y/n]
# Include nushell? [y/N]
# Writing .devcontainer/devcontainer.json...
```

The proposal should define which decisions are inferred vs. prompted, and how the interactive experience degrades gracefully when detection is ambiguous.

### Dockerfile Generation

The current lace devcontainer uses a Dockerfile for prebuild. The proposal should address:

- **Image-only** as the default: simpler, no Dockerfile to maintain. Features handle customization. Works for most projects.
- **Dockerfile generation**: when and why to generate one. The `--dockerfile` flag or auto-detection of projects needing system dependencies (apt packages, build tools).
- What a generated Dockerfile should contain: minimal FROM line, ARGs for lace conventions (TZ, COMMAND_HISTORY_PATH, USERNAME), and comments showing where to add customizations.

### GHCR Template Publishing (Complementary Channel)

As a follow-up to the built-in `lace init`, publish devcontainer templates to GHCR for non-lace users:

- Templates live at `devcontainers/templates/src/` parallel to `devcontainers/features/src/`.
- Published via the existing `devcontainers/action@v1` GitHub Action with `publish-templates: "true"`.
- Consumable via `devcontainer templates apply --template-id ghcr.io/weftwiseink/devcontainer-templates/lace-base:latest`.
- Useful for VS Code's "Add Dev Container Configuration Files..." discovery.
- Templates are snapshots of what `lace init --profile X` generates. They do not replace `lace init` -- they serve users who do not have the lace CLI installed.

The proposal should clarify that this is a phase 2 deliverable that depends on `lace init` stabilizing first.

### Interaction with `lace worktree convert`

A natural workflow is: user converts a normal clone to bare-worktree with `lace worktree convert`, then runs `lace init` to scaffold the devcontainer config. The proposal should consider:

- Does `lace init` detect that the user just ran `lace worktree convert` and auto-populate workspace layout config?
- Should `lace worktree convert` offer to run `lace init` after conversion?
- Should `lace worktree clone` optionally run `lace init` in the new worktree?

### The Clauthier Testbed

The `/home/mjr/code/weft/clauthier` project is a concrete test case: a Claude Code plugin marketplace with no package.json at root, a normal git clone, and no build toolchain requirements. Running `lace init` on clauthier should produce a minimal, image-based config with Claude Code and WezTerm features. The proposal should use clauthier as a validation exercise -- define what the expected output is and verify the detection logic produces it.

## Known Requirements

From the research report and existing lace conventions:

1. **No Docker or devcontainer CLI dependency.** `lace init` is a pure file-generation command. It reads the filesystem and writes `.devcontainer/devcontainer.json`. It should work on a machine with nothing but the lace CLI installed.

2. **Output must be valid for `lace up`.** The generated config must pass `lace up` validation without modification. This includes correct `customizations.lace` structure, valid GHCR feature references, and proper mount declaration format.

3. **Reuse `classifyWorkspace()`.** Git layout detection must use the existing workspace classifier, not reimplement it. This guarantees that init and up agree on the workspace layout.

4. **JSONC output with comments.** The generated `devcontainer.json` should include comments explaining lace-specific sections (what `prebuildFeatures` does, what `mounts` declarations mean, where to customize). This aids users who inspect the generated config.

5. **`lace init` fits before `lace up` in the CLI lifecycle.** It is a new top-level command, not part of the up pipeline. The command structure becomes: `init` (scaffold) -> `up` (validate -> prebuild -> resolve -> generate -> devcontainer up).

## Prior Art

- **`docker init`**: Interactive project detection, generates Dockerfile + compose.yaml. Template-based with detection logic built in. Overwrites existing files with confirmation.
- **`nix flake init`**: Pure file-copy from a template flake. No project detection. User selects the template explicitly. Simple, composable.
- **`devcontainer templates apply`**: OCI-distributed tarballs with variable substitution. No project detection or inference. Suitable for IDE integrations.
- **Lace's own devcontainer** (`.devcontainer/devcontainer.json`): The reference config that `lace init` should be able to reproduce for a bare-worktree Node.js project.
- **Weftwise migration** (`cdocs/proposals/2026-03-03-weftwise-devcontainer-lace-migration.md`): A concrete example of adding lace to an existing project, illustrating the manual steps that `lace init` should automate.

## Open Questions

1. **Should `lace init` also run `lace up` after scaffolding?** Keeping them separate preserves composability and lets users inspect the generated config before committing. But a `lace init --up` shortcut that chains init -> up would reduce friction for the common case. What should the default be?

2. **How to handle projects that need a custom Dockerfile vs. image-only?** The research recommends image-only as the default. But some projects need apt packages, build tools, or other system-level dependencies baked in. Should detection trigger Dockerfile generation (e.g., if a `Makefile` or `CMakeLists.txt` is present), or should this always be an explicit opt-in?

3. **Should profiles be extensible (user-defined profiles)?** Built-in profiles cover the common cases. But teams might want a "company-standard" profile that includes specific features, base images, and mount patterns. Should `~/.config/lace/profiles/` or a similar mechanism be supported? Is this a phase 1 concern or a follow-up?

4. **How does this interact with the worktree conversion workflow?** If a user converts to bare-worktree and then runs `lace init`, the init command needs to detect the bare-worktree layout from within a worktree subdirectory. `classifyWorkspace()` handles this, but the UX flow (convert -> init -> up) should be documented and tested end-to-end.

5. **Version pinning: should init pin feature versions or use `:1` (latest major)?** Using `:1` keeps configs low-maintenance but means builds are not reproducible. Pinning to a specific version (e.g., `wezterm-server:1.2.3`) gives reproducibility but creates maintenance burden. Should the default be latest-major with an opt-in `--pin-versions` flag?

6. **How should `lace init` determine the container username?** The base image uses `vscode`, node images use `node`. The username affects mount target paths (`/home/vscode/.claude` vs `/home/node/.claude`). Should init inspect the base image metadata, use a hardcoded mapping, or defer this to a `--username` flag?

7. **What is the minimum viable implementation?** The research report recommends starting with image-based configs and 3-4 built-in profiles. Should the full proposal scope down further (e.g., phase 1 is just `lace init` with auto-detection and a single default profile, no interactive mode, no user defaults file)?
