---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T11:00:00-08:00
revisions:
  - by: "@claude-opus-4-6"
    at: 2026-02-05T16:00:00-08:00
    note: "Address review feedback: document reverse_project_path lossiness and encoding collision risk (blocking); fix Finding 5 contradiction, qualify OCaml version, label pseudocode, add claude-search, note third-party tap, promote claude-clean interaction to challenges, note source build time cost (non-blocking)"
type: report
state: live
status: revised
tags: [claude-tools, session-portability, devcontainer, lace-plugins, cross-project]
---

# Streamlining claude-tools for Cross-Project Use in Lace Devcontainers

> BLUF: claude-tools (https://github.com/dlond/claude-tools) is an OCaml-based suite of five Unix-style CLI utilities (`claude-ls`, `claude-cp`, `claude-mv`, `claude-rm`, `claude-clean`; a sixth, `claude-search`, is planned) that operate on Claude Code session files stored in `~/.claude/projects/`. The tools use a path-encoding scheme that maps filesystem paths to directory names by replacing `/` with `-`. This encoding is the central challenge for cross-container session portability: host sessions live under `-var-home-mjr-code-weft-lace` while container sessions live under `-workspaces-lace` (or similar), making them invisible to each other. The recommended approach is: (1) install claude-tools as pre-built binaries inside lace containers via a postCreateCommand or devcontainer feature, (2) bind-mount `~/.claude/` from host as already designed in the claude bundling report, and (3) introduce a `lace session` subcommand that wraps `claude-cp`/`claude-mv` with automatic path remapping between host and container encodings. This avoids modifying claude-tools itself while giving users seamless session portability.

---

## 1. Executive Summary

Claude Code stores conversations as JSONL files in `~/.claude/projects/`, organized by path-encoded directory names. The tools in dlond/claude-tools provide a Unix-like interface for listing, copying, moving, removing, and cleaning up these session files across projects.

The core value proposition for lace users is session portability: being able to start a Claude conversation on the host, continue it in a devcontainer, and move sessions between containers. However, the path-encoding mechanism that Claude Code uses creates a fundamental mismatch between host and container paths, making sessions opaque to tools running in the "wrong" context.

This report analyzes claude-tools in detail, catalogs the session portability challenges, and recommends a layered integration strategy that works within lace's existing plugin and mount architecture.

### Key Findings

1. **claude-tools is a self-contained binary suite** with no runtime dependencies beyond a Unix environment. Installation is straightforward via pre-built binaries, Homebrew, or Nix.

2. **Path encoding is deterministic but not reversible in a cross-context way.** The encoding `replace('/', '-')` means `/var/home/mjr/code/weft/lace` becomes `-var-home-mjr-code-weft-lace`, while the same project opened from `/workspaces/lace` inside a container becomes `-workspaces-lace`. These are distinct directories in `~/.claude/projects/` with no built-in linkage.

3. **Session files are structurally portable.** The JSONL content references `sessionId` (UUID-based) and file paths within the conversation, but does not embed the project directory encoding. Copying a `.jsonl` file between project directories works, provided `sessionId` fields are updated (which `claude-cp` already does).

4. **The mount architecture from the claude bundling report (Report 2) provides the foundation.** Bind-mounting `~/.claude/` into the container makes all session data available. The gap is in addressing the path encoding mismatch, not in data availability.

5. **A layered approach provides the best UX.** A symlink bridge created at container startup gives seamless session visibility as the default, while a `lace session` subcommand provides explicit control for power users who need to copy, push, or pull sessions between contexts with full companion-directory support.

---

## 2. claude-tools Analysis

### 2.1 Tool Inventory

| Tool | Purpose | Key Operations |
|------|---------|---------------|
| `claude-ls` | List conversations in project(s) | Reads `~/.claude/projects/<encoded>/`, lists `.jsonl` files sorted by mtime |
| `claude-cp` | Copy conversation (fork with new UUID) | Reads source `.jsonl`, generates new UUID, rewrites `sessionId` via sed, appends metadata |
| `claude-mv` | Move conversation (preserve UUID) | `rename()` of `.jsonl` file, appends move metadata |
| `claude-rm` | Remove conversation | `unlink()` of `.jsonl` file |
| `claude-clean` | Clean up orphaned/stale project dirs | Scans `~/.claude/projects/`, identifies empty and stale entries, optionally removes |

**Planned**: The upstream project also lists `claude-search` as a planned sixth tool for full-text search across conversations. It is not yet implemented as of v1.0.1.

### 2.2 Architecture

claude-tools is built in OCaml (5.x; the exact minimum version is not specified in the upstream README but can be inferred from the Nix flake or opam configuration) using the `dune` build system. The shared logic lives in `lib/cvfs.ml` (Claude Virtual Filesystem), which implements:

- **Path resolution**: `resolve_path` normalizes paths (tilde expansion, symlink resolution via `Unix.realpath`, `.`/`..` squashing)
- **Project path encoding**: `project_path` maps a resolved filesystem path to `~/.claude/projects/<encoded>` by replacing `/` with `-`
- **Reverse mapping**: `reverse_project_path` reverses the encoding (replace `-` with `/`) for display purposes. **Upstream limitation**: this reversal is lossy -- directory names containing hyphens are indistinguishable from path separators in the encoded form. For example, a project at `/home/user/my-project` encodes to `-home-user-my-project`, but the reverse decoding produces `/home/user/my/project` (the hyphen in `my-project` is treated as a separator). This means `claude-ls` display output may show incorrect decoded paths for hyphenated directory names. The forward encoding remains deterministic and correct; only the reverse display is ambiguous.
- **Session discovery**: `list` reads `.jsonl` files from the project directory, extracts summaries from `"type":"summary"` JSON lines
- **Copy with UUID rewrite**: `copy_conversation` generates a new `Uuidm.v4` UUID, copies the file, appends metadata, then uses `sed -i` to rewrite all `sessionId` fields

### 2.3 Dependencies

**Runtime dependencies**: None beyond standard Unix (libc). The tools are statically compiled OCaml binaries.

**Build dependencies** (for source builds):
- OCaml 5.x (exact minimum version unverified from upstream README; inferred from Nix flake)
- dune 3.20+
- yojson (JSON parsing)
- cmdliner (CLI argument parsing)
- uuidm (UUID generation)
- alcotest (testing, dev-only)

### 2.4 Installation Methods

| Method | Command | Platform | Notes |
|--------|---------|----------|-------|
| **curl installer** | `curl -sSL https://raw.githubusercontent.com/dlond/claude-tools/main/install.sh \| bash` | Linux x86_64, macOS aarch64 | Installs to `/usr/local/bin` or `$CLAUDE_TOOLS_INSTALL_DIR` |
| **Homebrew** | `brew tap robtaylor/homebrew-claude-tools && brew install claude-tools` | macOS | Third-party tap maintained by Rob Taylor (a contributor, not the project author `dlond`); long-term maintenance is not guaranteed |
| **Nix** | `nix profile install github:dlond/claude-tools` | Any with Nix | Reproducible build |
| **From source (opam)** | `opam install dune yojson cmdliner uuidm && dune build` | Any with OCaml | Builds to `_build/default/bin/` |

**Current release binaries**: v1.0.1, with `claude-tools-aarch64-darwin.tar.gz` as the only pre-built binary. Linux x86_64 binaries are mentioned in the installer but may not yet be available in releases (the installer would fail). ARM Linux is explicitly unsupported.

### 2.5 Configuration

claude-tools requires no configuration files. It reads directly from `~/.claude/projects/` using the `HOME` environment variable. The only configurable aspect is the install directory (`CLAUDE_TOOLS_INSTALL_DIR` env var for the installer).

Shell completions are available for bash and zsh in the `completions/` directory but must be manually sourced.

---

## 3. Session Storage Architecture

### 3.1 Directory Structure

Claude Code stores session data under `~/.claude/projects/` using path-encoded directory names:

```
~/.claude/projects/
  -var-home-mjr-code-weft-lace/          # Host: /var/home/mjr/code/weft/lace
    08a480ec-31a9-46a2-8e19-6835c73e7e05.jsonl   # Session transcript
    08a480ec-31a9-46a2-8e19-6835c73e7e05/         # Session data dir
      subagents/
        agent-a0083e3.jsonl                        # Subagent transcripts
    293a9503-f942-4f59-bff6-8c1f700193b4.jsonl
    293a9503-f942-4f59-bff6-8c1f700193b4/
      subagents/
      tool-results/
        toolu_019BGqw3YJAin2utFhMZ2X4f.txt         # Cached tool outputs
```

### 3.2 Path Encoding Algorithm

The encoding used by Claude Code (and replicated in claude-tools' `project_path` function):

1. Resolve the workspace path to an absolute, canonical form (symlinks resolved)
2. Replace every `/` character with `-`

Examples for the lace project:

| Context | Workspace Path | Encoded Directory |
|---------|---------------|-------------------|
| Host (this machine) | `/var/home/mjr/code/weft/lace` | `-var-home-mjr-code-weft-lace` |
| Container (default) | `/workspaces/lace` | `-workspaces-lace` |
| Container (lace's own) | `/workspace/main` | `-workspace-main` |
| Container (custom) | `/home/node/project` | `-home-node-project` |

### 3.3 Session File Contents

Each session is a `.jsonl` file where each line is a JSON object. Key record types:

| Type | Purpose | Path-Dependent? |
|------|---------|-----------------|
| `file-history-snapshot` | File state tracking | No (uses messageId references) |
| `summary` | Conversation summaries | No |
| `message` | User/assistant messages | May reference file paths in content |
| `tool_use` / `tool_result` | Tool invocations | May reference absolute file paths |
| `metadata` | Audit trail (added by claude-tools) | Contains source/dest paths |

### 3.4 What Is Portable vs Path-Bound

**Portable (survives copy/move)**:
- Conversation content (messages, summaries)
- Tool usage history (what was asked/done)
- UUID-based identity (updated by `claude-cp`, preserved by `claude-mv`)
- Subagent transcripts (relative to session dir)

**Path-bound (breaks on cross-context transfer)**:
- The project directory encoding itself (determines which directory the session lives in)
- Absolute file paths referenced in tool calls (e.g., `/var/home/mjr/code/weft/lace/src/lib/up.ts` becomes invalid inside a container where the file is at `/workspaces/lace/src/lib/up.ts`)
- MCP server configurations (container-specific)
- Environment variable references in tool results

### 3.5 Session Subdirectories

Beyond the `.jsonl` file, sessions can have companion directories containing:
- `subagents/`: JSONL files for subagent (Task tool) conversations
- `tool-results/`: Cached tool output text files

These subdirectories share the session UUID as their directory name and must be copied/moved alongside the `.jsonl` file for a complete session transfer. claude-tools' `claude-cp` and `claude-mv` currently only handle the `.jsonl` file, not the companion directory.

---

## 4. Cross-Container Usage Design

### 4.1 Decision: Install in Container, Not Mount from Host

**Recommendation**: Install claude-tools inside each lace container rather than mounting from the host.

**Rationale**:
1. claude-tools binaries are platform-specific (currently only aarch64-darwin pre-built). The host binary may not match the container architecture.
2. The tools are small, self-contained binaries with no runtime dependencies. Installation is fast.
3. Mounting a host binary introduces fragile coupling between host platform and container platform.
4. The tools need to run inside the container to operate on the container's view of `~/.claude/projects/`.

### 4.2 Installation Mechanism

Three options, in order of preference:

**Option A: curl installer in postCreateCommand**

```jsonc
{
  "postCreateCommand": "curl -sSL https://raw.githubusercontent.com/dlond/claude-tools/main/install.sh | bash"
}
```

Pros: Simple, always gets latest. Cons: Requires network at build time, installer may not have Linux binaries.

**Option B: Nix (if nix is available in container)**

```jsonc
{
  "postCreateCommand": "nix profile install github:dlond/claude-tools"
}
```

Pros: Reproducible, works on any platform with Nix. Cons: Requires Nix in container (heavy dependency).

**Option C: Build from source in postCreateCommand**

```bash
opam install -y dune yojson cmdliner uuidm && \
  git clone --depth 1 https://github.com/dlond/claude-tools.git /tmp/claude-tools && \
  cd /tmp/claude-tools && dune build && dune install --prefix /usr/local && \
  rm -rf /tmp/claude-tools
```

Pros: Works on any platform with OCaml. Cons: **Significant time cost** -- installing the OCaml compiler via opam, fetching dependencies, and compiling can take 5-10 minutes in a container without caching, which substantially increases container rebuild times. Requires OCaml toolchain to be present or installed.

**Option D: Devcontainer feature (future)**

A `ghcr.io/dlond/devcontainer-features/claude-tools:1` feature would be ideal but does not exist yet. This could be proposed upstream or created within the weftwiseink organization.

**Practical recommendation for now**: Option A with a fallback. The installer currently only ships `aarch64-darwin` binaries, so for Linux containers (which are the majority of devcontainers), a source build or Nix install is required. The most practical short-term path is to create a small installer script in lace that:
1. Tries the binary installer
2. Falls back to a Nix install if available
3. Falls back to a source build if OCaml is available
4. Warns if none of the above work

### 4.3 Configuration Sharing

claude-tools has no configuration files to share. The only requirement is access to `~/.claude/projects/`, which is already handled by the `~/.claude/` bind mount from the claude bundling report.

### 4.4 Shell Completions

If claude-tools is installed, completions should be set up automatically. For lace containers, add to `postCreateCommand`:

```bash
# If using bash
echo 'source /usr/local/share/claude-tools/completions/claude-tools.bash' >> ~/.bashrc
# If using zsh
echo 'source /usr/local/share/claude-tools/completions/claude-tools.zsh' >> ~/.zshrc
```

The exact completion path depends on the installation method.

---

## 5. Session Copy/Move Mechanics

### 5.1 The Path Encoding Mismatch Problem

When `~/.claude/` is bind-mounted from host to container, the projects directory contains host-encoded paths:

```
# Inside container, ~/.claude/projects/ contains:
-var-home-mjr-code-weft-lace/        # Host encoding
-workspaces-lace/                     # Container encoding (if Claude was used in-container)
```

When Claude Code runs inside the container, it creates sessions under the container's path encoding (`-workspaces-lace`). When Claude Code runs on the host, it creates sessions under the host's path encoding (`-var-home-mjr-code-weft-lace`). Both are visible in the mounted `~/.claude/`, but Claude Code in the container only "sees" its own sessions, and vice versa.

### 5.2 What claude-cp Does

`claude-cp ~/source-project ~/dest-project [session-id]`:

1. Resolves `~/source-project` to an absolute path via `resolve_path` (which calls `Unix.realpath`)
2. Encodes the resolved path via `project_path` (replace `/` with `-`)
3. Looks up the `.jsonl` file in `~/.claude/projects/<encoded>/`
4. Generates a new UUID via `Uuidm.v4`
5. Copies the file content to `~/.claude/projects/<dest-encoded>/<new-uuid>.jsonl`
6. Appends metadata (source path, dest path, source UUID, timestamp)
7. Rewrites all `"sessionId":"..."` fields to the new UUID via `sed -i`
8. Preserves file timestamps via `utimes`

### 5.3 Cross-Context Copy: Host to Container

To copy a session from host context to container context:

```bash
# On host: session lives at
# ~/.claude/projects/-var-home-mjr-code-weft-lace/abc123.jsonl

# Inside container: we want it at
# ~/.claude/projects/-workspaces-lace/abc123.jsonl (or new UUID)
```

**Using claude-cp directly will not work** because:
- `claude-cp /var/home/mjr/code/weft/lace /workspaces/lace` inside the container will try to resolve `/var/home/mjr/code/weft/lace`, which does not exist in the container
- `claude-cp` uses `resolve_path` which calls `Unix.realpath`, which fails on non-existent paths (falls back to cleaned absolute path, which would work, but the source directory does not exist as a filesystem path)

**However, ghost directory support provides a partial workaround:**
claude-tools supports "ghost directories" -- directories that no longer exist but whose sessions are still in `~/.claude/projects/`. If the source path does not exist on the filesystem but its encoded form exists in `~/.claude/projects/`, `claude-ls` and `claude-cp` will still find the sessions.

Testing this inside a container:

```bash
# Inside container:
claude-ls /var/home/mjr/code/weft/lace
# This SHOULD work because:
# 1. resolve_path("/var/home/mjr/code/weft/lace") -> "/var/home/mjr/code/weft/lace" (no realpath resolution since path doesn't exist)
# 2. project_path encodes to "-var-home-mjr-code-weft-lace"
# 3. That directory exists in mounted ~/.claude/projects/

claude-cp /var/home/mjr/code/weft/lace /workspaces/lace
# Copies most recent session from host-encoded dir to container-encoded dir
```

**This is the key insight**: claude-tools' ghost directory support means cross-context copies are possible if you know the original host path. The tool does not require the source directory to exist on the filesystem.

### 5.4 Cross-Context Copy: Container to Host

The reverse direction works the same way:

```bash
# On host:
claude-cp /workspaces/lace /var/home/mjr/code/weft/lace
# /workspaces/lace doesn't exist on host, but ghost directory support handles it
```

### 5.5 Limitations of Raw claude-cp

1. **User must know both paths**: The user needs to know the host path and the container path to perform the copy. This is error-prone and requires context switching.

2. **Subagent data is not copied**: `claude-cp` only copies the `.jsonl` file, not the companion directory with `subagents/` and `tool-results/`. This means copied sessions lose subagent history.

3. **File path references in content are not updated**: If a session references `/var/home/mjr/code/weft/lace/src/lib/up.ts`, that path remains in the copied session even though the file is at `/workspaces/lace/src/lib/up.ts` in the container. Claude Code may be confused by stale path references.

4. **No batch operations**: There is no built-in way to copy all sessions between contexts.

---

## 6. Integration with Lace Plugin System

### 6.1 Evaluation of Integration Approaches

| Approach | Pros | Cons | Recommendation |
|----------|------|------|---------------|
| **Standard git plugin** (mounted from repo) | Uses existing system, no new code | Binary won't match container arch, wrong abstraction | No |
| **Part of managed Claude plugin** (from Report 2) | Single toggle enables everything | Bloats the Claude managed plugin with unrelated tool | No |
| **Separate managed plugin type** | Clean separation | Adds complexity to managed plugin concept | No |
| **postCreateCommand installation** | Simple, no plugin system changes | Not managed, user must configure | Yes (short-term) |
| **Devcontainer feature** | Clean, standard mechanism | Does not exist yet | Yes (long-term) |
| **`lace session` subcommand** | Native UX, path-aware | New code in lace CLI | Yes (for session ops) |

### 6.2 Recommended Architecture

The integration has two orthogonal concerns:

**Concern 1: Making claude-tools available in containers**

This is an installation problem, not a plugin problem. claude-tools is a set of binaries, not a mountable directory of source/config. The plugin system (which handles git repos mounted into containers) is the wrong abstraction.

Short-term: Document a `postCreateCommand` snippet that installs claude-tools. If `customizations.lace.claude` is `true` (from Report 2), lace could inject the install command automatically.

Long-term: Create a devcontainer feature (`ghcr.io/weftwiseink/devcontainer-features/claude-tools:1`) that installs the binaries. This feature would be auto-injected alongside the Claude Code feature when `customizations.lace.claude` is enabled.

**Concern 2: Session portability between host and container**

This is a lace-native concern. It requires knowledge of:
- The host workspace path (known to lace at `lace up` time)
- The container workspace path (known from devcontainer.json `workspaceFolder` or the default `/workspaces/<project>`)
- The session storage location (`~/.claude/projects/`)

A `lace session` subcommand is the right abstraction because lace is the only component that knows both the host path and the container path.

### 6.3 Extension to `generateExtendedConfig`

If claude-tools installation is automated as part of the managed Claude plugin, `generateExtendedConfig` needs one additional merge target:

```typescript
// In postCreateCommand merging, add claude-tools installation
const claudeToolsInstall = 'curl -sSL https://raw.githubusercontent.com/dlond/claude-tools/main/install.sh | CLAUDE_TOOLS_INSTALL_DIR=/usr/local/bin bash 2>/dev/null || true';
```

This would be appended to the existing `postCreateCommand` merging logic in `up.ts:271-289`.

### 6.4 Required Mounts (Beyond Report 2)

claude-tools needs no additional mounts beyond what Report 2 already specifies. The `~/.claude/` bind mount provides access to `~/.claude/projects/` which is the only data claude-tools reads/writes.

### 6.5 Required Environment Variables (Beyond Report 2)

claude-tools needs no additional environment variables. It uses `HOME` (always set) and `~/.claude/` (mounted by Report 2's design).

---

## 7. Challenges and Mitigations

### 7.1 Path Encoding Mismatch

**Challenge**: Host path `/var/home/mjr/code/weft/lace` encodes to `-var-home-mjr-code-weft-lace` while container path `/workspaces/lace` encodes to `-workspaces-lace`. Sessions created in one context are invisible in the other.

**Inherent encoding limitation**: The `replace('/', '-')` encoding scheme is not injective -- different paths can produce the same encoded name if they differ only in `/` vs `-`. For example, `/workspaces/my-project` and `/workspaces/my/project` both encode to `-workspaces-my-project`. While this collision is unlikely in practice (workspace paths rarely have this structure), it is an inherent limitation of Claude Code's upstream path encoding that the symlink bridge inherits. There is no mitigation within lace; this would require an upstream change to the encoding scheme (e.g., escaping hyphens before encoding).

**Mitigation A: Symlink Farm in `~/.claude/projects/`**

Create a symlink inside the container's `~/.claude/projects/` that maps the container encoding to the host encoding:

```bash
# Inside container postCreateCommand:
ln -sfn ~/.claude/projects/-var-home-mjr-code-weft-lace ~/.claude/projects/-workspaces-lace
```

Pros: Claude Code in the container sees host sessions natively. Zero friction after setup.
Cons: Writes to the mounted `~/.claude/`, creating the symlink on the host filesystem. Container sessions and host sessions are merged (may be confusing). The symlink must be recreated if the host path changes or after `claude-clean` runs.

**Mitigation B: `lace session` Subcommand with Path Translation**

```bash
# List sessions from the "other" context
lace session ls --host    # Inside container: list host-context sessions
lace session ls --container  # On host: list container-context sessions

# Copy between contexts
lace session pull [session-id]   # Copy from host-context to container-context
lace session push [session-id]   # Copy from container-context to host-context
```

Implementation: `lace session` knows the host workspace path (stored during `lace up`) and the container workspace path (from devcontainer.json). It translates paths before calling `claude-cp`.

Pros: Explicit, no filesystem side effects, user controls what gets copied.
Cons: Extra step, user must invoke explicitly.

**Mitigation C: Dual Symlinks (Bidirectional)**

Create symlinks in both directions during `postCreateCommand`:

```bash
# Container encoding -> Host encoding (container sees host sessions)
ln -sfn ~/.claude/projects/-var-home-mjr-code-weft-lace ~/.claude/projects/-workspaces-lace

# Note: The reverse (host encoding -> container encoding) is NOT needed because
# the host already has its own sessions at the correct encoding.
```

**Recommendation**: Use Mitigation A (symlink) as the default behavior when `customizations.lace.claude` is enabled, with Mitigation B (`lace session`) as an additional power-user tool.

### 7.2 Subagent and Tool-Result Data Loss on Copy

**Challenge**: `claude-cp` copies only the `.jsonl` file. The companion directory (`<session-uuid>/subagents/`, `<session-uuid>/tool-results/`) is not copied. This means resumed sessions lose subagent history and cached tool results.

**Mitigation**: The `lace session` subcommand should copy the companion directory alongside the `.jsonl` file:

```bash
# In lace session pull implementation:
# 1. Call claude-cp for the .jsonl (handles UUID rewrite)
# 2. Copy the companion directory, renaming from old UUID to new UUID
cp -r ~/.claude/projects/<host-encoded>/<old-uuid>/ \
      ~/.claude/projects/<container-encoded>/<new-uuid>/
```

This is a lace-specific enhancement that does not require modifying claude-tools.

### 7.3 Stale File Path References in Copied Sessions

**Challenge**: Session content may reference absolute file paths from the source context. After copying host-to-container, paths like `/var/home/mjr/code/weft/lace/src/lib/up.ts` appear in the session but the file is at `/workspaces/lace/src/lib/up.ts` in the container.

**Mitigation**: Accept this as a known limitation. Claude Code is generally resilient to stale path references -- it re-discovers files based on the current working directory. The session content serves as context/history, not as a working file index. Document this behavior for users.

### 7.4 Linux Binary Availability

**Challenge**: claude-tools currently only publishes macOS aarch64 binaries. Most devcontainers are Linux x86_64.

**Mitigation**: Three approaches in priority order:
1. Request Linux x86_64 builds from the claude-tools project (issue/PR)
2. Build from source in the container using Nix or opam (works but slow)
3. Create a lace-specific build pipeline that cross-compiles or builds in CI for Linux targets

### 7.5 Container Rebuilds

**Challenge**: Container rebuilds destroy installed claude-tools binaries. The tool must be reinstalled on each rebuild.

**Mitigation**: This is handled naturally by `postCreateCommand` -- the install command runs on every container creation. For faster rebuilds, cache the binary:

```bash
# Check if already installed before downloading
which claude-ls 2>/dev/null || curl -sSL .../install.sh | bash
```

Or, with a devcontainer feature, installation happens during the Docker build layer and is cached.

### 7.6 Multiple Containers for Same Project

**Challenge**: If multiple lace containers are running for the same project, they share the same `~/.claude/projects/` via the bind mount. Concurrent Claude sessions in different containers could cause session conflicts.

**Mitigation**: Claude Code uses UUID-based session files, so different sessions do not conflict (each gets a unique UUID). However, if two sessions write to the same `.jsonl` file simultaneously (e.g., via `claude --resume`), corruption is possible. This is a general Claude Code limitation, not specific to lace. Document as expected behavior: do not resume the same session in multiple containers simultaneously.

### 7.7 `claude-clean` Interaction with Session Bridge Symlink

**Challenge**: If `claude-clean` is run on the host while a container is running, it may remove the host-encoded project directory (if it appears empty after sessions are cleaned). This would leave the container's symlink dangling -- the session bridge would point to a nonexistent directory, and Claude Code in the container would fail to find sessions. Similarly, `claude-clean` running inside the container could encounter the symlink and behave unexpectedly: `Sys.is_directory` follows symlinks (via the underlying `stat()` call), so `claude-clean` would traverse the symlink and potentially clean up host sessions.

**Mitigation**: The symlink bridge should be treated as lace-managed infrastructure, not subject to `claude-clean`. Users should be warned in lace documentation that running `claude-clean` on the host may invalidate the session bridge and require re-running `lace session bridge` or restarting the container. Using `postStartCommand` (rather than `postCreateCommand`) for the symlink creation ensures it is recreated on each container start, which mitigates the dangling symlink problem for subsequent container starts.

### 7.8 macOS Symlink Resolution in Path Encoding

**Challenge**: On macOS, `Unix.realpath` resolves `/tmp` to `/private/tmp` and similar system symlinks. This means `claude-tools` on macOS and inside a Linux container may encode the same logical path differently.

**Mitigation**: This is only relevant for macOS host users. On Linux hosts (including this Fedora system where `/var/home` is the canonical path), `realpath` produces consistent results. For macOS hosts, document that path resolution may differ and recommend using `lace session` (which handles the translation) rather than raw `claude-cp`.

---

## 8. Recommended Setup Flow

### 8.1 One-Time Host Setup

```bash
# 1. Ensure Claude Code is installed and authenticated on host
claude --version
claude auth status  # or: ls ~/.claude/.credentials.json

# 2. No claude-tools host setup needed unless you want host-side session management
# Optional: install claude-tools on host
curl -sSL https://raw.githubusercontent.com/dlond/claude-tools/main/install.sh | bash
```

### 8.2 Project Configuration

Add to `.devcontainer/devcontainer.json`:

```jsonc
{
  "customizations": {
    "lace": {
      "claude": true
      // claude-tools installation and session symlinks
      // are handled automatically by lace when claude is enabled
    }
  }
}
```

### 8.3 What Lace Does at `lace up` Time

When `customizations.lace.claude` is `true`, lace's `generateExtendedConfig` produces:

```jsonc
{
  // From Report 2: Claude Code feature + mounts + env vars
  "features": {
    "ghcr.io/anthropics/devcontainer-features/claude-code:1": {}
  },
  "mounts": [
    "type=bind,source=/var/home/mjr/.claude,target=/home/node/.claude"
  ],
  "containerEnv": {
    "CLAUDE_CONFIG_DIR": "/home/node/.claude"
  },
  "remoteEnv": {
    "ANTHROPIC_API_KEY": "${localEnv:ANTHROPIC_API_KEY}"
  },

  // New: claude-tools installation + session path bridging
  "postCreateCommand": {
    "claude-tools": "curl -sSL https://raw.githubusercontent.com/dlond/claude-tools/main/install.sh | CLAUDE_TOOLS_INSTALL_DIR=/usr/local/bin bash 2>/dev/null || echo 'claude-tools installation skipped (binaries may not be available for this platform)'",
    "session-bridge": "ln -sfn /home/node/.claude/projects/-var-home-mjr-code-weft-lace /home/node/.claude/projects/-workspaces-lace 2>/dev/null || true"
  }
}
```

The `session-bridge` command creates a symlink from the container's project encoding to the host's project encoding, so that Claude Code running inside the container can see host sessions.

### 8.4 Deriving the Session Bridge Symlink

Lace has both pieces of information needed:

```typescript
// Host workspace path: from the --workspace-folder argument to lace up
const hostPath = workspaceFolder;  // e.g., "/var/home/mjr/code/weft/lace"

// Container workspace path: from devcontainer.json
const containerPath = raw.workspaceFolder   // e.g., "/workspace/main"
  ?? `/workspaces/${basename(hostPath)}`;   // default convention

// Encode both
const hostEncoded = hostPath.replace(/\//g, '-');     // "-var-home-mjr-code-weft-lace"
const containerEncoded = containerPath.replace(/\//g, '-');  // "-workspace-main"

// Generate symlink command
const bridgeCmd = `ln -sfn ${remoteHome}/.claude/projects/${hostEncoded} ${remoteHome}/.claude/projects/${containerEncoded} 2>/dev/null || true`;
```

### 8.5 Inside the Container

After `lace up`, the user has:

```bash
# Claude Code works with host credentials
claude --version
claude  # Start a new session or resume

# claude-tools (if installation succeeded)
claude-ls           # Lists sessions from both host and container contexts
                    # (because the symlink bridges them)
claude-ls .         # Lists sessions for current directory (container path)
                    # Container encoding points to host sessions via symlink

# Session management
claude-cp . ~/other-project abc123    # Copy session to another project
claude-clean --days=30                # Clean up old sessions
```

### 8.6 Advanced: Manual Session Transfer (Without Symlink)

If the symlink bridge is not set up (e.g., for custom workspace configurations):

```bash
# Inside container: list host sessions by referencing the host path as a "ghost directory"
claude-ls /var/home/mjr/code/weft/lace

# Copy a specific host session to the container context
claude-cp /var/home/mjr/code/weft/lace /workspaces/lace abc12345

# Copy all sessions (using pipe)
claude-ls /var/home/mjr/code/weft/lace | while read -r line; do
  id=$(echo "$line" | awk '{print $3}')
  claude-cp /var/home/mjr/code/weft/lace /workspaces/lace "$id"
done
```

---

## 9. Open Questions

### Q1: Should the session bridge symlink point host-to-container or container-to-host?

The current recommendation creates a symlink from container encoding to host encoding (`-workspaces-lace` -> `-var-home-mjr-code-weft-lace`). This means Claude Code in the container sees host sessions as its own. The alternative is to symlink host-to-container, which would make container sessions visible on the host.

**Consideration**: The symlink modifies the mounted `~/.claude/projects/` directory on the host. If multiple containers create conflicting symlinks, the last one wins. The symlink must also be cleaned up when the container is removed.

**Recommendation**: Container-to-host direction (current design). Host sessions are the "source of truth." Container sessions are ephemeral.

### Q2: Should lace implement `lace session` as a subcommand?

A `lace session` subcommand would provide session management without requiring claude-tools to be installed:

```bash
lace session ls                    # List sessions for current project
lace session pull [session-id]     # Copy host session to container
lace session push [session-id]     # Copy container session to host
lace session bridge                # Create/refresh the symlink bridge
```

This would be a TypeScript implementation that reads `.jsonl` files directly, avoiding the dependency on claude-tools binaries.

**Consideration**: Duplicates claude-tools functionality. However, it would work on any platform without OCaml dependencies and could handle the companion directory copy that claude-tools misses.

**Recommendation**: Implement `lace session bridge` as a minimal first step (just the symlink creation). Defer full session management until the need is validated by user feedback.

### Q3: How should claude-clean interact with the session bridge symlink?

This concern has been promoted to a concrete challenge with mitigation -- see **Section 7.7** above. The remaining open question is whether `claude-clean` should be patched upstream to recognize and skip symlinks in `~/.claude/projects/`, or whether lace should work around it entirely via `postStartCommand` idempotent symlink creation.

### Q4: What is the right install method for Linux containers given the current binary availability?

The claude-tools project only ships macOS aarch64 binaries as of v1.0.1. The install.sh script attempts to download based on `uname -s` and `uname -m`, but will fail on Linux because the binary does not exist in the release.

**Options**:
1. Contribute Linux x86_64 CI builds to the claude-tools project
2. Build a lace-maintained fork or build pipeline
3. Build from source in the container (requires OCaml)
4. Wait for upstream to add Linux builds (roadmap mentions this)

**Recommendation**: File an issue or PR on dlond/claude-tools requesting Linux x86_64 builds. In the meantime, make the installation optional with a clear warning and provide the Nix fallback for users who need it.

### Q5: Should the symlink bridge be created in postCreateCommand or postStartCommand?

`postCreateCommand` runs once when the container is created. `postStartCommand` runs every time the container starts.

**Consideration**: The symlink persists in the mounted `~/.claude/projects/` on the host filesystem, so it survives container stops/starts. However, if the user deletes the symlink (e.g., via `claude-clean`), it would not be recreated until the container is rebuilt.

**Recommendation**: Use `postStartCommand` for the symlink bridge to ensure it is always present. The `ln -sfn` is idempotent and fast.

### Q6: How does this interact with git worktree workflows?

claude-tools was designed with git worktree workflows in mind (ghost directory support). In a lace context, if a project uses worktrees (as lace's own devcontainer does with `workspaceMount` mounting the parent directory), each worktree has its own path and thus its own session encoding.

**Example**: Lace mounts `/workspace/main` and `/workspace/feature-branch` as worktrees. These produce different session encodings. Sessions from `main` are not visible from `feature-branch`.

**Recommendation**: For worktree-based projects, create symlink bridges for all active worktrees, or document that `claude-cp` with ghost directory support is the recommended approach for moving sessions between worktrees.

---

## Appendix A: claude-tools Path Resolution Deep Dive

> **Note**: The code snippets below are **simplified pseudocode** that illustrate the key logic of each function. They are not exact copies of the upstream source, which has additional detail (e.g., a `squash_rev` accumulator for `.`/`..` handling in `resolve_path`). See the [upstream `cvfs.ml`](https://github.com/dlond/claude-tools/blob/main/lib/cvfs.ml) for the authoritative implementation.

The `resolve_path` function in `lib/cvfs.ml` performs the following steps:

```ocaml
let resolve_path path =
  (* 1. Normalize to absolute path *)
  let abs_path =
    if path = "" || path = "." then Sys.getcwd ()
    else if path = "~" then Sys.getenv "HOME"
    else if path.[0] = '/' then (* clean ./ and ../ components *)
    else if String.starts_with ~prefix:"~/" path then (* expand ~ *)
    else (* relative: prepend cwd *)
  in
  (* 2. Resolve symlinks *)
  try Unix.realpath abs_path
  with _ -> abs_path  (* Fall back to cleaned path if realpath fails *)
```

The `project_path` function then encodes:

```ocaml
let project_path path =
  path |> resolve_path |> String.map (fun c -> if c = '/' then '-' else c)
  |> fun dir -> Sys.getenv "HOME" ^ "/.claude/projects/" ^ dir
```

Key behavior: When `realpath` fails (because the directory does not exist), the fallback cleaned path is used. This is what enables ghost directory support and is critical for cross-context session management.

## Appendix B: Session File Format Reference

A Claude Code session `.jsonl` file contains one JSON object per line. The key fields relevant to portability:

```jsonl
{"type":"file-history-snapshot","messageId":"<uuid>","snapshot":{...},"isSnapshotUpdate":false}
{"type":"summary","summary":"Working on lace plugin system","sessionId":"<session-uuid>"}
{"type":"user","message":{"role":"user","content":"..."},"sessionId":"<session-uuid>"}
{"type":"assistant","message":{"role":"assistant","content":[...]},"sessionId":"<session-uuid>"}
```

The `sessionId` field appears in most record types and ties the record to a specific session. `claude-cp` rewrites all `sessionId` fields when copying to create a new independent session.

## Appendix C: File Reference

| File | Role in This Report |
|------|-------------------|
| `packages/lace/src/lib/up.ts` | `generateExtendedConfig` for injecting postCreateCommand |
| `packages/lace/src/lib/mounts.ts` | Mount resolution (claude-tools needs no additional mounts) |
| `.devcontainer/devcontainer.json` | Lace's own devcontainer config showing current mount pattern |
| `cdocs/reports/2026-02-05-lace-plugin-system-state.md` | Plugin system architecture (claude-tools does not fit as a plugin) |
| `cdocs/reports/2026-02-05-claude-devcontainer-bundling.md` | Claude Code bundling design (foundation for this report) |

## Appendix D: Related Documents

- **Claude Bundling Report**: `cdocs/reports/2026-02-05-claude-devcontainer-bundling.md`
- **Plugin System State**: `cdocs/reports/2026-02-05-lace-plugin-system-state.md`
- **Plugin System Proposal**: `cdocs/proposals/2026-02-04-lace-plugins-system.md`
- **RFP: Plugin Host Setup**: `cdocs/proposals/2026-02-04-rfp-plugin-host-setup.md`
- **claude-tools Repository**: https://github.com/dlond/claude-tools
- **claude-tools CVFS Source**: https://github.com/dlond/claude-tools/blob/main/lib/cvfs.ml
