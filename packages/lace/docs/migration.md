# Migration Guide: From devcontainer CLI to lace

This guide walks through migrating an existing devcontainer setup from
direct `devcontainer` CLI usage to lace-managed orchestration. Each step is
independently valuable -- you can stop at any point and still benefit from
what you have adopted so far.

## Starting point

A standard devcontainer.json that works with `devcontainer up`:

```jsonc
{
  "image": "node:24-bookworm",
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      "port": "2222"
    },
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "mounts": [
    "source=${localEnv:HOME}/.ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
  ],
  "forwardPorts": [2222],
  "appPort": ["2222:2222"],
  "portsAttributes": {
    "2222": { "label": "SSH" }
  }
}
```

This config hardcodes port 2222 for SSH, manually manages bind mounts,
and uses `devcontainer up --workspace-folder .` directly.

## Step 1: Minimal lace wrapper

Replace `devcontainer up` with `lace up`. No config changes needed.

**Before:**
```sh
devcontainer up --workspace-folder .
```

**After:**
```sh
lace up --workspace-folder .
```

Lace reads your existing `devcontainer.json`, generates
`.lace/devcontainer.json` (a copy with path adjustments), and passes it to
`devcontainer up`. Everything works exactly as before.

**Setup:**
1. Install lace: `npm install lace`
2. Add `.lace/` to your `.gitignore`:
   ```
   .lace/
   ```
3. Run `lace up --workspace-folder .`

**What you get:** A foundation for incremental adoption. The generated
config is visible at `.lace/devcontainer.json` for inspection.

## Step 2: Port allocation

Replace hardcoded port values with `${lace.port()}` templates. Lace
allocates from the 22425-22499 range and uses a symmetric model (same port
on host and container).

**Before:**
```jsonc
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      "port": "2222"
    }
  },
  "forwardPorts": [2222],
  "appPort": ["2222:2222"],
  "portsAttributes": {
    "2222": { "label": "SSH" }
  }
}
```

**After:**
```jsonc
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {
      "port": "${lace.port(sshd/port)}"
    }
  }
}
```

You can remove `forwardPorts`, `appPort`, and `portsAttributes` entirely --
lace auto-generates these from the port allocation. If the feature declares
`customizations.lace.ports` in its metadata, you can even remove the
explicit `"port": "${lace.port(sshd/port)}"` line; lace auto-injects it.

**What you get:** No port conflicts between containers. Port 22425 for one
project, 22426 for another, etc. Assignments persist in
`.lace/port-assignments.json` across runs.

For details on the symmetric port model, auto-injection, and type coercion,
see [Port allocation](../README.md#port-allocation) and
[Template variables](../README.md#template-variables) in the README.

## Step 3: Mount declarations

Replace static mount strings with `customizations.lace.mounts`
declarations and `${lace.mount()}` templates.

**Before:**
```jsonc
{
  "mounts": [
    "source=${localEnv:HOME}/.ssh/id_ed25519.pub,target=/home/node/.ssh/authorized_keys,type=bind,readonly"
  ]
}
```

**After:**
```jsonc
{
  "customizations": {
    "lace": {
      "mounts": {
        "ssh-key": {
          "target": "/home/node/.ssh/authorized_keys",
          "recommendedSource": "~/.ssh/id_ed25519.pub",
          "sourceMustBe": "file",
          "readonly": true,
          "description": "SSH public key for container access",
          "hint": "Run: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''"
        },
        "bash-history": {
          "target": "/commandhistory",
          "description": "Persistent bash history"
        }
      }
    }
  }
}
```

You can remove the static `mounts` entry -- lace auto-injects
`${lace.mount(project/ssh-key)}` and `${lace.mount(project/bash-history)}`
entries from the declarations.

After running `lace up`, lace prints guided configuration:

```
Mount configuration:
  project/ssh-key: /home/user/.ssh/id_ed25519.pub (file)
  project/bash-history: using default path /home/user/.config/lace/myproject/mounts/project/bash-history

To configure custom mount sources, add to ~/.config/lace/settings.json:
{
  "mounts": {
    "project/bash-history": { "source": "~/dev_records/bash/history" }
  }
}
```

**What you get:** Validated mounts (file/directory type checking before
container creation), per-user source path overrides via settings.json,
auto-created default directories, and guided configuration output.

For the full mount system, see [Mount templates](../README.md#mount-templates)
in the README.

## Step 4: Prebuilds (optional)

Move slow-to-install features (git, neovim, claude-code) from `features`
to `customizations.lace.prebuildFeatures`. They get baked into a cached
local image.

**Before:**
```jsonc
{
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {},
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
  }
}
```

**After:**
```jsonc
{
  "customizations": {
    "lace": {
      "prebuildFeatures": {
        "ghcr.io/devcontainers/features/git:1": {},
        "ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
      }
    }
  },
  "features": {
    "ghcr.io/devcontainers/features/sshd:1": {}
  }
}
```

**Workflow:**
```sh
lace prebuild           # One-time: bake features into image (~minutes)
lace up                 # Fast: uses cached image
# ... develop ...
lace restore            # Before committing: revert Dockerfile FROM
git add . && git commit
lace prebuild           # Instant re-activation from cache
```

**Rules:**
- A feature cannot appear in both `prebuildFeatures` and `features`.
- `${lace.port()}` expressions in `prebuildFeatures` are not resolved
  (prebuild features use default option values). A warning is emitted.
- Prebuild images are local-only (`lace.local/*`), never pushed to a
  registry.

For prebuild internals, see [docs/prebuild.md](prebuild.md).

## Step 5: Workspace layout (optional)

If you use the bare-repo worktree convention (nikitabobko style), lace
can auto-detect the layout and set `workspaceMount`, `workspaceFolder`,
and `postCreateCommand`.

**Before (manual configuration):**
```jsonc
{
  "workspaceMount": "source=/home/user/code/project,target=/workspace,type=bind,consistency=delegated",
  "workspaceFolder": "/workspace/main",
  "postCreateCommand": "git config --global --add safe.directory '*'"
}
```

**After:**
```jsonc
{
  "customizations": {
    "lace": {
      "workspace": { "layout": "bare-worktree" }
    }
  }
}
```

Lace inspects the `.git` file to determine the layout and generates the
correct settings automatically. If you set `workspaceMount` or
`workspaceFolder` explicitly, lace respects your values and skips
auto-generation for those fields.

For configuration options (mountTarget, postCreate settings), see
[Workspace layout](../README.md#workspace-layout) in the README.

## Step 6: Host validation (optional)

Add pre-flight checks that validate host resources before container
creation.

```jsonc
{
  "customizations": {
    "lace": {
      "validate": {
        "fileExists": [
          {
            "path": "~/.ssh/id_ed25519.pub",
            "severity": "error",
            "hint": "Run: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''"
          },
          {
            "path": "~/.claude",
            "severity": "warn",
            "hint": "Create with: mkdir -p ~/.claude"
          }
        ]
      }
    }
  }
}
```

**What you get:** Actionable error messages instead of cryptic Docker
failures when prerequisites are missing. `severity: "error"` aborts
`lace up`; `severity: "warn"` prints a warning and continues.

Use `--skip-validation` to downgrade errors to warnings for CI or initial
setup.

For details, see [Host-side validation](../README.md#host-side-validation)
in the README.

## What NOT to migrate

Lace does not replace:

- **The `devcontainer` CLI itself.** Lace wraps it. You still need
  `devcontainer` on your PATH. The generated `.lace/devcontainer.json` is
  a standard devcontainer config.

- **VS Code Remote Containers extension.** Lace is terminal-native but the
  generated config is VS Code compatible. You can use VS Code's "Reopen in
  Container" with the generated config.

- **Docker Compose.** Lace targets single-container devcontainers. If your
  setup uses `docker-compose.yml`, lace is not the right tool.

- **Multi-stage Dockerfile logic.** Lace rewrites only the first `FROM`
  line during prebuilds. Complex multi-stage builds work fine as long as
  the first stage is the one lace should prebuild onto.

- **Feature-specific configuration.** Lace does not change how features
  work inside the container. It only manages how they are configured,
  allocated ports, and installed (via prebuilds).
