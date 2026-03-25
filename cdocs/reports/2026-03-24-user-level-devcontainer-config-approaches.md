---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T14:00:00-07:00
task_list: lace/user-config-research
type: report
state: live
status: wip
tags: [lace, user_config, devcontainer_features, security, research]
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-24T15:00:00-07:00
  round: 1
---

# User-Level Devcontainer Config Approaches

> BLUF(opus/user-config-research): Lace lacks a mechanism for users to declare universal mounts, features, and identity config across all projects.
> The devcontainer spec provides limited user-level support: VS Code's `dotfiles.repository` setting, SSH agent forwarding, and `.gitconfig` copying.
> None of these are sufficient for lace's needs because lace operates outside VS Code and requires declarative, security-constrained config.
> The recommended approach is a `~/.config/lace/user.json` file (chezmoi-manageable, read-only mount enforcement, merge-with-project semantics) that extends the existing `settings.json` with universal mount and feature declarations.

## Context / Background

Lace preprocesses `devcontainer.json` files, resolving `${lace.port()}` and `${lace.mount()}` templates, managing mounts, ports, features, and prebuilds.
The current `~/.config/lace/settings.json` provides mount source overrides only: it tells lace where to find files on the host, but cannot declare new mounts or features.

Five separate RFPs have emerged that each address a narrow slice of the same gap:
- Git credential support (mounting `.gitconfig` with identity-only fields)
- Screenshot sharing (mounting a host screenshots directory)
- SSHD feature evolution (publishing a reusable feature with metadata)
- Workspace system context (injecting runtime metadata into containers)
- Dotfiles migration (chezmoi-based config management with lace plugin support)

Each of these proposes a one-off solution.
A unified user-level config mechanism would subsume most of them.

## Key Findings

### 1. The devcontainer spec has no user-level config mechanism

The devcontainer specification (`containers.dev`) defines per-project config in `devcontainer.json`.
There is no spec-level concept of "user defaults that apply to all devcontainers."

The closest mechanisms are:
- **`dotfiles.repository`/`dotfiles.installCommand`**: A VS Code user setting (not in `devcontainer.json`) that clones a dotfiles repo into the container and runs an install script.
  This is IDE-specific (VS Code, Codespaces) and operates via lifecycle hooks, not declarative config.
- **`${localEnv:VAR}`**: Allows referencing host environment variables in `devcontainer.json`.
  Useful for passing through values like `$TZ` but requires each project to opt in.
- **`containerEnv`/`remoteEnv`**: Set environment variables inside the container.
  Again per-project, not user-level.

### 2. VS Code auto-forwards credentials, lace must not

VS Code Dev Containers automatically:
- Copies the host's `~/.gitconfig` into the container on startup.
- Forwards the local SSH agent into the container (if running).
- Shares HTTPS credential helpers bidirectionally.
- Supports GPG key sharing with additional setup.

These behaviors are baked into the VS Code Dev Containers extension, not the devcontainer spec.
Lace explicitly rejects SSH agent forwarding and credential helper sharing as security violations (containers run untrusted code, AI-generated tool calls, npm postinstall scripts).

The relevant distinction: VS Code trusts the container, but lace does not.
Lace containers are disposable sandboxes with a "read the repo, commit locally, never push" security boundary.

### 3. Chezmoi is the natural driver for user-level config

Chezmoi manages dotfiles across machines using a source/apply model with templating.
Users who adopt chezmoi for their dotfiles can include lace's user config file in their chezmoi source state.

Key chezmoi integration points:
- Chezmoi manages files at well-known paths (`~/.config/lace/...`).
- Chezmoi supports templating for machine-specific values (hostname, OS, environment detection via `$CODESPACES`, etc.).
- Chezmoi's `run_once` scripts can bootstrap prerequisites (generate SSH keys, create directories).
- Chezmoi's `.chezmoiignore` handles platform-specific exclusion.

The integration is unidirectional: chezmoi writes files that lace reads.
Lace does not need to know about chezmoi.
This is the correct decoupling: lace consumes a config file at a well-known path, and the user manages that file however they choose (chezmoi, manual editing, Ansible, etc.).

### 4. Read-only mounts are necessary but not bulletproof

Docker bind mounts with `readonly` (`:ro`) prevent the container process from writing to the mounted path through normal filesystem operations.
This is the correct default for user-level mounts: the container should read config, not modify it.

Known limitations of read-only bind mounts:
- **Dirty Pipe (CVE-2022-0847)**: Allowed overwriting read-only file data via kernel pipe exploit. Patched in Linux 5.16.11+.
- **runC vulnerabilities (CVE-2025-31133, CVE-2025-52565, CVE-2025-52881)**: Race conditions in mount setup could bypass isolation. Patched in runC 1.2.6+.
- **Privileged containers**: `--privileged` mode bypasses all mount restrictions. Lace should never use `--privileged`.

Practical risk assessment: read-only bind mounts are sufficient for lace's threat model.
The adversary is untrusted code running inside the container (AI-generated code, build scripts), not a sophisticated attacker with kernel exploits.
Read-only enforcement plus path validation (no mounting `/`, `/etc`, Docker socket, SSH keys) provides adequate defense-in-depth.

### 5. Mount path validation is critical

Beyond read-only enforcement, lace must validate what paths users can mount.
Dangerous mounts include:
- `/var/run/docker.sock`: grants full Docker API access, enabling container escape.
- `~/.ssh/`: exposes SSH private keys.
- `~/.gnupg/`: exposes GPG private keys.
- `~/.aws/`, `~/.kube/`, `~/.config/gcloud/`: cloud credentials.
- `/`: host root filesystem.
- Any path outside the user's home directory (potential privilege escalation).

A denylist approach is fragile (new credential paths appear constantly).
An allowlist approach is restrictive (users cannot mount arbitrary directories).
The recommended approach is a constrained allowlist with escape hatch:
- Default: only allow mounts under `~/` (user's home directory).
- Read-only enforcement: always, no override.
- Denylist for known-dangerous subdirectories (`~/.ssh/`, `~/.gnupg/`, `~/.aws/`, etc.).
- No mounts outside `~/` without explicit `--allow-system-mounts` flag.

### 6. Multiple config delivery mechanisms compared

| Mechanism | Pros | Cons |
|-----------|------|------|
| **JSON config file** | Declarative, validatable, chezmoi-friendly, diffable | Another config file to manage |
| **Environment variables** | Universal, no file needed | Flat, hard to express structured data (lists of mounts, feature options) |
| **Mounted configs** | Container can read directly | Chicken-and-egg: lace needs config before it can create mounts |
| **Feature options** | Part of existing feature metadata | Per-feature, not user-global |
| **Lifecycle scripts** | Flexible, can run arbitrary code | Imperative (not declarative), hard to validate, security risk |

JSON config file at a well-known XDG path wins on every dimension that matters for lace:
- Declarative and validatable before container creation.
- Compatible with chezmoi, git-managed dotfiles, and manual editing.
- Can express structured data (mount arrays, feature maps, nested options).
- No chicken-and-egg problem: lace reads the file during preprocessing, before any Docker operations.

### 7. Merge semantics matter

When user-level config coexists with project-level config, the merge strategy must be clear:

| Config Type | Merge Strategy |
|-------------|---------------|
| **Mounts** | Union: user mounts + project mounts. Conflict on target path is an error. |
| **Prebuild features** | Union: user features + project features. Same feature with different options: project wins. |
| **Default shell** | User provides default, project can override. |
| **Git identity** | User provides, project cannot override (identity is personal). |
| **containerEnv** | User provides defaults, project can override per-variable. |

The guiding principle: user config provides personal defaults, project config provides project-specific requirements, and project overrides user where they conflict (except for identity, which is always personal).

## Analysis

### Approach A: Extend `settings.json` with new sections

Add `userMounts`, `userFeatures`, `defaultShell`, `gitIdentity` sections to the existing `~/.config/lace/settings.json`.

Advantages:
- Single config file, no new file to discover.
- Existing settings discovery and parsing code is reusable.

Disadvantages:
- `settings.json` currently contains per-mount source overrides. Mixing mount sources (overrides) with mount declarations (new mounts) in the same file creates confusion.
- The file semantics change from "override project config" to "declare user config + override project config."

### Approach B: New `user.json` file alongside `settings.json`

Create `~/.config/lace/user.json` for user-level declarations, keeping `settings.json` for per-project overrides.

Advantages:
- Clean separation of concerns: `user.json` declares "what I always want," `settings.json` declares "how to find things on this machine."
- Each file has a single, clear purpose.
- Can evolve independently.

Disadvantages:
- Two files instead of one.
- Users must learn which settings go where.

### Approach C: Extend `settings.json` (unified)

Merge everything into `settings.json`: overrides, user mounts, user features, identity, shell.

Advantages:
- One file to rule them all.

Disadvantages:
- The file becomes overloaded.
- Hard to distinguish "this mount is a source override for a project-declared mount" from "this mount should be added to every container."

### Assessment

Approach B is recommended.
The conceptual split between "user declarations" and "machine-specific overrides" is natural and maps to how users think about config:
- "I always want neovim and nushell in every container" (user.json).
- "On this machine, my Claude config lives at `/custom/path/.claude`" (settings.json).

Approach A is acceptable if adding a second file is considered too much friction.
Approach C is not recommended due to semantic overloading.

## Security Analysis

### Threat Model

The primary threat is untrusted code running inside the container accessing host resources through user-configured mounts.
Attack vectors:
1. **Information exfiltration**: AI-generated code reads sensitive files from mounted directories.
2. **Config poisoning**: If mounts were writable, container code could modify host dotfiles.
3. **Credential theft**: Mounting credential stores exposes them to container processes.

### Mitigations

1. **Read-only enforcement**: All user-level mounts are read-only. No override mechanism.
2. **Path denylist**: Block known-dangerous paths (`~/.ssh/`, `~/.gnupg/`, `~/.aws/`, `~/.kube/`, Docker socket).
3. **Home directory constraint**: Only allow mounts under `~/` (configurable per-mount).
4. **Git identity via env vars**: Inject `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` as environment variables, not by mounting `.gitconfig` (which may contain credential helpers).
5. **Feature allowlist**: User-declared features must come from registries (GHCR, MCR). No local path features in user config (prevents a compromised dotfiles repo from injecting arbitrary install scripts).
6. **Validation at preprocessing time**: All constraints are checked before Docker operations begin. Invalid config is a hard error, not a warning.

### What is NOT mitigated

- Kernel-level exploits that bypass read-only mounts (Dirty Pipe class). Mitigation: keep host kernel updated.
- A user deliberately mounting dangerous paths with a modified lace binary. Mitigation: out of scope (user has root on host).
- Feature install scripts with malicious code from a trusted registry. Mitigation: feature trust is the registry's responsibility, same as today.

## Recommendations

1. **Create `~/.config/lace/user.json`** as the user-level config file, separate from `settings.json`.
2. **Enforce read-only on all user mounts** with no override.
3. **Inject git identity via `containerEnv`** (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`) rather than mounting `.gitconfig`.
4. **Validate mount paths** against a denylist of known-dangerous directories.
5. **Support universal prebuild features** in user config, merged with project features.
6. **Define clear merge semantics**: user provides defaults, project overrides (except identity).
7. **Document chezmoi integration** as the recommended way to manage `user.json` across machines.
8. **Subsume existing RFPs**: git credential support, screenshot sharing, and parts of workspace system context become instances of the user config mechanism rather than standalone features.

## Prior Art References

- VS Code Dev Containers credential sharing: automatic `.gitconfig` copy, SSH agent forwarding, credential helper passthrough.
- Devcontainer spec `dotfiles.repository`: VS Code user setting that clones a dotfiles repo into containers.
- Chezmoi container integration: non-interactive `install.sh`, `CODESPACES` environment detection, templated `.chezmoi.toml.tmpl`.
- Docker Enhanced Container Isolation: user namespace remapping for defense-in-depth.
- OWASP Docker Security Cheat Sheet: bind mount restrictions, privilege minimization.
