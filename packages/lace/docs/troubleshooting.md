# Troubleshooting Guide

Common failure modes for `lace up` and other lace commands, organized by
symptom. Each entry includes the actual error message from the source code,
the cause, and how to fix it.

---

## 1. Port allocation exhaustion

**Symptom:** `lace up` fails with:

```
All ports in range 22425-22499 are in use.
Active assignments:
  sshd/port: 22430
  ...
```

**Cause:** All 75 ports in the lace allocation range (22425-22499) are
either assigned to other lace projects or occupied by other services on
the host.

**Fix:**

1. Check for stale assignments:
   ```sh
   cat .lace/port-assignments.json
   ```
   Delete the file to force reassignment on next `lace up`.

2. Check what is using ports in the range:
   ```sh
   ss -tlnp | grep '224[2-9][0-9]'
   ```

3. Stop containers from other lace projects that are not in use.

---

## 2. Stale feature metadata cache

**Symptom:** Feature options or port/mount declarations have changed
upstream, but lace still uses old values (wrong schema, missing
declarations).

**Cause:** Floating tag cache (24h TTL) is serving stale
`devcontainer-feature.json` data from `~/.config/lace/cache/features/`.
Pinned versions (exact semver, digest refs) are cached permanently.

**Fix:**

- Use the `--no-cache` flag to bypass floating tag cache:
  ```sh
  lace up --no-cache
  ```

- Or delete the cache manually:
  ```sh
  rm -rf ~/.config/lace/cache/features/
  ```

---

## 3. Prebuild image missing after Docker prune

**Symptom:** `lace up` logs:

```
Prebuild image missing (lace.local/node:24-bookworm). Rebuilding...
```

Or `devcontainer up` fails because the Dockerfile's FROM line references a
`lace.local/` image that no longer exists.

**Cause:** The prebuild image was pruned by `docker system prune` or
`docker image prune`. The `lace.local/` images are local-only and are not
protected from pruning.

**Fix:**

1. If lace detects the missing image during `lace up`, it automatically
   triggers a full rebuild. No manual action is needed.

2. If the error comes from `devcontainer up` directly (outside lace):
   ```sh
   lace restore          # Revert Dockerfile FROM to original
   lace prebuild --force # Rebuild the prebuild image
   lace up
   ```

3. Check prebuild state:
   ```sh
   lace status
   ```

---

## 4. Docker auto-creates directory instead of file mount

**Symptom:** A feature expects a file (e.g., an SSH public key) but the
container sees an empty directory at that path instead.

**Cause:** The bind-mount source path does not exist on the host. Docker's
default behavior is to auto-create missing bind-mount sources as empty
root-owned directories, even when the target should be a file.

Lace warns about this after template resolution:

```
Warning: Bind mount source does not exist: /home/user/.ssh/id_ed25519.pub (target: /home/node/.ssh/authorized_keys)
  -> Docker will auto-create this as a root-owned directory, which may cause permission issues.
```

**Fix:**

- **For declared mounts:** Add `sourceMustBe: "file"` (or `"directory"`)
  to the mount declaration. This makes lace validate the source before
  template resolution and abort with an actionable error instead of letting
  Docker silently create a directory:

  ```
  wezterm-server requires file: /home/user/.ssh/id_ed25519.pub
         (SSH public key for container access)

    To create it:
      ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''

    To use a different path, add to ~/.config/lace/settings.json:
      { "mounts": { "wezterm-server/authorized-keys": { "source": "/path/to/your/file" } } }
  ```

- **For static mounts:** Create the source file on the host before running
  `lace up`.

---

## 5. Template resolution errors (unknown expression)

**Symptom:** `lace up` fails with:

```
Template resolution failed: Unknown template variable: ${lace.prot(sshd/port)}.
Supported templates: ${lace.port(featureId/optionName)}, ${lace.mount(namespace/label)},
${lace.mount(namespace/label).source}, ${lace.mount(namespace/label).target}.
```

**Cause:** A `${lace.*}` expression in the devcontainer.json uses an
unrecognized function name. This is a hard error -- lace rejects any
`${lace.*}` that is not `port()` or `mount()` to catch typos and stale
references.

**Fix:**

- Check the expression for typos. Valid forms are:
  - `${lace.port(featureId/optionName)}`
  - `${lace.mount(namespace/label)}`
  - `${lace.mount(namespace/label).source}`
  - `${lace.mount(namespace/label).target}`

- If you upgraded from an older version of lace, check for stale syntax.

---

## 6. Mount uses default path instead of expected data

**Symptom:** The container starts but feature data is missing. For example,
Claude Code config is not available, or bash history is empty. The `lace up`
output shows:

```
Mount configuration:
  project/claude-config: using default path /home/user/.config/lace/myproject/mounts/project/claude-config
    -> Optional: configure source to ~/.claude in settings.json
```

**Cause:** No settings override is configured for the mount. Lace created
an auto-managed empty directory under `~/.config/lace/` as the mount
source. The feature works but has no pre-existing data.

**Fix:**

Read the guided configuration output from `lace up` and add overrides to
`~/.config/lace/settings.json`:

```jsonc
{
  "mounts": {
    "project/claude-config": { "source": "~/.claude" }
  }
}
```

Override paths must exist on disk. Tilde (`~`) is expanded to `$HOME`.
After adding the override, the next `lace up` uses the configured path.

---

## 7. Workspace layout mismatch

**Symptom:** `lace up` fails with:

```
Workspace layout failed: Workspace layout "bare-worktree" declared but
/home/user/code/project is a normal git clone. Remove the workspace.layout
setting or convert to the bare-worktree convention.
```

**Cause:** The devcontainer.json declares `"layout": "bare-worktree"` in
`customizations.lace.workspace`, but the actual workspace directory is a
normal git clone (`.git` is a directory, not a file pointing to a bare
repo).

**Fix:**

- If you are not using bare-worktree repos, remove the `workspace` block
  from `customizations.lace`:
  ```jsonc
  "customizations": {
    "lace": {
      // remove: "workspace": { "layout": "bare-worktree" }
    }
  }
  ```

- If you want bare-worktree layout, set up the nikitabobko convention. See
  the [Workspace layout](../README.md#workspace-layout) section of the
  README.

- To proceed temporarily despite the mismatch:
  ```sh
  lace up --skip-validation
  ```

---

## 8. Feature metadata fetch failures (network/OCI)

**Symptom:** `lace up` fails with:

```
Failed to fetch metadata for feature "ghcr.io/devcontainers/features/sshd:1":
devcontainer CLI exited with code 1: <error details>.
This indicates a problem with your build environment (network, auth, or registry).
Use --skip-metadata-validation to bypass this check.
```

Other variants include `annotation_invalid` (malformed OCI annotation) and
`blob_fallback_failed` (both annotation and tarball extraction failed).

**Cause:** Lace cannot reach the OCI registry, the registry is rate-limiting
requests, authentication is failing, or the feature is not published.

**Fix:**

1. For offline or emergency use, bypass metadata validation:
   ```sh
   lace up --skip-metadata-validation
   ```
   This skips option validation and auto-injection but allows `lace up` to
   proceed with manually specified template expressions.

2. Check the feature ID spelling -- a typo produces a fetch failure.

3. Test the feature reference directly:
   ```sh
   devcontainer features info manifest ghcr.io/devcontainers/features/sshd:1
   ```

4. Check network connectivity and registry status.

---

## 9. Mount namespace validation errors

**Symptom:** `lace up` fails with:

```
Mount validation failed: Unknown mount namespace(s): "foo/data".
Valid namespaces: project, sshd, wezterm-server
```

**Cause:** A mount declaration or template uses a namespace (the part
before `/` in the label) that does not match `project` or any feature's
short ID present in the config.

**Fix:**

- For project-level mounts, use the `project/` prefix:
  ```jsonc
  "customizations": {
    "lace": {
      "mounts": {
        "my-data": { "target": "/data" }
      }
    }
  }
  ```
  This becomes `project/my-data` in the template system.

- For feature-level mounts, the namespace must match the feature's short
  ID. The short ID is the last path segment of the feature reference with
  the version stripped (e.g., `ghcr.io/devcontainers/features/sshd:1`
  has short ID `sshd`).

- Check that the feature is listed in either `features` or
  `customizations.lace.prebuildFeatures`.

---

## 10. Lock file contention

**Symptom:** `lace up` or `lace prebuild` fails immediately with:

```
Another lace operation is already running.
```

**Cause:** Another `lace up` or `lace prebuild` process holds the flock on
`.lace/prebuild.lock`. Lace uses non-blocking `flock(1)` for mutual
exclusion.

**Fix:**

1. Check if another lace process is running:
   ```sh
   ps aux | grep lace
   ```

2. If a previous lace process was killed or crashed, the lock file may be
   stale. The lock is released when the process exits (even abnormally),
   since flock is held via file descriptor, not the lock file's existence.
   However, if the process is still running in the background, the lock is
   still held.

3. If you are certain no other lace process is running, the lock should
   have been released. Try running `lace up` again. If the error persists,
   check for zombie processes holding the file descriptor.

> Note: If `flock(1)` is not available on the system, lace degrades
> gracefully and proceeds without locking, printing:
> `Warning: flock not available, proceeding without lock.`

---

## 11. Claude Code asks to sign in inside container

**Symptom:** Claude Code shows the onboarding or sign-in wizard inside the
container, despite `~/.claude` being bind-mounted from the host.

**Cause:** When `CLAUDE_CONFIG_DIR` is set (e.g., to `/home/node/.claude`),
Claude Code reads `.claude.json` from `$CLAUDE_CONFIG_DIR/.claude.json` —
inside the config directory. On the host, this file lives at `~/.claude.json`
— a sibling file outside the `~/.claude/` directory. The directory bind mount
does not include it, so the container's copy is missing the
`hasCompletedOnboarding` flag.

**Fix:**

Add a file mount declaration that overlays the host's `.claude.json` into
the config directory:

```jsonc
// In customizations.lace.mounts (devcontainer.json)
"claude-config-json": {
  "target": "/home/node/.claude/.claude.json",
  "recommendedSource": "~/.claude.json",
  "sourceMustBe": "file",
  "description": "Claude Code state (onboarding, account cache)",
  "hint": "Run 'claude' on the host first to create this file"
}
```

This overlays the host file onto the directory mount. The
`sourceMustBe: "file"` validation ensures the source exists as a file before
container creation. See [Tool integration patterns](../README.md#tool-integration-patterns)
in the README.

---

## 12. Tool plugins or extensions fail to load with path errors

**Symptom:** A tool inside the container reports that plugins, extensions,
or registries cannot be found, even though the tool's config directory is
bind-mounted from the host. For Claude Code, this appears as:

```
Plugin cdocs not found in marketplace clauthier
```

Other tools may report similar path-not-found errors for registries,
credential stores, or workspace references.

**Cause:** The tool's config files (bind-mounted from the host) contain
absolute host paths — project directories, marketplace locations, plugin
install paths — that do not exist inside the container's filesystem
namespace. The files arrive via bind mount with the host paths baked in.

**Fix:**

Two approaches depending on the tool:

1. **Prefer network-backed references** when available. For Claude Code
   plugins, install from a GitHub-backed marketplace instead of a local
   directory:
   ```sh
   claude plugin install cdocs@weft-marketplace --scope project
   ```
   GitHub marketplaces cache their manifests inside `~/.claude/`, which is
   already bind-mounted.

2. **Mirror the host path** using a repo mount with `overrideMount.target`
   set to the exact host path:
   ```jsonc
   // In ~/.config/lace/settings.json
   {
     "repoMounts": {
       "github.com/user/tool-registry": {
         "overrideMount": {
           "source": "~/code/tool-registry",
           "target": "/var/home/user/code/tool-registry"
         }
       }
     }
   }
   ```
   This makes the host path resolve inside the container. The repo must also
   be declared in `customizations.lace.repoMounts` in the project's
   devcontainer.json.

> Note: Avoid directly editing bind-mounted config files (like
> `installed_plugins.json`) to add container-specific paths. The file is
> shared between host and container — changes from one side affect the other.
