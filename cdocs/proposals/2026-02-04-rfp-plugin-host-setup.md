---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:30:00-08:00
task_list: lace/plugins-system
type: proposal
state: live
status: request_for_proposal
tags: [plugins, host-setup, runtime-scripts, ssh-keys, devcontainer, lace-cli]
related_to: cdocs/proposals/2026-02-04-lace-plugins-system.md
---

# RFP: Plugin Host Setup and Runtime Scripts

> BLUF: Allow plugins to declare host-side setup requirements (SSH key generation, daemon processes, host directory creation) and provide runtime scripts (environment initialization, post-attach hooks) that integrate with the devcontainer lifecycle. This enables self-contained plugins like WezTerm integration that need both host and container configuration.

## Objective

Enable plugins to be truly self-contained by allowing them to:

1. **Declare host-side prerequisites**: SSH keys, host directories, environment variables
2. **Provide setup scripts**: Executed on the host before container creation
3. **Provide runtime scripts**: Executed in the container at various lifecycle points
4. **Define cleanup routines**: For when the container is removed

**Motivating example**: The lace WezTerm integration needs:
- Host: SSH keypair at `~/.ssh/lace_devcontainer` and `~/.ssh/lace_devcontainer.pub`
- Host: WezTerm mux server configuration
- Container: SSH authorized_keys populated with public key
- Container: WezTerm shell integration scripts sourced

Currently, this setup is manual or project-specific. A plugin system with host setup support would make this reusable.

## Scope

The full proposal should explore:

### Plugin Manifest Format

Plugins would include a manifest file (e.g., `plugin.lace.json` or `lace-plugin.yaml`) that declares:

```jsonc
// Example plugin manifest
{
  "name": "wezterm-integration",
  "version": "1.0.0",

  "hostSetup": {
    // Scripts run on host before container creation
    "scripts": {
      "setup": "./scripts/host-setup.sh",
      "teardown": "./scripts/host-teardown.sh"
    },

    // Files that must exist on host (setup script should create these)
    "requires": [
      { "path": "~/.ssh/lace_devcontainer", "type": "file" },
      { "path": "~/.ssh/lace_devcontainer.pub", "type": "file" }
    ],

    // Environment variables the plugin expects
    "env": {
      "WEZTERM_UNIX_SOCKET": {
        "description": "Path to WezTerm mux socket",
        "default": "/tmp/wezterm-mux-{user}"
      }
    }
  },

  "containerSetup": {
    // Lifecycle hook scripts (paths relative to plugin root)
    "postCreate": "./scripts/container-post-create.sh",
    "postStart": "./scripts/container-post-start.sh",
    "postAttach": "./scripts/container-post-attach.sh",

    // Environment to set in container
    "env": {
      "WEZTERM_SHELL_INTEGRATION": "/mnt/lace/plugins/wezterm-integration/shell/integration.sh"
    },

    // Mounts the plugin needs added
    "mounts": [
      {
        "source": "~/.ssh/lace_devcontainer.pub",
        "target": "/home/node/.ssh/authorized_keys",
        "readonly": true
      }
    ]
  }
}
```

### Security Considerations

- **Script execution trust**: Host-side scripts have full system access. How to handle trust?
  - Only run scripts from explicitly trusted plugins?
  - Require user confirmation before first run?
  - Sandboxing options?

- **Credential handling**: SSH keys and other secrets need careful handling
  - Never log secret content
  - Use appropriate file permissions (600 for private keys)
  - Clear guidance on what plugins should/shouldn't do

- **Container escape risks**: Mounted scripts could potentially be exploited
  - Recommend readonly mounts for scripts
  - Validate script content? (probably impractical)

### Lifecycle Integration

- **When does host setup run?**
  - First time: On first `lace up` after plugin is declared
  - Subsequent: Skip if requirements are met, or re-run if plugin version changes?
  - Manual: `lace plugin setup <name>` to re-run setup

- **When does host teardown run?**
  - Never automatic (dangerous)
  - Manual: `lace plugin teardown <name>`
  - Option to run on `lace down`?

- **Container lifecycle hooks**:
  - Map to devcontainer lifecycle commands (postCreateCommand, etc.)
  - Multiple plugins' hooks need merging strategy
  - Order of execution when multiple plugins have hooks

### User Override Capabilities

```jsonc
// In ~/.config/lace/settings.json
{
  "plugins": {
    "github.com/user/wezterm-integration": {
      "overrideMount": { ... },
      "hostSetup": {
        // Override specific settings
        "env": {
          "WEZTERM_UNIX_SOCKET": "/custom/path/socket"
        },
        // Disable specific setup steps
        "skipScripts": true
      }
    }
  }
}
```

### Error Handling

- Host setup script fails: Error, don't start container
- Required file missing after setup: Error with guidance
- Container script fails: Follow devcontainer lifecycle error handling
- Teardown script fails: Warn but don't block

## Open Questions

1. **Trust model**: How do users indicate they trust a plugin to run host scripts? First-run prompt? Allowlist in settings?

2. **Idempotency**: Should setup scripts be required to be idempotent? How to verify?

3. **Platform support**: Host setup scripts may need platform-specific variants (Linux, macOS, Windows). How to handle?

4. **Version migration**: When plugin version changes, how to handle setup re-run? Incremental migrations?

5. **Dependency between plugins**: Can one plugin depend on another's host setup? Probably too complex for v1.

6. **Audit/logging**: Should lace log what scripts are run and when, for security auditing?

7. **Rollback**: If setup partially succeeds then fails, can we roll back? Probably impractical.

## Prior Art

- **Devcontainer features**: `install.sh` scripts in features run in-container
- **Homebrew formulas**: `postinstall` scripts run on host
- **Docker entrypoint scripts**: Container-side initialization patterns
- **Ansible playbooks**: Declarative host configuration with idempotency expectations
- **VS Code extension activation**: Lifecycle hooks for extension setup

## Success Criteria for Full Proposal

1. Plugin manifest schema with host and container setup sections
2. Security model documentation (trust, permissions, sandboxing)
3. Lifecycle integration specification (when scripts run, ordering)
4. Error handling and recovery procedures
5. User override/customization capabilities
6. Test plan covering setup, teardown, and lifecycle hooks
7. Implementation phases with clear milestones
8. Migration path for existing manual setups (like WezTerm in lace)
