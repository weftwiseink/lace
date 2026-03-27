---
first_authored:
  by: "@claude-opus-4-6-20250725"
  at: 2026-03-26T17:00:00-07:00
task_list: sprack/metadata-writer
type: devlog
state: live
status: done
tags: [sprack, devcontainer, container]
---

# Sprack Metadata Writer Implementation

> BLUF: Implement the container-side metadata writer that writes git state to `/mnt/sprack/metadata/state.json` on every prompt.
> Gate it behind `enableMetadataWriter` feature option (default: true).
> Use `/etc/profile.d/` for bash and `/usr/local/bin/sprack-metadata-writer` as the shared script.
> Nushell integration uses a separate `.nu` env file sourced via nushell's config mechanism.

## Assessment

### Is installing a PROMPT_COMMAND hook by default reasonable?

Yes, with caveats.
The git operations (`rev-parse --abbrev-ref HEAD`, `rev-parse --short HEAD`, `diff --quiet`) are fast: 10-30ms total on warm caches.
This is well within acceptable prompt latency for development containers where git is the primary workflow.
The hook guards against non-git directories (bails early if `rev-parse` fails), so outside a repo it adds negligible overhead.

### Risks

1. **Nushell interference**: `/etc/profile.d/` scripts are bash/posix-sourced; nushell does not source them.
   The bash `PROMPT_COMMAND` assignment is harmless to nushell: it never sees it.
   Nushell needs a separate hook mechanism (`$env.config.hooks.pre_prompt`), but this requires writing to a `.nu` file, not profile.d.
   For this implementation: bash gets profile.d, nushell gets a separate env file.

2. **`git diff --quiet` on large repos**: Can be 50-100ms on large repos with many untracked files.
   Mitigated by using `git diff --quiet HEAD` which only checks the index vs HEAD, not untracked files.
   Further mitigation available via throttling (not implemented in this phase).

3. **Concurrent writes**: Multiple shells in the same container could race on `state.json`.
   Since each write is a single `printf > file` (atomic on most filesystems for small writes), this is acceptable.
   The file reflects "most recent prompt", which is the correct semantic.

### profile.d vs entrypoint

profile.d is correct.
An entrypoint script runs once at container start, but the metadata writer needs to run on every prompt.
profile.d scripts are sourced by login shells, which sets up `PROMPT_COMMAND` for every bash session.
The script itself (`/usr/local/bin/sprack-metadata-writer`) is also installed for direct invocation or nushell integration.

## Changes

### 1. Feature option in devcontainer-feature.json

Added `enableMetadataWriter` boolean option (default: true).

### 2. Metadata writer script

`/usr/local/bin/sprack-metadata-writer`: standalone script that writes `state.json`.
Includes `container_name` from `$HOSTNAME`.
Uses `git rev-parse` (fast) instead of `git status` (slow).

### 3. Bash integration via profile.d

`/etc/profile.d/sprack-metadata.sh`: sources on bash login, appends `__sprack_metadata` to `PROMPT_COMMAND`.
Gated behind `$BASH_VERSION` check so it's harmless for other shells.

### 4. Nushell integration

`/etc/nushell/sprack-hooks.nu`: defines a `pre_prompt` hook that calls the metadata writer.
Nushell's `$env.config.hooks.pre_prompt` accepts closures; we append one that calls the external script.

> NOTE(opus/sprack-metadata-writer): Nushell env files under `/etc/nushell/` are not automatically sourced.
> The user's nushell config (or chezmoi-managed dotfiles) must explicitly source this file.
> This is consistent with how lace-fundamentals handles nushell: the feature sets the shell, but config comes from dotfiles.

## Mount Auto-Creation Investigation

The user reported a potential bug: the mount resolver should `mkdir -p` the source directory when `${lace.projectName}` is used with `sourceMustBe: "directory"`.

Investigation shows this is already implemented correctly in `resolveValidatedSource()` (mount-resolver.ts line 343):
```
if (decl.sourceMustBe === "directory" && !existsSync(expandedPath) && !expandedPath.includes("${"))
```
The auto-creation:
1. Only applies to `sourceMustBe: "directory"` (not files).
2. Skips paths with unresolved `${...}` variables.
3. Creates recursively with `mkdirSync(expandedPath, { recursive: true })`.

The test suite has an explicit test case ("auto-creates recommended directory source when it does not exist") at line 1072 that verifies this behavior.
All 61 mount-resolver tests pass.

## Issues Encountered and Solved

1. **`$HOSTNAME` not set in `/bin/sh`**: The metadata writer uses `#!/bin/sh`, where `$HOSTNAME` is a bash-ism not guaranteed to be set.
   Fixed by adding `$(hostname 2>/dev/null || echo unknown)` as a fallback.

2. **Concurrent `lace up --rebuild`**: Two rebuild processes caused a podman storage race condition.
   The user's terminal build succeeded; our background build failed with "identifier is not a container" from podman's overlay storage.
   Not a code issue: operator error from running two rebuilds simultaneously.

## Verification

Verified in the running `lace` container:

```
$ podman exec -w /workspaces/lace/main lace /usr/local/bin/sprack-metadata-writer
$ podman exec lace cat /mnt/sprack/metadata/state.json
{"ts":"2026-03-27T00:54:06Z","container_name":"7b16a9004b7c","workdir":"/workspaces/lace/main","git_branch":"main","git_commit_short":"1f87505","git_dirty":true}
```

Host-side mount verified:
```
$ cat ~/.local/share/sprack/lace/lace/metadata/state.json
{"ts":"2026-03-27T00:54:06Z","container_name":"7b16a9004b7c","workdir":"/workspaces/lace/main","git_branch":"main","git_commit_short":"1f87505","git_dirty":true}
```

> NOTE(opus/sprack-metadata-writer): The profile.d and nushell hooks were not verified end-to-end because the container was built before the metadata writer commit.
> A full rebuild would install them.
> The standalone script was manually copied and verified to confirm the core functionality works.
