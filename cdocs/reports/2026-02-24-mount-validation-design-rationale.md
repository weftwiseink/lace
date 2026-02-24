---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-24T19:00:00-06:00
task_list: lace/wezterm-server
type: report
state: live
status: done
tags: [analysis, mount-validation, design-rationale, ssh]
related_to:
  - cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md
---

# Mount Validation Design Rationale

> **BLUF:** This report captures the design reasoning and alternatives analysis
> behind the validated mount declaration system proposed in
> `cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md`. It exists
> to keep the proposal focused on what to build while preserving the "why"
> context for future contributors.

## Background: Docker Bind Mount Behavior

When Docker encounters a bind mount whose host source path does not exist, it
does **not** fail. Instead, it silently creates a directory at that path (owned
by root). This means:

- If an SSH key file mount source is missing, Docker creates a directory named
  `id_ed25519.pub` on the host.
- Inside the container, `/home/node/.ssh/authorized_keys` becomes a directory.
- `sshd` silently fails to authenticate because it tries to read a directory
  as a file. No error is logged.

This behavior makes pre-validation essential for file-type bind mounts. Without
it, the user gets a silently broken SSH connection with no diagnostic output.

## Design Decision: `sourceMustBe` Enum vs. Alternatives

### Considered: `fileMount: boolean`

The original draft used `fileMount: boolean` to distinguish file mounts from
directory mounts. The review (`cdocs/reviews/2026-02-24-review-of-ssh-key-file-mount-and-validation.md`)
identified that this conflates two concerns:

1. The **type** of the source (file vs. directory)
2. The **pre-existence requirement** (must already exist vs. auto-create)

A directory that must already exist (e.g., a pre-populated data volume) would
need `fileMount: true`, which is misleading.

### Considered: `validation` Sub-object

A `validation: { mustExist: true, type: "file" }` sub-object is more
extensible but adds nesting for what is currently a single dimension. Future
validation needs (permissions, content checks) can be added as additional
top-level fields without restructuring.

### Chosen: `sourceMustBe: "file" | "directory"`

The enum directly expresses the constraint ("the source must be a file" or
"the source must be a directory"), is flat, and is self-documenting. The
field name reads naturally: `sourceMustBe: "file"` means "the source must be
a file."

When `sourceMustBe` is omitted, the existing behavior applies: auto-create
a directory via `mkdirSync`. This preserves full backwards compatibility.

## Design Decision: `recommendedSource` Dual Role

The `recommendedSource` field was originally documented as "never used as actual
source" -- it was purely for guidance output. For validated mounts, this changes:
`recommendedSource` becomes the default source path (after tilde expansion) when
no settings override is configured.

**Why this is the right change:** The auto-derived path pattern
(`~/.config/lace/<projectId>/mounts/ns/label`) is designed for directories that
lace creates and manages. For validated mounts, the source is externally managed
(the user creates the SSH key). Using `recommendedSource` as the default means
the key lives where the hint tells the user to put it, avoiding a confusing
disconnect between the guidance message and the actual resolution.

The JSDoc on `recommendedSource` must be updated to document this dual role.

## Design Decision: Feature-Level Ownership

The SSH key mount declaration lives in the wezterm-server feature's
`devcontainer-feature.json`, not in the project's `devcontainer.json`.

**Rationale:**

- The SSH key is a requirement of the wezterm-server feature, not of the
  project. If a project removes wezterm-server, the SSH key requirement
  should disappear automatically.
- Feature-level declarations mean every project that uses wezterm-server
  gets the validation and guidance for free.
- This matches the existing precedent: `hostSshPort` is already owned by
  the wezterm-server feature with a TODO to decouple into a thin sshd wrapper.

**Known compromise:** Strictly, `sshd` (not wezterm-server) is the SSH key
consumer. The intended future state is an sshd wrapper feature that owns both
the port and the key declaration. Until then, wezterm-server owns both
pragmatically.

## Design Decision: No Auto-Generation

This proposal does not auto-generate SSH keys. If the key is missing, lace
fails with an actionable error.

**Rationale:**

- Auto-generation is a larger scope covered by the elaborated proposal
  (`cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md`).
- If auto-generation is added later, it should be a first-party lace CLI
  capability (lace recognizes its own SSH connectivity requirement and offers
  to generate the key), not something driven by feature metadata fields like
  `generateIfMissing`.
- Allowing feature metadata to trigger host-side command execution crosses a
  trust boundary: features are fetched from OCI registries and are publishable
  by anyone.

## Design Decision: Hybrid Pipeline Ordering

The existing `fileExists` check at Phase 0b (host validation) is preserved.
Feature-level validated mount checking runs after metadata fetch (Phase 1.5)
as a supplement.

**Rationale:**

Moving all validation after metadata fetch has an unexamined failure mode: if
metadata fetch fails (network error, registry down), the user loses the SSH key
validation error entirely. The existing `fileExists` check at Phase 0b is
network-independent and catches the missing key even when the registry is
unreachable. The feature-level validation supplements it with richer context
(feature name, description, settings.json override guidance) when metadata is
available.

## Design Decision: Error Message Includes Settings Override Example

When the SSH key is missing, the error message shows the exact JSON to add to
`settings.json` for using a different key.

**Rationale:**

The most common "I already have a key" scenario is a user who has their own SSH
key and doesn't want to generate a second one. Showing the settings.json
override path in the error message makes this a copy-paste operation rather
than a documentation hunt.

## Design Decision: `statSync()` Over `existsSync()`

Validation uses `statSync()` rather than `existsSync()` to distinguish files
from directories. `statSync()` follows symlinks, so:

- A symlink pointing to a file passes validation.
- A broken symlink fails as missing (`ENOENT`).
- A directory at a file path is caught ("expected file but found directory").

This prevents the case where a user accidentally creates a directory at the SSH
key path (e.g., `mkdir -p ~/.config/lace/ssh/id_ed25519.pub`), which would
pass `existsSync()` but fail as a Docker file bind mount.

## Settings Configuration: Why Global, Not Per-Project

`settings.json` is global (not per-project). A settings override applies to all
projects. For the SSH key use case this is typically correct -- the user has one
SSH key they use everywhere.

**Why this is acceptable:**

- It's already where mount overrides live (no new configuration surface).
- It's XDG-compliant and not committed to version control.
- It applies across all projects that use the wezterm-server feature.
- It follows the existing precedent set by `project/claude-config` overrides.

**Known limitation:** Users who need per-project key isolation must use a
different mechanism (e.g., project-level mount override in devcontainer.json).
The auto-management proposal may address this in the future.
