---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-12T00:30:00-06:00
task_list: lace/devcontainer-config
type: proposal
state: live
status: request_for_proposal
tags: [remoteUser, _REMOTE_USER, mount-resolver, dockerfile-parsing, devcontainer]
related_to:
  - cdocs/proposals/2026-03-07-remote-user-resolution-in-mount-targets.md
  - cdocs/devlogs/2026-03-11-weftwise-post-migration-fixes.md
---

# Resolve `_REMOTE_USER` Through `build.args` for ARG-Variable USER Directives

> BLUF: `extractRemoteUser()` silently falls back to `"root"` when the
> Dockerfile uses `USER ${USERNAME}` with an ARG variable, even though the
> devcontainer.json's `build.args` contains the resolved value. This causes
> feature-declared mount targets to resolve to `/home/root/` instead of
> `/home/node/`, producing broken mounts with no warning. The fix is to
> cross-reference `build.args` when `parseDockerfileUser` encounters an ARG
> reference.
>
> - **Motivated by:**
>   `cdocs/devlogs/2026-03-11-weftwise-post-migration-fixes.md` (discovered
>   during implementation; required manual `remoteUser: "node"` workaround)

## Objective

Eliminate the silent `root` fallback for the common Dockerfile pattern
`ARG USERNAME=node` / `USER ${USERNAME}` by teaching `extractRemoteUser()`
to resolve ARG references using the devcontainer.json's `build.args`.

Currently, `parseDockerfileUser()` (in `dockerfile.ts:277-302`) returns `null`
when the `USER` directive contains a `$` character (line 292), and
`extractRemoteUser()` (in `devcontainer.ts:363-387`) falls through to the
default `"root"`. The `_REMOTE_USER` resolution proposal (`2026-03-07`)
explicitly scoped out ARG expansion as a design constraint:

> "ARG expansion is out of scope -- detect and skip ARG/ENV references in
> USER arguments."

This was reasonable for the initial implementation, but the practical
consequence is a silent failure mode: mount targets resolve to `/home/root/`
instead of the intended user's home directory. The weftwise post-migration
implementation (`2026-03-11`) hit this exact issue. The workaround was
adding `"remoteUser": "node"` to the devcontainer.json, but this is
redundant with information already present in the config (`build.args`
contains `"USERNAME": "node"`).

Both lace repos affected by this today:

| Repo | Dockerfile `USER` | `build.args` | Current workaround |
|------|-------------------|--------------|-------------------|
| weftwise | `USER ${USERNAME}` | `"USERNAME": "node"` | `"remoteUser": "node"` (added 2026-03-11) |
| lace | `USER ${USERNAME}` | `"USERNAME": "node"` | Project-level mounts with hardcoded targets (no feature-level `_REMOTE_USER` mounts) |

The `ARG USERNAME=node` / `USER ${USERNAME}` pattern is widespread in
devcontainer Dockerfiles (it's the standard approach for making the
container username configurable). Any new project adopting lace with this
pattern will hit the same silent failure.

## Scope

The full proposal should explore:

- **ARG resolution via `build.args`**: Enhance `extractRemoteUser()` to
  pass `build.args` from the devcontainer.json into `parseDockerfileUser()`
  (or a new resolution step between tiers 2 and 3). When `USER ${VAR}` is
  found and `VAR` exists in `build.args`, use that value.

- **ARG resolution via Dockerfile defaults**: As a fallback when `build.args`
  doesn't contain the variable, parse `ARG VAR=default` from the Dockerfile
  itself. The `dockerfile-ast` parser (already imported) provides access to
  ARG instructions and their default values.

- **Resolution order**: The enhanced chain would be:
  1. Explicit `remoteUser` field (unchanged, highest priority)
  2. Dockerfile `USER` with literal value (unchanged)
  3. **New**: Dockerfile `USER ${VAR}` resolved via `build.args`
  4. **New**: Dockerfile `USER ${VAR}` resolved via `ARG VAR=default`
  5. Default `"root"` (unchanged, lowest priority)

- **Warning on unresolvable ARG references**: If `USER` contains an ARG
  reference that can't be resolved through either `build.args` or Dockerfile
  defaults, emit a warning before falling back to `root`. The current
  behavior is completely silent.

- **Whether `remoteUser` workarounds become unnecessary**: If implemented,
  the explicit `"remoteUser": "node"` in weftwise's devcontainer.json
  becomes redundant (tier 1 and tier 3/4 would agree). Assess whether to
  remove it or keep it as defensive documentation.

- **`lace-discover` parity**: The runtime counterpart (`bin/lace-discover`)
  resolves the remote user from container metadata (where ARGs are already
  resolved). Verify that the enhanced config-time resolution produces
  results consistent with runtime discovery.

- **Test coverage**: The existing test at `devcontainer.test.ts:529-539`
  asserts that `USER ${USERNAME}` returns `"root"`. This test would need to
  change to assert `"node"` when `build.args` provides the value.

## Open Questions

**Q1: Should `parseDockerfileUser` handle ARG resolution itself, or should
it remain a pure Dockerfile parser with resolution happening in
`extractRemoteUser`?**

My recommendation: keep `parseDockerfileUser` pure. It should return the raw
value (including the `$` reference) and let `extractRemoteUser` handle
resolution with the additional context from `build.args`. This maintains
separation of concerns: Dockerfile parsing vs. devcontainer config
resolution.

Concretely, `parseDockerfileUser` would return `"${USERNAME}"` instead of
`null`, and `extractRemoteUser` would detect the `$` prefix and attempt
resolution via `build.args` then Dockerfile ARG defaults.

**Q2: How should `${VAR:-default}` and `${VAR:+alt}` shell parameter
expansion syntax be handled?**

Dockerfiles support shell-style parameter expansion in ARG/ENV values.
The common case is plain `${VAR}`, but `${VAR:-default}` (use default if
unset) is also used. The proposal should specify which expansion forms are
supported and which are treated as unresolvable.

My recommendation: support `${VAR}` and `${VAR:-default}` only. These
cover the vast majority of real-world usage. More complex forms (`${VAR:+}`
, `${VAR%pattern}`, etc.) should remain unresolvable with a warning.

**Q3: Should lace warn when `remoteUser` is absent and `USER` uses an ARG,
even if resolution succeeds?**

There's an argument for a soft lint: "Consider adding `remoteUser: node` to
your devcontainer.json for clarity." This makes the resolved user visible
in the config rather than requiring readers to trace through Dockerfile
ARGs. But it's also noisy for a pattern that works correctly.

My recommendation: no warning when resolution succeeds. Only warn on
fallback to `"root"` (i.e., when the ARG reference is truly unresolvable).

## Prior Art

- **devcontainer CLI**: Resolves the container user at runtime from the
  actual container metadata (`docker inspect`). At config-generation time,
  it does not attempt ARG expansion.

- **`_REMOTE_USER` resolution proposal** (`2026-03-07`): Established the
  three-tier resolution chain and explicitly scoped out ARG expansion.
  Edge case E2 documents the `USER ${USERNAME}` scenario and chose to
  fall through to `root`.

- **`dockerfile-ast`**: The parser library already used by
  `parseDockerfileUser` exposes `getArguments()` on all instruction types,
  including `ARG`. Parsing `ARG USERNAME=node` to extract the variable name
  and default value is straightforward.

## Known Requirements

- Both lace and weftwise use `ARG USERNAME=node` / `USER ${USERNAME}` with
  `"build": { "args": { "USERNAME": "node" } }`. This is the primary
  pattern to support.

- The `_REMOTE_USER` resolution is used in mount target substitution
  (`mount-resolver.ts:121`), `CLAUDE_CONFIG_DIR` template resolution, and
  the `containerEnv` template system. All paths that consume the resolved
  user benefit from correct resolution.

- The `lace-discover` runtime resolver already produces the correct user
  (it inspects the running container). The config-time resolver should
  agree with it.
