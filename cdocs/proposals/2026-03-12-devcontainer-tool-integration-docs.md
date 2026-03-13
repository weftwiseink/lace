---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-12T16:15:56-07:00
task_list: lace/docs
type: proposal
state: live
status: review_ready
last_reviewed:
  status: accepted
  by: "@claude-opus-4-6"
  at: 2026-03-13T08:47:51-07:00
  round: 1
tags: [documentation, mounts, repo-mounts, claude-code, devcontainer, tool-integration]
---

# Documentation improvements for mount systems and devcontainer tool integration

> BLUF: Lace's README and docs thoroughly cover mount and repo-mount mechanics but lack guidance on how host-side tools (Claude Code plugins, git credential helpers, etc.) interact with container path remapping.
> Two real-world breakages — Claude Code sign-in failing due to `CLAUDE_CONFIG_DIR` path semantics and plugin slash commands not loading due to marketplace path mismatch — exposed gaps that existing documentation does not address.
> This proposal adds a new "Tool integration" section to the README covering common path-remapping pitfalls, a new troubleshooting entry for each failure mode, and targeted additions to the migration guide.

## Objective

Users setting up Claude Code (and potentially other host-side tools) inside lace devcontainers hit non-obvious failures that stem from path remapping between host and container.
The existing documentation covers lace's own mechanics well but assumes the reader understands how downstream tools resolve paths.
The goal is to bridge that gap with practical guidance, without turning lace docs into Claude Code docs.

## Background

### Failure 1: Claude Code sign-in prompt inside container

When `CLAUDE_CONFIG_DIR` is set (e.g., to `/home/node/.claude`), Claude Code looks for `.claude.json` at `$CLAUDE_CONFIG_DIR/.claude.json` — inside the config directory.
On the host, `.claude.json` lives at `~/.claude.json` — a sibling file outside `~/.claude/`.
A directory bind mount of `~/.claude` → `/home/node/.claude` does not include `~/.claude.json`, so the container's copy lacks `hasCompletedOnboarding: true`, triggering the sign-in wizard.

**Fix (already implemented):** A `sourceMustBe: "file"` mount declaration (`claude-config-json`) overlays the host's `~/.claude.json` at `$CLAUDE_CONFIG_DIR/.claude.json` inside the container.

### Failure 2: Plugin slash commands not recognized

Claude Code's plugin system stores host-absolute paths in `installed_plugins.json` and `known_marketplaces.json` (both inside `~/.claude/`).
A locally-registered marketplace (`clauthier` → `/var/home/mjr/code/weft/clauthier`) doesn't exist at that path inside the container, so plugin validation fails with "Plugin cdocs not found in marketplace clauthier."

**Fix (already implemented):** Install the plugin from a GitHub-backed marketplace (`weft-marketplace`) that caches its manifest inside `~/.claude/plugins/marketplaces/`, which is bind-mounted.
Alternatively, the `overrideMount.target` feature on repo mounts could place the marketplace directory at the exact host path inside the container.

### Existing documentation

- **README § Repo mounts:** Documents `overrideMount.target` and symlink generation, but doesn't explain when or why you'd mirror a host path.
- **README § Mount templates:** Thoroughly covers declaration, resolution, validation, guided config — but doesn't cover the `CLAUDE_CONFIG_DIR` nested-file pattern.
- **Troubleshooting:** 10 entries, all focused on lace's own error messages. No entries for downstream tool failures caused by path remapping.
- **Migration guide:** Steps 1–6 are excellent. No step covers tool-specific mount patterns (claude, git credentials, etc.).

## Proposed Solution

### 1. New README section: "Tool integration patterns"

Add after "Repo mounts" and before "Workspace layout." Covers:

**a. Nested file mounts (the `.claude.json` pattern)**
When a tool looks for a config file *inside* a directory that's already bind-mounted, but the host stores that file *outside* the directory.
General pattern: add a `sourceMustBe: "file"` mount declaration that overlays the specific file onto the directory mount.
Concrete example: `claude-config-json` mount for `CLAUDE_CONFIG_DIR`.

**b. Host-path-dependent tools (the marketplace pattern)**
When a tool stores absolute host paths in its config (which is then bind-mounted into the container), those paths don't resolve in the container's filesystem namespace.
Two approaches:
- Use `overrideMount.target` to mirror the host path exactly, so stored references still resolve.
- Prefer network-backed references (GitHub marketplace vs. local directory) that don't depend on filesystem paths.

**c. `CONTAINER_WORKSPACE_FOLDER` and path awareness**
Document that lace sets this env var and tools can use it to detect they're in a container. Note how workspace paths differ between host and container in bare-worktree layouts.

### 2. New troubleshooting entries

**§ 11. Claude Code asks to sign in inside container**
- Symptom: Claude Code shows onboarding/sign-in wizard despite `~/.claude` being mounted
- Cause: `CLAUDE_CONFIG_DIR` path semantics — `.claude.json` looked up inside the dir, but host stores it outside
- Fix: Add `claude-config-json` file mount declaration (with full example)

**§ 12. Tool plugins/extensions fail to load with path errors**
- Symptom: Tools that reference host-absolute paths in their config fail to resolve them inside the container
- Cause: Bind-mounted config files contain host paths that don't exist in the container's filesystem namespace
- Fix: Use `overrideMount.target` for mirrored paths or prefer network-backed registries
- General principle: any tool that persists absolute paths in a bind-mounted config directory will have this class of problem

### 3. Migration guide addition

**Step 3.5 (between mount declarations and prebuilds): Tool-specific mount patterns**
Brief section explaining that some tools need more than a directory mount.
Points to the new README section for details.
Covers the claude-config example as a concrete case.

### 4. README § Repo mounts: expand "Settings overrides" subsection

The existing example shows `overrideMount.target` but doesn't explain the motivation.
Add a brief paragraph before the example explaining the two use cases for custom targets:
- Placing a mount at a semantically meaningful path (e.g., `~/.dotfiles`)
- Mirroring the host path so tools that store absolute paths continue to work

## Important Design Decisions

### Decision: Separate "Tool integration" section vs. expanding existing sections

**Decision:** New standalone section.

**Why:** The mount and repo-mount sections document lace's mechanics.
Tool integration is about how those mechanics interact with external tools' assumptions.
Mixing the two would dilute the clarity of both.
The new section cross-references existing sections without duplicating their content.

### Decision: Use Claude Code as the primary example, generalize the pattern

**Decision:** Lead with the concrete Claude Code examples, then extract the general pattern.

**Why:** Abstract patterns without concrete examples are hard to follow.
The Claude Code cases are real, well-understood, and already fixed — they make excellent teaching examples.
The general patterns (nested file mounts, host-path-dependent tools) apply beyond Claude Code.

### Decision: Troubleshooting entries for downstream tool failures

**Decision:** Add them despite not being lace error messages.

**Why:** The troubleshooting guide's value is helping users diagnose problems they encounter while using lace.
"Claude asks to sign in" is a lace user's problem even though lace didn't produce the error.
The entry makes it discoverable and points to the fix.

## Edge Cases / Challenging Scenarios

- **Multiple tools with the same pattern:** If other tools (git credential managers, npm config, etc.) have similar nested-file or host-path issues, the "Tool integration" section should be general enough that users can apply the pattern without needing a tool-specific entry. The troubleshooting entries should remain tool-specific for discoverability.

- **`overrideMount.target` with worktree layouts:** When using bare-worktree workspace layout, the host path includes the worktree name. The `overrideMount.target` should use the bare-repo root path (without the worktree suffix) since that's what tools typically store. This is worth a brief note.

- **Shared `installed_plugins.json`:** Adding container-path entries to a bind-mounted config file that's shared between host and container is fragile. The docs should recommend the network-backed approach (GitHub marketplace) over path-mirroring when feasible, and explain the tradeoff.

## Implementation Phases

### Phase 1: README "Tool integration patterns" section

Add new section between "Repo mounts" and "Workspace layout" in `packages/lace/README.md`.
Three subsections as described: nested file mounts, host-path-dependent tools, container path awareness.
Each with a general pattern description and concrete example.

**Verification:** Section reads coherently, cross-references existing sections accurately, examples match the actual devcontainer.json config.

### Phase 2: Troubleshooting entries §11 and §12

Add to `packages/lace/docs/troubleshooting.md`.
Follow existing format: Symptom / Cause / Fix with code blocks.

**Verification:** Each entry follows the established format, symptoms match what users actually see, fixes reference the correct config fields.

### Phase 3: Migration guide addition

Add step 3.5 to `packages/lace/docs/migration.md`.
Brief — 10–15 lines plus a code example.
Cross-references the new README section.

**Verification:** Fits naturally in the migration progression, doesn't duplicate the README section.

### Phase 4: Expand repo mounts "Settings overrides" motivation

Add 2–3 sentences before the existing `overrideMount` example in the README's "Repo mounts § Settings overrides" subsection.

**Verification:** Existing example still reads naturally with the added context.
