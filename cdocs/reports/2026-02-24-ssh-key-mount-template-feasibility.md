---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-24T14:00:00-06:00
task_list: lace/wezterm-server
type: report
state: live
status: wip
tags: [analysis, ssh, mount-templates, wezterm-server, feasibility, devcontainer]
related_to:
  - cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md
  - cdocs/reports/2026-02-14-mount-template-variables-implementation-report.md
  - cdocs/reports/2026-02-15-mount-api-design-rationale.md
  - cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md
---

# SSH Key Mount as Template Variable: Feasibility Assessment

> **BLUF:** Adding the SSH key mount as a lace template variable is straightforward
> (low-medium effort, ~2-3 focused sessions) and would be a natural extension of the
> existing mount declaration system. The main design tension is that the mount system
> was built for **directories** (auto-creates via `mkdirSync`) while SSH keys are
> **individual files** that must already exist. This means the feature needs a new
> `fileMount` distinction in the declaration model, integration with the existing
> `fileExists` host validation, and a settings override path so users can point to
> their own key. The wezterm-server feature is the right owner for the declaration,
> not the project-level devcontainer.json.

## Context / Background

The wezterm-server devcontainer feature enables headless terminal multiplexing over
SSH domains. The SSH connectivity chain requires:

1. An `sshd` daemon inside the container (provided by the `sshd` devcontainer feature)
2. A port mapping from the host to the container's sshd port (managed by lace's
   `${lace.port()}` template system)
3. An SSH public key mounted as `authorized_keys` inside the container (currently
   **hardcoded** in devcontainer.json)

Items 1 and 2 are already well-integrated into lace's declarative system. Item 3 is
the gap: the SSH key mount is a static string in the project's `mounts` array that
uses the `${localEnv:HOME}` devcontainer variable rather than lace's template system.

**Current state** (`.devcontainer/devcontainer.json` line 70):
```
"source=${localEnv:HOME}/.ssh/lace_devcontainer.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
```

This is accompanied by a `fileExists` validation check (lines 27-33) that blocks
`lace up` if the key is missing and tells the user what command to run.

An existing RFP (`cdocs/proposals/2026-01-31-secure-ssh-key-auto-management-lace-cli.md`)
proposes full auto-generation and rotation of SSH keys. This report focuses on the
narrower question: what would it take to make the existing key mount configurable
via lace's template variable system?

## Key Findings

### 1. The mount declaration system was designed for directories, not files

`MountPathResolver.resolveSource()` (`packages/lace/src/lib/mount-resolver.ts` lines
209-221) derives a default path and auto-creates it as a directory:

```typescript
const defaultPath = join(homedir(), ".config", "lace", this.projectId, "mounts", namespace, labelPart);
mkdirSync(defaultPath, { recursive: true });
```

For SSH keys, auto-creating a directory is wrong -- the source must be an existing
file. A mount whose source is a directory when Docker expects a file will fail at
container creation time with a confusing Docker bind-mount error.

**Impact:** The `LaceMountDeclaration` interface needs a way to distinguish file
mounts from directory mounts, and `resolveSource()` must skip `mkdirSync` for file
mounts and instead validate existence.

### 2. Feature-level mount declarations already exist and work

The `LaceMountDeclaration` interface (`packages/lace/src/lib/feature-metadata.ts`)
supports feature-level mount declarations in `customizations.lace.mounts`. These get
namespaced under the feature's short ID (e.g., `wezterm-server/authorized-keys`) and
are auto-injected into the `mounts` array during template resolution.

Port declarations already work this way for wezterm-server:
```json
"customizations": {
  "lace": {
    "ports": {
      "hostSshPort": { "label": "wezterm ssh", "onAutoForward": "silent", "requireLocalPort": true }
    }
  }
}
```

Adding a parallel `mounts` section to the wezterm-server feature metadata would
follow the same pattern.

### 3. Host validation already handles the SSH key check

The `runHostValidation()` function in `host-validator.ts` already validates
`~/.ssh/lace_devcontainer.pub` via the `fileExists` mechanism. If the mount
declaration moves to the feature level, this validation could either:

- **Stay in devcontainer.json** as a project-level concern (simplest)
- **Move to the feature** via a new `validate` section in feature metadata (cleaner
  but more work)
- **Be inferred from the mount declaration** -- if a mount is marked as a file mount,
  lace could automatically validate its source exists before attempting the mount
  (most elegant, eliminates redundancy)

Option 3 is the strongest because it eliminates the duplication between the
`fileExists` check and the mount declaration -- currently both independently reference
`~/.ssh/lace_devcontainer.pub`.

### 4. Settings override for SSH key path is natural

The `settings.json` mount override mechanism already exists:

```json
{
  "mounts": {
    "wezterm-server/authorized-keys": {
      "source": "~/.ssh/my_custom_key.pub"
    }
  }
}
```

This would let users who already have an SSH key they prefer (e.g., a key managed by
an organization's tooling) point lace at it. The override validation in
`MountPathResolver` already checks that the override source exists on disk and throws
a hard error if not -- exactly the right behavior for SSH keys.

### 5. The container-side target path depends on the container user

The current mount targets `/home/node/.ssh/authorized_keys`, which is hardcoded to
the `node` user. Different devcontainer images use different users (`vscode`,
`codespace`, `root`, etc.). The mount declaration can encode this as a default, but
the feature's `install.sh` would need to know the target path too.

This is an existing problem (the static mount in devcontainer.json already hardcodes
`/home/node`) and isn't made worse by the template variable change. The wezterm-server
feature already has a TODO about user-awareness
(`cdocs/proposals/2026-02-05-lace-wezterm-docker-user-lookup.md`).

### 6. The `recommendedSource` field fits perfectly

The `LaceMountDeclaration` type already has a `recommendedSource` field that is used
for guidance output (never as the actual source). For SSH keys, this would be:

```json
"recommendedSource": "~/.ssh/lace_devcontainer.pub"
```

During `lace up`, the mount guidance system (`emitMountGuidance()` in
`template-resolver.ts` lines 378-427) would display:

```
Mount wezterm-server/authorized-keys:
  Current:     ~/.ssh/lace_devcontainer.pub (from settings)
  Recommended: ~/.ssh/lace_devcontainer.pub
```

This gives users visibility into where lace expects the key.

## Analysis: Required Changes

### Tier 1: Core mount system changes (packages/lace)

| File | Change | Effort |
|------|--------|--------|
| `feature-metadata.ts` | Add `fileMount?: boolean` to `LaceMountDeclaration` | Trivial |
| `mount-resolver.ts` | Skip `mkdirSync` for file mounts; validate existence instead | Low |
| `mount-resolver.ts` | Emit error with hint when file mount source is missing | Low |
| `template-resolver.ts` | No changes -- auto-injection already handles mount declarations | None |
| `host-validator.ts` | Optional: infer `fileExists` checks from file mount declarations | Low-Med |

### Tier 2: Feature metadata changes (wezterm-server)

| File | Change | Effort |
|------|--------|--------|
| `devcontainer-feature.json` | Add `mounts` section to `customizations.lace` | Trivial |

Example addition:
```json
"customizations": {
  "lace": {
    "ports": { ... },
    "mounts": {
      "authorized-keys": {
        "target": "/home/node/.ssh/authorized_keys",
        "recommendedSource": "~/.ssh/lace_devcontainer.pub",
        "description": "SSH public key for WezTerm SSH domain access",
        "readonly": true,
        "fileMount": true
      }
    }
  }
}
```

### Tier 3: Project-level devcontainer.json migration

| File | Change | Effort |
|------|--------|--------|
| `.devcontainer/devcontainer.json` | Remove static SSH key mount from `mounts` array | Trivial |
| `.devcontainer/devcontainer.json` | Optionally remove `fileExists` check (if inferred) | Trivial |

### Tier 4: Tests

| Scope | Change | Effort |
|-------|--------|--------|
| `mount-resolver.test.ts` | Test file mount behavior (no auto-create, existence validation) | Low |
| `template-resolver.test.ts` | Test auto-injection of file mount declarations | Low |
| `wezterm-server-scenarios.test.ts` | Verify SSH key mount appears in resolved config | Low |
| `host-validator.test.ts` | Test inferred fileExists (if implemented) | Low |

## Analysis: What the User Experiences Today vs. After

### Today

1. User clones a project with wezterm-server feature
2. Runs `lace up`
3. Sees: `ERROR: Required file not found: ~/.ssh/lace_devcontainer.pub`
4. Sees: `Run: ssh-keygen -t ed25519 -f ~/.ssh/lace_devcontainer -N ''`
5. User runs the command, re-runs `lace up`
6. Key path is hardcoded -- no way to use a different key without editing devcontainer.json

### After (with template variable)

1. User clones a project with wezterm-server feature
2. Runs `lace up`
3. Same validation error and hint (from file mount declaration or inferred fileExists)
4. User generates the key, re-runs `lace up`
5. Key mount is auto-injected from feature declaration -- zero config needed
6. **New:** User can override the key path in `~/.config/lace/settings.json`:
   ```json
   { "mounts": { "wezterm-server/authorized-keys": { "source": "~/.ssh/my_org_key.pub" } } }
   ```

The UX improvement is primarily for multi-project and team scenarios where different
users have different SSH key locations.

## Analysis: Interaction with LACE_RESULT and wez-into

The recent error visibility work (`cdocs/proposals/2026-02-22-wez-into-error-visibility-and-smart-retry.md`)
added structured `LACE_RESULT` output that `wez-into` parses. If the SSH key mount
validation fails, it currently fails in the `hostValidation` phase. This already
triggers the smart abort behavior in `wez-into` -- no retry loop, immediate error
display with remediation.

Moving the SSH key check to a file mount declaration doesn't change this; the
validation still happens before `devcontainer up` and still produces a clear error.
The improvement is that the error becomes more specific: instead of a generic
"Required file not found," lace can say "SSH public key for WezTerm SSH domain access
not found" with the feature context.

## Recommendations

1. **Start with `fileMount` in the declaration model.** This is the minimal change
   that enables the feature. Add a boolean `fileMount` field to `LaceMountDeclaration`
   that changes `resolveSource()` behavior: validate existence instead of auto-create.

2. **Add the mount declaration to wezterm-server feature metadata.** This is where
   the SSH key requirement logically belongs -- it's the wezterm-server feature that
   needs SSH access, not the project config.

3. **Infer fileExists validation from file mount declarations.** This eliminates the
   redundant `fileExists` check in devcontainer.json and ensures the validation error
   includes feature context (e.g., "wezterm-server requires SSH key at ...").

4. **Preserve the existing hint mechanism.** The `hint` field ("Run: ssh-keygen ...")
   should carry over to the file mount declaration, possibly as a new `hint` field on
   `LaceMountDeclaration`.

5. **Defer auto-generation to the broader SSH key management proposal.** The existing
   RFP for auto-generation, rotation, and ssh-agent integration is a larger scope.
   This template variable work is a stepping stone that makes the key path configurable
   without taking on the full auto-management scope.

6. **Consider `lace up` error-interrupt UX.** When a file mount source is missing,
   `lace up` should fail with a clear, actionable message that includes:
   - What feature needs the file
   - The expected default path
   - The exact command to create it
   - How to configure a different path via settings.json
