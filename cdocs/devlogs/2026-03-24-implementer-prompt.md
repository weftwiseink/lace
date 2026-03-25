---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-24T21:00:00-07:00
task_list: lace/user-config-and-fundamentals
type: devlog
state: live
status: wip
tags: [lace, user_config, devcontainer_features, handoff, prompt]
---

# Implementer Prompt: User-Level Config and Fundamentals Feature

> BLUF: This document is a prompt to paste into a fresh Claude Code session.
> It instructs the implementer to build user-level config (`user.json`) and the `lace-fundamentals` devcontainer feature.

Below the `---` line is the prompt text.

---

## Your Task

You are implementing two accepted proposals for the lace devcontainer orchestration system.
Lace is a CLI that preprocesses `devcontainer.json` files, managing mounts, ports, features, and prebuilds.
The codebase is TypeScript (Node.js), built with Vite, tested with Vitest.

### What to implement

**Deliverable 1: User-level config (`~/.config/lace/user.json`)**
A declarative config file for users to specify universal mounts, prebuild features, git identity, default shell, and env vars across all lace projects.

**Deliverable 2: `lace-fundamentals` devcontainer feature**
A consolidated feature bundling SSH hardening, git identity, chezmoi/dotfiles integration, default shell, and baseline tools.

### Primary specs

Read these two proposals in full before writing any code.
They are the authoritative specs: every design decision, edge case, test requirement, and implementation phase is documented there.

- `cdocs/proposals/2026-03-24-lace-user-level-config.md` (accepted, round 4)
- `cdocs/proposals/2026-03-24-lace-fundamentals-feature.md` (accepted, round 4)

### Handoff devlog

Read this for build/test commands, key source files, and critical design gotchas:

- `cdocs/devlogs/2026-03-24-user-config-fundamentals-handoff.md`

### Supporting context (read as needed)

- `cdocs/reports/2026-03-24-user-config-fundamentals-design-decisions.md` (design rationale)
- `cdocs/reports/2026-03-24-user-level-devcontainer-config-approaches.md` (research background)
- `cdocs/devlogs/2026-03-24-user-config-and-fundamentals-feature.md` (planning session history)

## How to Work

### Start with a devlog

Create a devlog at `cdocs/devlogs/YYYY-MM-DD-user-config-fundamentals-implementation.md` using `/cdocs:devlog`.
Update it as you go: it is the single source of truth for your work.

### Implementation order

Implement user-level config first (fundamentals depends on it).
Follow the phased approach from each proposal.
Within each phase, the cycle is:

1. **Write tests first** for the phase's success criteria.
2. **Implement** until tests pass.
3. **Run the full suite** (`pnpm test` in `packages/lace/`) to verify no regressions.
4. **Run typecheck** (`pnpm run typecheck`).
5. **Commit** the phase.
6. **Update the devlog** with what you built, what worked, what didn't.

### Testing is paramount

This is a security-sensitive feature (mount validation, denylist, credential protection).
Every security constraint must have a test.
Every edge case in the proposals must have a test.

**Test-first, always.** Write the test, watch it fail, implement, watch it pass.

Use the existing scenario test infrastructure:
```typescript
import { createScenarioWorkspace, writeDevcontainerJson, ... } from "./helpers/scenario-utils";
```

Study these reference tests before writing your own:
- `src/__tests__/claude-code-scenarios.test.ts` (mount auto-injection, settings overrides)
- `src/__tests__/neovim-scenarios.test.ts` (mount-only features)
- `src/lib/__tests__/metadata.test.ts` (unit test patterns)

### Iterative verification against lace CLI

After each major phase, verify manually against the real lace CLI:

```bash
cd /workspaces/lace/main/packages/lace
pnpm run build

# Create a test user.json
mkdir -p ~/.config/lace
cat > ~/.config/lace/user.json << 'EOF'
{
  "mounts": {
    "test-mount": {
      "source": "/tmp/lace-test-mount",
      "target": "/mnt/user/test",
      "description": "Test mount for verification"
    }
  },
  "git": {
    "name": "Test User",
    "email": "test@example.com"
  },
  "defaultShell": "/usr/bin/nu"
}
EOF

mkdir -p /tmp/lace-test-mount

# Run lace up in dry-run mode (skipDevcontainerUp) or inspect generated config
npx lace up --workspace-folder /workspaces/lace/main
cat /workspaces/lace/main/.lace/devcontainer.json | jq .
```

Check that:
- User mounts appear in the generated config with `readonly` in the mount spec.
- User features appear in the features section.
- `LACE_GIT_NAME`/`LACE_GIT_EMAIL` appear in containerEnv.
- The `user/` namespace mounts pass validation.

### When you get stuck

Use the 4-phase debugging process:
1. **Root cause investigation**: check each component boundary (does `loadUserConfig()` return the right object? does `mergeUserMounts()` produce correct declarations? does `validateMountNamespaces()` accept them?).
2. **Pattern analysis**: compare with how project mounts flow through the same pipeline.
3. **Hypothesis testing**: one variable at a time, with console.log or debugger.
4. **Fix and verify**: run the specific test, then the full suite.

If 3+ attempts fail on the same issue, step back and question the architectural assumption.
Document what you tried in the devlog.

### Commits

Commit after each completed phase.
Use descriptive messages: `feat(lace): add user-config types and loading (phase 1)`.

### What NOT to do

- Do not skip tests or defer them to "later."
- Do not modify the proposals (they are accepted specs).
- Do not change test infrastructure (`scenario-utils.ts`) unless absolutely necessary.
- Do not add features beyond what the proposals specify.
- Do not mount `~/.gitconfig` or inject `GIT_AUTHOR_NAME` as containerEnv (see handoff devlog for why).

## Critical Gotchas

These caused bugs during proposal review.
Read the handoff devlog for full explanations.

1. **Git identity uses `LACE_GIT_NAME`/`LACE_GIT_EMAIL`**, NOT `GIT_AUTHOR_NAME`. The init script reads these to write `~/.gitconfig`. Injecting `GIT_AUTHOR_NAME` as containerEnv breaks project-level identity override.

2. **Mount policy prefix matching is path-aware**: `~/.ssh` matches `~/.ssh/config` but NOT `~/.sshrc`. Requires `/` separator boundary check.

3. **`validateMountNamespaces()` at `template-resolver.ts:329`** must add `"user"` to the valid namespace set. Without this, all user mounts are rejected.

4. **User mount missing source = warning + skip**, not error. This differs from project mounts (which error).

5. **Screenshots mount target is `/mnt/lace/screenshots`**, not `/mnt/user/screenshots` (avoids conflict with `user/` namespace mounts).

6. **The `dotfilesPath` feature option was removed.** The init script reads `LACE_DOTFILES_PATH` env var at runtime instead.

## Verification Checklist

Before declaring implementation complete, verify ALL of these:

### User-level config
- [ ] `loadUserConfig()` returns typed config from `~/.config/lace/user.json`
- [ ] Missing `user.json` returns empty config (no error)
- [ ] Malformed `user.json` throws `UserConfigError` with parse offset
- [ ] `LACE_USER_CONFIG` env var overrides file location
- [ ] Mount policy blocks `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/`, Docker socket
- [ ] Mount policy allows `~/Documents`, `~/Pictures/Screenshots`
- [ ] Mount policy `!` exceptions work (last-match-wins)
- [ ] Symlink traversal: `~/innocent` -> `~/.ssh/` is blocked after `realpath()`
- [ ] Path-aware prefix matching: `~/.ssh` does NOT match `~/.sshrc`
- [ ] Local path features (`./`, `../`, `/absolute/`) are rejected
- [ ] User mounts get `user/` namespace prefix and forced `readonly: true`
- [ ] `validateMountNamespaces()` accepts `user/` namespace
- [ ] Mount target conflicts between user and project mounts are hard errors
- [ ] Feature conflicts: project options override user options
- [ ] `LACE_GIT_NAME`/`LACE_GIT_EMAIL` in containerEnv (NOT `GIT_AUTHOR_NAME`)
- [ ] Missing mount source on host: warning + skip (not error)
- [ ] `lace up` with `user.json` produces correct generated config
- [ ] `lace up` without `user.json` behaves identically to current behavior

### Fundamentals feature
- [ ] `devcontainer-feature.json` has correct `dependsOn` (sshd + git)
- [ ] `customizations.lace.mounts` declares authorized-keys, dotfiles, screenshots
- [ ] `customizations.lace.ports` declares sshPort
- [ ] `install.sh` sources step scripts in correct order
- [ ] SSH hardening: 7 directives verified in sshd_config
- [ ] `AllowTcpForwarding local` (not `no`)
- [ ] Chezmoi installed and available
- [ ] `lace-fundamentals-init` script created at `/usr/local/bin/`
- [ ] Init script reads `LACE_GIT_NAME`/`LACE_GIT_EMAIL` for gitconfig
- [ ] Init script reads `LACE_DOTFILES_PATH` for chezmoi apply
- [ ] Init script handles missing env vars gracefully (no errors)
- [ ] `chsh` called when `defaultShell` is set, warning on failure
- [ ] Staples installed: curl, jq, less (if not already present)
- [ ] Full test suite green: `pnpm test`
- [ ] Typecheck clean: `pnpm run typecheck`
- [ ] Manual `lace up` produces correct generated config

Paste all test output and build output into the devlog verification section.
No completion claims without evidence.
