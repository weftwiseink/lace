---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T16:00:00-08:00
task_list: lace/packages-lace-cli
type: proposal
state: live
status: wip-blocked
tags: [ssh, security, lace-cli, devcontainer, automation, key-management, wezterm-server, file-mount]
related_to:
  - cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md
  - cdocs/reports/2026-02-24-ssh-key-mount-template-feasibility.md
  - cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md
  - cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md
---

# Secure SSH Key Auto-Management for Lace CLI

> BLUF: Add automatic ed25519 key pair generation to `lace up` so that SSH key
> setup for wezterm-server devcontainer connections is zero-config. When no SSH
> key exists at the path expected by the wezterm-server file mount declaration,
> lace generates a passphrase-less ed25519 key pair under
> `~/.config/lace/ssh/` (shared across projects), mounts the public key into
> the container via the file mount system from the companion proposal
> (`cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md`), and
> emits guidance showing the private key path for wezterm SSH domain
> configuration. Key rotation is manual and explicit (`lace ssh rotate`),
> not automatic -- pragmatism for a developer tool over security-product
> ceremony. Lace does NOT manage `~/.ssh/config` or wezterm SSH domain config;
> it generates a snippet the user pastes once. Multi-container support works
> naturally because all containers share the same public key (different ports
> provide isolation, not different keys).
>
> - **Builds on:** `cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md`
>   (file mount declarations with validation)
> - **Motivated by:** `cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md`
>   (wezterm SSH multiplexing requires SSH keys mounted into the container)
> - **Feasibility assessed in:** `cdocs/reports/2026-02-24-ssh-key-mount-template-feasibility.md`

## Objective

The current wezterm SSH domain setup requires users to manually generate an
ed25519 key pair (`ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ""`),
mount the public key into the container as `authorized_keys`, and configure
their host wezterm to use the private key. This is error-prone (wrong
permissions, forgotten key generation, stale keys) and has no rotation or
scope-limiting mechanism.

The goal is to make SSH key setup a zero-action default for new users while
preserving full configurability for users who bring their own keys. A developer
cloning a project with wezterm-server and running `lace up` for the first time
should get a working SSH connection without any manual steps.

## Background

### The SSH connectivity chain

The wezterm-server devcontainer feature enables headless terminal multiplexing
over SSH domains. The full connectivity chain requires:

1. An `sshd` daemon inside the container (the `sshd` devcontainer feature)
2. A port mapping from host to container sshd (lace's `${lace.port()}` system)
3. An SSH public key mounted as `authorized_keys` (currently manual)
4. Host-side wezterm SSH domain config pointing at the private key and port

Items 1 and 2 are already automated by lace. Item 3 is being addressed by the
companion file mount proposal. This proposal addresses the gap between items 3
and 4: when the key does not exist yet, generate it automatically instead of
failing with a remediation hint.

### Current user experience

Today, when a new user runs `lace up` on a project with wezterm-server:

1. `lace up` fails in host validation: "Required file not found:
   ~/.ssh/lace_devcontainer.pub"
2. The error includes a hint: "Run: ssh-keygen -t ed25519 -f
   ~/.ssh/lace_devcontainer -N ''"
3. The user runs the command, then re-runs `lace up`
4. The user must separately configure their wezterm SSH domain with the
   private key path and allocated port

Steps 1-3 are a friction point that can be eliminated entirely. Step 4 can be
reduced to a one-time copy-paste by emitting a wezterm config snippet.

### Companion proposal: file mount declarations

The companion proposal
(`cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md`) adds
`fileMount: true` to the mount declaration system, allowing the wezterm-server
feature to declare its SSH key requirement as a file mount. That proposal
deliberately chose NOT to auto-generate keys, instead failing with an
actionable error when the key is missing. This proposal extends that design:
when the file mount validation detects a missing key, lace generates it rather
than failing.

The relationship is sequential: the file mount proposal provides the
declaration and validation infrastructure; this proposal adds the generation
layer on top.

### Prior art

- The devcontainer `sshd` feature (`ghcr.io/devcontainers/features/sshd:1`)
  handles sshd daemon setup and generates host keys inside the container, but
  does not manage client-side key pairs.
- VS Code Remote-SSH manages its own SSH connections using a proprietary
  transport, not standard SSH keys.
- GitHub Codespaces generates ephemeral SSH keys for `gh cs ssh` connections,
  but these are scoped to the Codespaces infrastructure, not user-managed.
- The `devcontainer` CLI's `features test` command creates temporary SSH keys
  for test containers, demonstrating that automated key generation for
  short-lived containers is an established pattern.

## Proposed Solution

### 1. Key generation during `lace up`

When the file mount resolver encounters a missing SSH key (a `fileMount: true`
declaration where the source file does not exist and no settings override is
configured), and the mount is for an `authorized_keys` target, lace generates
a new ed25519 key pair instead of failing.

The generation happens in the host validation phase (Phase 0b of `lace up`),
after the file mount declaration is resolved but before the mount spec string
is produced. This means the key is available for mount injection in the same
`lace up` invocation -- no re-run needed.

```
lace up pipeline (with key generation):

  Phase 0a: Workspace layout
  Phase 0b: Host validation
    -> File mount "wezterm-server/authorized-keys" resolved
    -> Source file missing at ~/.config/lace/ssh/id_ed25519.pub
    -> Auto-generate key pair:
         ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N "" -C "lace-devcontainer"
    -> Source file now exists, validation passes
  Phase 1:  Metadata fetch
  Phase 2:  Auto-inject templates
  Phase 3:  Template resolution (mount spec uses generated key path)
  ...
```

### 2. Key storage location

Keys are stored under `~/.config/lace/ssh/`:

```
~/.config/lace/ssh/
  id_ed25519           # Private key
  id_ed25519.pub       # Public key (mounted into containers)
```

**Why `~/.config/lace/ssh/` and not `~/.ssh/lace_devcontainer`:**

- **XDG compliance:** `~/.config/lace/` is where all lace user-level state
  lives (settings.json, project mount data). SSH keys are lace-managed state.
- **Avoids polluting `~/.ssh/`:** The user's `~/.ssh/` directory is their
  personal SSH configuration. Lace-managed keys should not intermingle with
  user-managed keys, authorized_keys, or config files.
- **Discoverability:** A user running `ls ~/.config/lace/` immediately sees
  everything lace manages, including SSH keys.
- **Migration:** The companion file mount proposal already uses
  `recommendedSource` to specify the expected key path. Changing from
  `~/.ssh/lace_devcontainer.pub` to `~/.config/lace/ssh/id_ed25519.pub`
  is a one-line metadata change.

**Why shared keys (not per-project):**

Keys are per-user, not per-project. A single key pair is shared across all
projects that use wezterm-server. This is the right tradeoff for a developer
tool:

- Per-project keys would require N key pairs for N projects, with no security
  benefit: all containers run on the same host, accessed by the same user,
  over localhost. The isolation boundary is the host, not the project.
- Per-user keys mean the wezterm SSH domain config references a single
  `IdentityFile` that works for every container.
- Users who want per-project isolation can override via `settings.json`:
  `{ "mounts": { "wezterm-server/authorized-keys": { "source": "~/.ssh/project_specific.pub" } } }`

### 3. Mount injection via the file mount system

This proposal does not introduce a new mount mechanism. It builds on the
companion proposal's file mount declaration system:

1. The wezterm-server feature declares an `authorized-keys` file mount in its
   `devcontainer-feature.json` (companion proposal Phase 3).
2. The mount resolver resolves the source path: settings override >
   `recommendedSource` > lace default.
3. If the source file does not exist and the mount has a `generateIfMissing`
   flag, lace generates the key pair (this proposal's addition).
4. The resolved mount is auto-injected into the `mounts` array.

The new field on `LaceMountDeclaration`:

```typescript
export interface LaceMountDeclaration {
  target: string;
  recommendedSource?: string;
  description?: string;
  readonly?: boolean;
  type?: string;
  consistency?: string;
  /** When true, source must be an existing file (not auto-created as dir). */
  fileMount?: boolean;
  /** Remediation hint shown when a fileMount source is missing. */
  hint?: string;
  /** When true, lace may auto-generate the source file if missing. */
  generateIfMissing?: boolean;
  /** Generator type (determines what lace generates). */
  generator?: "ssh-keygen-ed25519";
}
```

The `generator` field is an enum string rather than a boolean so that the
system can be extended to other generation strategies in the future (e.g.,
TLS certificates for HTTPS-based features). For now, `ssh-keygen-ed25519` is
the only supported value.

### 4. Key generation implementation

Key generation uses `ssh-keygen` via lace's subprocess system:

```typescript
function generateSshKey(keyPath: string, subprocess: RunSubprocess): void {
  const dir = dirname(keyPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const result = subprocess("ssh-keygen", [
    "-t", "ed25519",
    "-f", keyPath,
    "-N", "",           // No passphrase
    "-C", "lace-devcontainer",
    "-q",               // Quiet mode
  ]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to generate SSH key at ${keyPath}: ${result.stderr}`
    );
  }

  // Verify the key pair was created
  if (!existsSync(keyPath) || !existsSync(`${keyPath}.pub`)) {
    throw new Error(
      `ssh-keygen succeeded but key files not found at ${keyPath}`
    );
  }
}
```

The `-C "lace-devcontainer"` comment makes the key identifiable in
`authorized_keys` and `ssh-add -l` output. The `-q` flag suppresses the
progress output that `ssh-keygen` normally writes to stdout.

**Why shell out to `ssh-keygen` instead of using a Node.js crypto library:**

- `ssh-keygen` is universally available on systems where lace runs (Linux,
  macOS). It is the standard tool and produces keys in the standard format.
- Node.js's `crypto.generateKeyPairSync("ed25519")` produces keys in PKCS#8
  PEM format, not OpenSSH format. Converting to OpenSSH format requires
  additional library code.
- Shelling out is consistent with lace's existing subprocess pattern (used
  for `devcontainer`, `docker`, `oras`).

### 5. Key rotation strategy

Key rotation is manual and explicit, not automatic. Lace provides a
`lace ssh rotate` subcommand:

```
lace ssh rotate [--force]
```

Behavior:

1. Generate a new key pair at `~/.config/lace/ssh/id_ed25519.new`
2. Move the old key to `~/.config/lace/ssh/id_ed25519.old`
3. Move the new key to `~/.config/lace/ssh/id_ed25519`
4. Print a message: "SSH key rotated. Restart running containers with
   `lace up` to pick up the new key."

The old key is preserved (not deleted) so that active SSH sessions using the
old key continue to work until the container is restarted. The next `lace up`
invocation mounts the new public key, replacing the old `authorized_keys`.

**Why not automatic rotation:**

- Automatic rotation (per-rebuild, time-based) creates a class of failures
  where a running container's `authorized_keys` becomes stale. The user's
  wezterm session would drop with "Permission denied (publickey)." This is
  worse than no rotation.
- Time-based rotation requires a daemon or cron job, which is infrastructure
  lace should not own.
- Per-rebuild rotation means every `lace up` generates a new key, which
  invalidates any cached SSH host verification and forces the user to update
  their wezterm config if it references a specific key fingerprint.
- For devcontainer SSH domains over localhost, key rotation is a low-priority
  security concern. The threat model is a compromised host, at which point
  the attacker already has access to everything the key protects.

**Why not per-session (ephemeral) keys:**

Ephemeral keys (generated on every `lace up`, destroyed on container stop)
would be the most secure option but create significant UX friction:

- The wezterm SSH domain config would need to be updated on every container
  start, since the `IdentityFile` path or key fingerprint changes.
- SSH host key verification would fail on every restart (the container's host
  key stays the same but the client key changes, which is fine, but the
  inverse -- container host key changes -- would trigger warnings).
- There is no hook for lace to update wezterm config automatically.

### 6. Host SSH config: lace does NOT manage it

Lace does not generate or update `~/.ssh/config` entries. Rationale:

- `~/.ssh/config` is a critical user file. Automated modification risks
  breaking existing entries, creating duplicates, or conflicting with other
  tools that manage SSH config (e.g., corporate VPN tools, `gh`).
- The devcontainer SSH connection uses `localhost` with a dynamic port.
  An `~/.ssh/config` entry would need to be updated every time the port
  changes (which happens when the port allocator assigns a different port
  or the user runs a different project). This makes static config entries
  unreliable.
- The SSH connection is initiated by wezterm, not by the `ssh` CLI. Wezterm
  SSH domains have their own configuration format that does not read
  `~/.ssh/config` for domain definitions (though it does respect it for
  options like `StrictHostKeyChecking`).

Instead, `lace up` emits a one-time guidance snippet after successful key
generation:

```
SSH key generated: ~/.config/lace/ssh/id_ed25519

To configure a WezTerm SSH domain, add to your wezterm.lua:

  config.ssh_domains = {
    {
      name = "lace",
      remote_address = "localhost:22437",  -- port from lace up output
      username = "node",
      ssh_option = {
        identityfile = os.getenv("HOME") .. "/.config/lace/ssh/id_ed25519",
      },
    },
  }

This only needs to be done once. The port may change between projects;
update remote_address as needed, or use wez-into for automatic connection.
```

This guidance is printed once (on first key generation) and references the
actual allocated port from the current `lace up` run.

### 7. Wezterm SSH domain config integration

Lace does not modify the user's wezterm.lua. The guidance snippet (above) is
the integration point. The reasons parallel the `~/.ssh/config` decision:

- Wezterm config is Lua code, not a declarative format. Programmatic
  modification of Lua source is fragile and context-dependent.
- The user's wezterm.lua may already use a plugin system (e.g., the
  multi-project wezterm plugin from
  `cdocs/proposals/2026-02-04-multi-project-wezterm-plugin.md`) that
  generates SSH domain entries dynamically.
- The `wez-into` script already handles automatic SSH connection without
  requiring any wezterm SSH domain config. Manual SSH domain config is a
  power-user feature for persistent domains, not a required setup step.

> NOTE: A future enhancement could provide a `lace ssh wezterm-snippet`
> command that generates the SSH domain config for the current project's
> allocated port, which the user could pipe into their config or use with
> wezterm's `extra_config_files` mechanism.

### 8. Security model

**Passphrase-less keys:** The generated keys have no passphrase (`-N ""`).
This is intentional:

- The keys are used for automated connections (wezterm SSH domains, `wez-into`
  script). Passphrase prompts would break automation.
- The keys protect access to localhost devcontainers, not remote servers.
  The security boundary is the host machine itself.
- ssh-agent integration would require the user to `ssh-add` the key on every
  login, adding friction that contradicts the zero-config goal.

**Scope limitation:** The keys are functionally limited by:

- **Network scope:** The container's sshd listens on a port bound to
  `127.0.0.1` (localhost only), not on all interfaces. The key cannot be used
  from a remote machine.
- **Container scope:** The public key is mounted as `authorized_keys` for a
  specific container user. It does not grant access to the host or to other
  containers (unless they mount the same key).
- **File permissions:** The private key is created with mode `0600` (ssh-keygen
  default). The `~/.config/lace/ssh/` directory is created with mode `0700`.

**What lace does NOT protect against:**

- A compromised host: if an attacker has read access to
  `~/.config/lace/ssh/id_ed25519`, they can connect to any running
  devcontainer. This is inherent to any passphrase-less key scheme.
- A malicious devcontainer image: the container has the public key, not the
  private key, so a compromised container cannot impersonate the host.
  However, the container user can read any files the SSH session has access
  to, which is the intended behavior for a development environment.

### 9. Multi-container support

Multiple devcontainers running concurrently share the same SSH key pair.
Isolation is provided by port allocation, not key isolation:

- Project A's wezterm-server listens on port 22437
- Project B's wezterm-server listens on port 22438
- Both containers have the same public key in `authorized_keys`
- The wezterm SSH domain (or `wez-into`) connects to the correct container
  by port number

This design works because:

- Port numbers are already the primary identifier in the `wez-into` discovery
  system (`lace-discover` returns `project:port:user:path` tuples).
- A shared key means no per-project wezterm config is needed.
- The `settings.json` override mechanism allows per-project keys for users
  who want stronger isolation, but this is not the default.

## Important Design Decisions

### Decision: Shared key, not per-project keys

**Decision:** A single ed25519 key pair at `~/.config/lace/ssh/id_ed25519`
is used for all projects.

**Why:** Per-project keys would require the user to configure a separate
`IdentityFile` in their wezterm SSH domain config for each project. Since
wezterm SSH domain config is manual (lace does not modify wezterm.lua), this
would multiply the one-time setup by the number of projects. The security
benefit is negligible: all containers run on localhost, accessed by the same
user, with the same threat model. A compromised private key at
`~/.config/lace/ssh/` exposes all containers, but so does a compromised
`~/.ssh/id_ed25519` that many developers use for everything. Users who need
per-project isolation can override via `settings.json`.

### Decision: Generate on `lace up`, not on a separate subcommand

**Decision:** Key generation happens automatically during `lace up` when the
key is missing. There is no separate `lace ssh keygen` step.

**Why:** The goal is zero-config for new users. A separate keygen step adds
friction and requires the user to know about it before their first `lace up`.
The file mount validation phase is the natural place to detect the missing
key, and generation is the natural response to "required file missing."
Experienced users who want to bring their own key configure it in
`settings.json` before running `lace up`, and the generation never triggers.

### Decision: `~/.config/lace/ssh/` not `~/.ssh/lace/`

**Decision:** Store generated keys under `~/.config/lace/ssh/`, not under
`~/.ssh/`.

**Why:** Lace's user-level state lives under `~/.config/lace/`. Placing keys
there keeps everything lace manages discoverable in one tree. Placing keys
under `~/.ssh/` would intermingle lace-managed keys with user-managed keys,
making it unclear which keys are safe to delete. The `~/.ssh/` directory is
also sometimes managed by enterprise tools that audit or restrict its
contents.

### Decision: Manual rotation, not automatic

**Decision:** Key rotation is triggered explicitly via `lace ssh rotate`, not
automated.

**Why:** Automatic rotation creates more problems than it solves for localhost
devcontainer keys. Active SSH sessions would drop when the key rotates, and
the user would need to rebuild containers to pick up the new key. The security
benefit of rotating keys used exclusively for localhost connections is minimal.
Manual rotation (with `lace ssh rotate`) is available for users who want it,
such as after a suspected key compromise.

### Decision: Lace does not manage host SSH config or wezterm config

**Decision:** Lace generates guidance snippets but does not write to
`~/.ssh/config` or `wezterm.lua`.

**Why:** Both files are user-owned, often hand-edited, and sometimes managed
by other tools. Automated modification is risky and hard to make idempotent.
The `wez-into` script already handles automatic connection without any SSH
config. Manual SSH domain config is a power-user workflow where a one-time
copy-paste of a generated snippet is acceptable.

### Decision: `generateIfMissing` flag on mount declarations, not a global setting

> **NOTE -- Architectural constraint: `generateIfMissing`/`generator` must NOT
> ship as feature metadata fields.** The design below crosses a fundamental trust
> boundary and must be redesigned before implementation. The analysis follows.
>
> **Trust boundary.** Feature metadata is fetched from OCI registries and is
> publishable by anyone -- the same trust model as npm packages or Docker images.
> Container execution of feature code (e.g., `install.sh`) is sandboxed by
> Docker: a malicious feature's install script runs inside the container and
> cannot directly compromise the host. But `generateIfMissing: true` +
> `generator: "ssh-keygen-ed25519"` creates a path where **feature metadata
> controls host-side command execution**. The `ssh-keygen` invocation runs on the
> host, outside the Docker sandbox. Even with a fixed enum of generator types,
> this means untrusted input (feature metadata from an OCI registry) triggers
> privileged host-side operations. A fixed enum limits the blast radius but does
> not eliminate the boundary violation -- it means any published feature can
> cause lace to execute `ssh-keygen` on the host simply by declaring the field.
>
> **Core principle.** The correct architectural boundary is: **features declare
> requirements; lace decides actions.** Features should say "I need this file at
> this path" (declaration -- safe). Features should never say "run ssh-keygen to
> create this file" (instruction -- unsafe). The difference is between a feature
> expressing a dependency (`sourceMustBe: "file"`, `hint`, `description`) and a
> feature triggering execution (`generateIfMissing: true`,
> `generator: "ssh-keygen-ed25519"`). The former is inert metadata that lace
> validates; the latter is a command that lace obeys.
>
> **What this means for the design.**
>
> - The `generateIfMissing` and `generator` fields MUST NOT land as part of
>   `LaceMountDeclaration`. They allow any feature publisher to trigger
>   host-side command execution via metadata alone.
> - Auto-generation of SSH keys, if implemented, must be a **first-party lace
>   CLI capability** -- lace recognizes that a specific mount pattern (e.g., an
>   `authorized_keys` target from a known feature namespace) corresponds to its
>   own SSH connectivity requirement, and offers generation as a built-in
>   behavior. This is "lace decides to generate a key because it understands its
>   own SSH plumbing," not "a feature told lace to run ssh-keygen."
> - The companion file mount proposal
>   (`cdocs/proposals/2026-02-24-ssh-key-file-mount-and-validation.md`)
>   correctly stops at declaration + validation without crossing into
>   generation, and is the safe foundation to build on.
> - The implementation phases below (Phases 2-3 in particular) that add
>   `generateIfMissing`/`generator` to `LaceMountDeclaration` and feature
>   metadata are **blocked** pending a redesign that moves generation logic
>   entirely into lace-internal code.
>
> **Redesign direction.** Phase 1 (the `generateSshKey` utility) is safe and
> can proceed independently. The integration point (Phase 2) should be
> rearchitected so that lace's `up` pipeline recognizes the authorized-keys
> mount pattern internally and invokes generation as a first-party capability,
> rather than reading `generateIfMissing`/`generator` from feature metadata.
> Phase 3 (feature metadata update) should be limited to the `sourceMustBe` /
> `hint` fields from the companion proposal -- no generation fields.

**Decision:** The auto-generation behavior is declared per-mount via a
`generateIfMissing` field on `LaceMountDeclaration`, not as a global lace
setting.

**Why:** Auto-generation is specific to the SSH key mount. Other file mounts
(e.g., a TLS certificate, a configuration file) should NOT be auto-generated
by default. The feature metadata is the right place to declare "this file can
be generated if missing" because the feature (wezterm-server) knows what the
file is and how to create it. A global setting would apply to all file mounts
indiscriminately.

### Decision: Passphrase-less keys, no ssh-agent integration

**Decision:** Generated keys have no passphrase. Lace does not integrate with
ssh-agent.

**Why:** ssh-agent integration would require: (a) checking if the agent is
running, (b) adding the key if not already added, (c) handling the case where
the agent is locked or unavailable. This is significant complexity for a
marginal security improvement on localhost keys. The practical reality is that
most developers' `~/.ssh/id_ed25519` is also passphrase-less (or unlocked via
agent at login), so lace's generated keys are no less secure than the status
quo.

## Stories

### First-time user, fresh machine

Alex clones a project that uses wezterm-server and runs `lace up` for the
first time. They have never generated an SSH key for lace.

1. `lace up` reaches host validation.
2. The wezterm-server file mount for `authorized-keys` resolves to
   `~/.config/lace/ssh/id_ed25519.pub`.
3. The file does not exist. The mount has `generateIfMissing: true`.
4. Lace generates the key pair, prints:
   "Generated SSH key pair: ~/.config/lace/ssh/id_ed25519"
5. Validation passes. The container starts with the public key mounted.
6. After `lace up` completes, guidance output shows the wezterm SSH domain
   snippet with the allocated port.
7. Alex copies the snippet into their wezterm.lua (once) and connects.

### Existing user, already has a key

Jordan has been using lace for months and already has
`~/.config/lace/ssh/id_ed25519`. They clone a new project.

1. `lace up` resolves the file mount to the existing key.
2. The key exists. No generation occurs.
3. The container starts with the existing key mounted.
4. Jordan's wezterm SSH domain config already works (same key, different port
   auto-discovered by `wez-into`).

### Team member with organizational key

Sam's company distributes SSH keys via a central tool. Sam's key is at
`~/.ssh/corp_ed25519.pub`.

1. Sam adds to `~/.config/lace/settings.json`:
   ```json
   { "mounts": { "wezterm-server/authorized-keys": { "source": "~/.ssh/corp_ed25519.pub" } } }
   ```
2. `lace up` resolves the file mount to the override path.
3. The key exists. No generation occurs. No lace-managed key is created.
4. Sam's wezterm config references `~/.ssh/corp_ed25519` as the
   `IdentityFile`.

### Key rotation after suspected compromise

Pat suspects their private key may have been exposed via a misconfigured
backup script.

1. Pat runs `lace ssh rotate`.
2. Old key is backed up to `~/.config/lace/ssh/id_ed25519.old`.
3. New key pair is generated at `~/.config/lace/ssh/id_ed25519`.
4. Pat runs `lace up` on each running project to remount the new public key.
5. Existing SSH sessions using the old key continue to work until container
   restart. After restart, only the new key is authorized.

## Edge Cases / Challenging Scenarios

### `ssh-keygen` not on PATH

On minimal container hosts or CI environments, `ssh-keygen` might not be
installed. If `ssh-keygen` is not found, lace falls back to the existing
behavior from the companion proposal: fail with an actionable error including
the `ssh-keygen` command to run manually. The error message additionally notes
that `ssh-keygen` could not be found and suggests installing `openssh-client`.

### `~/.config/lace/ssh/` directory has wrong permissions

If the directory exists but has permissive permissions (e.g., `0755` instead
of `0700`), `ssh-keygen` will still generate the key (it only checks the
private key file's permissions, not the parent directory). However, lace should
set `0700` on creation. If the directory already exists with wrong permissions,
lace logs a warning but does not attempt to fix permissions (the user may have
set them intentionally).

### Settings override points to a non-existent key

When the user configures a settings override and the file does not exist,
lace does NOT auto-generate at the override path. The override represents a
conscious choice by the user to use a specific key; auto-generating at that
path would create a key the user did not intend. Instead, lace fails with:

```
Mount override source does not exist for "wezterm-server/authorized-keys":
  ~/.ssh/nonexistent.pub
Create the file or remove the override from settings.json.
```

This is consistent with the existing `MountPathResolver` behavior for
overrides.

### Container user is not `node`

The mount target `/home/node/.ssh/authorized_keys` is hardcoded to the `node`
user. This is an existing limitation inherited from the wezterm-server feature
metadata, not introduced by this proposal. The feature's `install.sh` also
assumes the `node` user. A future enhancement (tracked in
`cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md`) would make
the container user configurable.

### Key already exists with different algorithm

If `~/.config/lace/ssh/id_ed25519` already exists but is not an ed25519 key
(e.g., the user manually created an RSA key at that path), lace does not
overwrite it. The file exists, so the file mount validation passes. If the
key is incompatible with the container's sshd configuration, the SSH
connection will fail at runtime, which is the expected behavior for a
user-managed key at a lace-managed path.

### Concurrent `lace up` invocations

If two `lace up` processes run simultaneously and both detect the missing key,
they could race on key generation. The second `ssh-keygen` invocation will
fail because the file already exists (ssh-keygen does not overwrite by
default). Lace handles this by checking for the file's existence after a
failed `ssh-keygen` and treating "file exists" as success.

### `--skip-validation` flag behavior

When `--skip-validation` is passed, file mount validation errors are
downgraded to warnings (consistent with the companion proposal). Key
generation is skipped when validation is skipped -- the assumption is that
the user knows what they are doing. The mount is still injected, and the
missing source will cause a Docker bind-mount error at container creation
time.

### Feature used without lace (plain devcontainer CLI)

If wezterm-server is used without lace, the `customizations.lace` section is
ignored and no auto-generation occurs. Users must generate keys manually, as
they do today. This is expected behavior.

## Test Plan

### Unit: Key generation

- `generateSshKey()` creates key pair at specified path
- `generateSshKey()` creates parent directory with mode `0700`
- `generateSshKey()` throws on `ssh-keygen` failure
- `generateSshKey()` throws if key files not created after success exit code
- `generateSshKey()` handles concurrent generation (file exists after
  ssh-keygen fails)

### Unit: Mount resolver with `generateIfMissing`

- `resolveSource()` with `fileMount: true` + `generateIfMissing: true` and
  missing file: generates key and returns path
- `resolveSource()` with `fileMount: true` + `generateIfMissing: true` and
  existing file: returns path without generation
- `resolveSource()` with `fileMount: true` + `generateIfMissing: true` and
  settings override (existing): returns override path without generation
- `resolveSource()` with `fileMount: true` + `generateIfMissing: true` and
  settings override (missing): throws error (does NOT generate at override
  path)
- `resolveSource()` with `fileMount: true` + `generateIfMissing: false`:
  existing behavior (fail with hint)
- `resolveSource()` with `generateIfMissing: true` but `ssh-keygen` not
  available: falls back to error with hint

### Unit: Guidance output

- After key generation, guidance includes private key path
- After key generation, guidance includes wezterm SSH domain snippet
- Guidance snippet includes the correct allocated port
- When key already existed, generation message is not printed

### Integration: `lace up` with key generation

- `lace up` on fresh machine (no key): generates key and succeeds
- `lace up` on fresh machine (no key, no ssh-keygen): fails with actionable
  error
- `lace up` with existing key: no generation, succeeds normally
- `lace up` with settings override: uses override, no generation

### Unit: `lace ssh rotate`

- Rotates key pair, old key backed up
- Old key file preserved at `.old` path
- New key pair is valid ed25519
- Rotation with no existing key: generates without backup step
- `--force` flag overwrites without backup prompt

## Implementation Phases

### Phase 1: Key generation utility

Add a `generateSshKey` function to a new module
`packages/lace/src/lib/ssh-keygen.ts`.

**Files:**
- `packages/lace/src/lib/ssh-keygen.ts` -- new module with `generateSshKey()`
  function
- `packages/lace/src/lib/__tests__/ssh-keygen.test.ts` -- unit tests

**Scope:**
- `generateSshKey(keyPath, subprocess)`: runs `ssh-keygen -t ed25519 -f
  <keyPath> -N "" -C "lace-devcontainer" -q`
- Creates parent directory with `0700` permissions
- Verifies both private and public key files exist after generation
- Handles concurrent generation race condition
- Returns the public key path (`${keyPath}.pub`)

**Constraints:** This module has no dependency on the mount system or file
mount declarations. It is a pure utility that takes a path and generates a
key pair. Keep it isolated for testability.

**Success criteria:** Unit tests pass using a mock subprocess runner. The
function correctly handles success, failure, and race conditions.

### Phase 2: Integrate generation into mount resolver

Extend `MountPathResolver.resolveSource()` to call `generateSshKey` when a
file mount has `generateIfMissing: true` and the source is missing.

**Files:**
- `packages/lace/src/lib/feature-metadata.ts` -- add `generateIfMissing?:
  boolean` and `generator?: string` to `LaceMountDeclaration`
- `packages/lace/src/lib/mount-resolver.ts` -- add generation logic to
  `resolveSource()` for file mounts with `generateIfMissing`
- `packages/lace/src/lib/__tests__/mount-resolver.test.ts` -- test
  generation integration

**Dependencies:** Phase 1 (ssh-keygen utility). Also depends on the companion
file mount proposal's `fileMount` flag being implemented. If the companion
proposal has not landed yet, this phase can be developed against a local
branch that includes it.

**Constraints:** Do NOT change behavior of existing directory mounts or file
mounts without `generateIfMissing`. The flag defaults to `false`/`undefined`,
preserving backwards compatibility. Generation only triggers when:
(a) `fileMount: true`, (b) `generateIfMissing: true`, (c) no settings
override, and (d) the resolved source file does not exist.

**Success criteria:** `resolveSource()` generates a key when conditions are
met. Existing mount resolver tests pass unchanged.

### Phase 3: wezterm-server feature metadata update

Add the `generateIfMissing` and `generator` fields to the wezterm-server
feature's mount declaration.

**Files:**
- `devcontainers/features/src/wezterm-server/devcontainer-feature.json` --
  update mount declaration (builds on companion proposal's Phase 3)

**New declaration:**
```json
"mounts": {
  "authorized-keys": {
    "target": "/home/node/.ssh/authorized_keys",
    "recommendedSource": "~/.config/lace/ssh/id_ed25519.pub",
    "description": "SSH public key for WezTerm SSH domain access",
    "readonly": true,
    "fileMount": true,
    "hint": "Run: ssh-keygen -t ed25519 -f ~/.config/lace/ssh/id_ed25519 -N ''",
    "generateIfMissing": true,
    "generator": "ssh-keygen-ed25519"
  }
}
```

**Constraints:** This is a feature metadata change that requires a new feature
version publish. Coordinate with OCI registry publish workflow. The `hint`
field is preserved as a fallback for when generation fails (e.g., `ssh-keygen`
not on PATH).

**Success criteria:** `wezterm-server-scenarios.test.ts` passes with the
updated metadata.

### Phase 4: Guidance output for key generation

After successful key generation during `lace up`, emit guidance showing the
private key path and a wezterm SSH domain config snippet.

**Files:**
- `packages/lace/src/lib/up.ts` -- add post-generation guidance emission
- `packages/lace/src/lib/template-resolver.ts` -- extend
  `emitMountGuidance()` to handle generated file mounts

**Scope:** The guidance is printed once per key generation event (not on every
`lace up`). It includes:
- The generated private key path
- A wezterm SSH domain config snippet with the allocated port
- A note that this is a one-time setup

**Constraints:** Guidance goes to stderr (consistent with existing mount
guidance). The wezterm snippet is informational only -- lace does not verify
whether the user has configured it.

**Success criteria:** `lace up` on a fresh machine prints the guidance.
Subsequent `lace up` runs (key exists) do not print generation guidance.

### Phase 5: `lace ssh rotate` subcommand

Add a `lace ssh rotate` command for manual key rotation.

**Files:**
- `packages/lace/src/commands/ssh.ts` -- new command module
- `packages/lace/src/lib/ssh-keygen.ts` -- add `rotateSshKey()` function
- `packages/lace/src/lib/__tests__/ssh-keygen.test.ts` -- rotation tests

**Scope:**
- Back up existing key to `id_ed25519.old`
- Generate new key pair at `id_ed25519`
- Print message about restarting containers
- `--force` flag to skip confirmation

**Constraints:** This phase is independently valuable but lower priority than
Phases 1-4. It can be deferred without blocking the core auto-generation
feature.

**Success criteria:** `lace ssh rotate` generates a new key, backs up the old
one, and prints restart guidance.

### Phase 6: Migration from `~/.ssh/lace_devcontainer` path

Update the `recommendedSource` in wezterm-server feature metadata from
`~/.ssh/lace_devcontainer.pub` to `~/.config/lace/ssh/id_ed25519.pub`.
Add a migration check that detects the old key and suggests moving it.

**Files:**
- `devcontainers/features/src/wezterm-server/devcontainer-feature.json` --
  update `recommendedSource`
- `.devcontainer/devcontainer.json` -- update `fileExists` path (if the
  companion proposal has not already removed it)
- `packages/lace/src/lib/ssh-keygen.ts` -- add migration detection

**Scope:**
- During key generation, check if `~/.ssh/lace_devcontainer` exists
- If so, print: "Found existing lace SSH key at ~/.ssh/lace_devcontainer.
  Consider moving it: mv ~/.ssh/lace_devcontainer* ~/.config/lace/ssh/"
- Do NOT auto-migrate (the user may be using the key for other purposes)

**Constraints:** This is a breaking change for existing users who have the
key at the old path. The migration message is a courtesy, not a hard error.
Users with a settings override pointing to the old path will continue to work
without any change.

**Success criteria:** New installations use `~/.config/lace/ssh/`. Existing
installations see a migration suggestion.

## Open Questions

1. ~~Should keys be per-project or per-user?~~ **Resolved:** Per-user (shared
   across projects). Per-project keys add management burden with no security
   benefit for localhost devcontainers. Users who need isolation can override
   in settings.json.

2. ~~Should lace manage host `~/.ssh/config` entries?~~ **Resolved:** No. Lace
   emits a guidance snippet instead. `~/.ssh/config` is user-owned and often
   managed by other tools.

3. ~~How does this interact with the `sshd` devcontainer feature's own key
   management?~~ **Resolved:** No interaction. The sshd feature manages
   server-side host keys inside the container. This proposal manages
   client-side user keys on the host. They are independent.

4. ~~Should key generation happen at `lace prebuild` time or at container
   start time?~~ **Resolved:** At `lace up` time, during host validation.
   Prebuild does not need the key (it builds images, not running containers).
   Key generation during `lace up` means the key is available for mount
   injection in the same invocation.

5. ~~Is there value in supporting `ssh-agent` forwarding as an alternative to
   mounted keys?~~ **Resolved:** Not in this proposal. ssh-agent forwarding
   solves a different problem (forwarding credentials from host to container
   for outbound SSH from the container). The SSH key here is for inbound SSH
   to the container. ssh-agent integration for passphrase-protected keys
   could be a future enhancement but is not justified for localhost-only keys.
