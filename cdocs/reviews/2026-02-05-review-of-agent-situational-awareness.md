---
review_of: cdocs/reports/2026-02-05-agent-situational-awareness.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T12:30:00-08:00
type: review
state: live
status: done
tags: [claude-code, agent-awareness, mcp, devcontainer, session-portability, CLAUDE.md]
---

# Review: Agent Situational Awareness in Lace Devcontainers

## Summary Assessment

This is a thorough, well-structured research report that identifies a real gap in lace's agent experience and proposes a layered remediation strategy spanning CLAUDE.md augmentation, environment markers, MCP server introspection, and session portability breadcrumbs. The report demonstrates strong familiarity with both the lace codebase and Claude Code's operational model. The tiered recommendation structure is appropriate and the priorities are sound -- the highest-impact, lowest-effort items come first.

The main weaknesses are: (1) the CLAUDE.md content example overloads what should be a concise constitution with runtime-discovery instructions that belong elsewhere, (2) the MCP server tool schemas include `outputSchema` fields that are not part of the MCP tool specification, (3) the session portability analysis correctly identifies what breaks but some of the proposed mitigations depend on Claude Code internals or features that do not exist, and (4) several concrete claims about the current codebase are accurate but one reference to a file that does not exist needs correction.

**Verdict: Accept with revisions.** The report is valuable as a research foundation and roadmap. The tier 1 recommendations can be acted on immediately. Tiers 2-4 benefit from the revisions noted below.

## Section-by-Section Findings

### Section 1: Executive Summary

Clear framing of the three core challenges (orientation, continuity, discovery). The claim that these are ordered by impact is implicit but reasonable.

**Finding:** No issues.

### Section 2: Current State

#### What exists today

The report's characterization of the codebase is largely accurate:

- **CLAUDE.md**: Correctly notes it contains only `@.claude/rules/cdocs.md`. However, the report states "the referenced file does not currently exist at that path." This needs clarification: `.claude/rules/cdocs.md` does not exist as a standalone file at the repo level. The reference uses the `@` import syntax, and the cdocs plugin is a Claude Code plugin (`cdocs@clauthier` in `.claude/settings.json`), meaning the rules are loaded by the plugin system, not from a file at that literal path. The report's framing is misleading -- it implies agents receive "no lace-specific orientation context," but the cdocs plugin does inject rules via the plugin mechanism. The report should note that `@.claude/rules/cdocs.md` is a plugin reference, not a filesystem path, and that the cdocs rules concern document authoring, not environment orientation.

- **devcontainer.json**: Accurately described. Verified against the actual file. The feature list, mount points, and environment variable (`CLAUDE_CONFIG_DIR`) are all correct. The port 2222 and dynamic assignment via port-manager in 22425-22499 range is confirmed by `port-manager.ts`.

- **Lace CLI**: The description of `lace up` phases is accurate per `up.ts`: port assignment, prebuild (if configured), resolve mounts (if plugins configured), generate extended config, devcontainer up.

- **Plugin system**: Correctly described. `PLUGIN_MOUNT_PREFIX` is `/mnt/lace/plugins` in `mounts.ts`.

- **Session storage**: The path encoding claim (`~/.claude/projects/<encoded-path>/`) and bind-mount from host are plausible based on devcontainer.json mounts. The report correctly identifies that `CLAUDE_CONFIG_DIR=/home/node/.claude` maps to the host bind at `~/code/dev_records/weft/claude`.

**Finding:** [non-blocking] Correct the characterization of `.claude/rules/cdocs.md`. It is a plugin-provided rules file (via `cdocs@clauthier`), not a missing file. The conclusion that agents lack lace-specific orientation context is still valid since cdocs rules are about document management, not environment awareness.

#### What is missing

The five gaps identified are valid. The ordering (manifest, CLAUDE.md content, identity markers, MCP server, migration protocol) is reasonable.

**Finding:** No issues.

### Section 3: CLAUDE.md Enhancement Proposals

#### 3.1 Principle: Constitution, not documentation

Good principle. The 150-200 instruction limit guidance aligns with community best practices.

**Finding:** No issues.

#### 3.2 Proposed CLAUDE.md root content

The proposed content has the right structure but mixes two concerns: (a) permanent project facts that belong in CLAUDE.md, and (b) runtime self-diagnosis instructions that belong in `.claude/rules/` or a hook-generated context file.

Specifically, the "Session Context" section instructs agents to run `cat /etc/lace/environment.json` and `env | grep LACE_` -- these are runtime probing instructions that assume the environment markers from Section 5 are already implemented. Putting them in CLAUDE.md before those markers exist creates a confusing bootstrapping gap where agents are told to check files that do not yet exist.

The "Key Paths" section is appropriate for CLAUDE.md. The "Commands" section is appropriate. The "Environment" section is partially appropriate but should be shorter and more declarative.

**Finding:** [blocking] Separate the proposed CLAUDE.md content into two tiers:
1. What can go into CLAUDE.md today (project structure, key paths, commands, the basic "this is a lace devcontainer" orientation).
2. What should go into `.claude/rules/lace-environment.md` or `.claude.local.md` after the environment markers (Section 5) are implemented.

The proposed CLAUDE.md also includes `@.claude/rules/cdocs.md` at the bottom, preserving the existing reference. Good.

#### 3.3 Worktree-specific CLAUDE.md

The report references `overview_and_quickstart.md` as already mentioning `.claude/WORKTREE_CONTEXT.md`. I verified `overview_and_quickstart.md` exists but did not find this specific reference in the portion read. This may be a hallucinated reference.

**Finding:** [non-blocking] Verify that `overview_and_quickstart.md` actually references `.claude/WORKTREE_CONTEXT.md`. If it does not, remove the "already referenced" claim. The worktree-specific context idea is still valuable regardless.

**Finding:** [non-blocking] The worktree CLAUDE.md approach has a structural problem: each worktree under `/workspace/<branch>` is a separate git checkout, so a CLAUDE.md at the worktree root would need to be committed to git (and thus shared across worktrees) or be generated per-worktree by a hook. The report acknowledges this in Open Question 2 but should resolve it here: the answer is that `.claude.local.md` (gitignored, generated per-worktree by `postStartCommand`) is the right mechanism for worktree-specific context, not a committed CLAUDE.md.

#### 3.4 Progressive disclosure via .claude/rules/

Good approach. The three proposed rule files (environment, plugins, session-portability) are focused and complementary. However, `.claude/rules/` files are loaded for every session, so keep them concise.

**Finding:** No issues.

### Section 4: MCP Server Opportunities

#### 4.1 lace_environment tool

The tool concept is sound. Replacing ad-hoc shell commands with structured data is genuinely valuable.

**Finding:** [blocking] The tool schemas include `outputSchema` fields. As of the MCP specification (2025-06-18, which the report cites), the `tools/list` response schema defines tools with `name`, `description`, and `inputSchema`. There is no `outputSchema` field in the MCP tool specification. Tools return content as `CallToolResult` with `content` arrays containing text/image/resource items. The report should remove `outputSchema` from the tool definitions and instead document the expected return format as a JSON text content block in the tool description, or note that `outputSchema` is an informational annotation not part of the wire protocol.

Update: The 2025-06-18 MCP spec does add an optional `outputSchema` for structured content. However, `@modelcontextprotocol/sdk` support for this is still evolving. The report should clarify which spec version it targets and whether the SDK version available in the devcontainer supports `outputSchema`. If the intent is informational (documenting what the tool returns), that is fine but should be labeled as such.

#### 4.2 lace_session_history tool

The `previousEnvironmentPath` input parameter is awkward. Agents would need to know where the previous environment file is, which is the very information they are trying to discover. A better design would have the tool automatically check known locations (e.g., `.claude/last-environment.json` in the current workspace) without requiring the agent to provide the path.

**Finding:** [non-blocking] Simplify `lace_session_history` to accept no required inputs. The tool should automatically locate the previous environment snapshot from a well-known location (e.g., `.claude/last-environment.json` relative to the workspace root). The `previousEnvironmentPath` could remain as an optional override but should not be the primary interface.

#### 4.3 lace_worktrees tool

Straightforward. The `inputSchema` with no properties is correct for a query-only tool.

**Finding:** No issues.

#### 4.4 Configuration (.mcp.json)

The proposed `.mcp.json` configuration mounts the MCP server from `/mnt/lace/plugins/lace-mcp/dist/index.js`. This assumes the MCP server is distributed as a lace plugin. This is a reasonable distribution strategy but creates a circular dependency: the MCP server is a plugin, but plugins are what the MCP server helps agents discover.

**Finding:** [non-blocking] The MCP server distribution strategy should be clarified. Two options: (a) distribute as a lace plugin (requires the plugin system to be working before the MCP server is available), or (b) include in the devcontainer image or as a devcontainer feature (available regardless of plugin status). Option (b) is more robust for the core introspection use case. The report mentions this in the feasibility table ("include in the devcontainer feature") but the `.mcp.json` example uses the plugin path. Pick one and be consistent.

#### 4.5 Feasibility assessment

The effort estimate (200-400 lines of TypeScript) is reasonable for a read-only introspection server. The risk assessment is accurate.

**Finding:** No issues.

#### 4.6 Alternative: shell-based introspection

The `/usr/local/bin/lace-env` fallback is a good pragmatic alternative. This is lower priority than the MCP server in principle, but since it is also lower effort, it could serve as an interim solution while the MCP server is developed.

**Finding:** [non-blocking] Consider promoting the shell script alternative from a footnote to a named recommendation (perhaps as a Tier 1.5 item). A `lace-env` shell script that outputs JSON is implementable in under an hour, provides immediate value, and can coexist with a future MCP server.

### Section 5: Environment Marker Design

#### 5.1 Environment manifest

The `/etc/lace/environment.json` schema is well-designed. It captures container identity, workspace layout, ports, plugins, features, and mount persistence information. The choice of `/etc/lace/` as the path is appropriate (system-level configuration, not user-writable).

**Finding:** [non-blocking] The manifest includes `container.id` and `container.hostname` as separate fields set to the same value (`abc123def456`). In Docker, `hostname` defaults to the container ID, so these are redundant. Consider keeping only `container.id` and noting that `hostname` may differ if explicitly set.

**Finding:** [non-blocking] The `features` array lists full feature URIs. Consider also including a `featureVersions` map that records the actual installed versions (not just the requested version constraints), since version drift between container rebuilds is one of the portability concerns.

#### 5.2 Environment variables

The proposed `LACE_*` variables are well-chosen and non-overlapping. The implementation note ("approximately 15 lines of code" in `generateExtendedConfig`) is accurate -- adding entries to the `containerEnv` section of the extended config requires only a few lines in `up.ts`.

However, the current `generateExtendedConfig` function in `up.ts` does not currently modify `containerEnv`. It modifies `mounts`, `postCreateCommand`, and `appPort`. Adding `containerEnv` merging is straightforward but requires the same pattern as the existing `mounts` merging.

**Finding:** [non-blocking] Note that `generateExtendedConfig` in `up.ts` will need a new code block for `containerEnv` merging, following the same pattern as the existing `mounts` block. This is trivial but should be called out so implementers know the function needs modification, not just a config change.

#### 5.3 Container identity file

Simple and useful. `/etc/lace/container-id` as a fast-read single-value file is a good complement to the full JSON manifest.

**Finding:** No issues.

#### 5.4 Mount sentinel files

The `.lace-plugin-info.json` sentinel file concept is good in principle but has a practical problem: the report notes plugins are mounted readonly by default. Writing a sentinel file into a readonly mount is not possible. The report acknowledges this parenthetically ("for override mounts that are writable") but then the recommendation (R8) suggests writing to "each plugin mount's root directory." This is inconsistent.

**Finding:** [non-blocking] Clarify that sentinel files can only be written to writable override mounts. For readonly mounts (the default), plugin metadata should be included in the central `/etc/lace/environment.json` manifest or in a separate file at `/etc/lace/plugins/<name>.json`. R8 should reflect this constraint.

### Section 6: Session Portability Challenges

#### 6.1 What breaks when sessions move

The table is comprehensive. The severity ratings are reasonable. The session path encoding issue being rated "High" is correct -- this is the most impactful breakage.

**Finding:** [non-blocking] The "Git state" row notes "Worktree vs. clone vs. bare repo structure differs" with Medium severity. Inside the container, `/workspace` is the bare repo root with worktrees as subdirectories. On the host, the project is typically a normal clone. This difference is more significant than "Medium" suggests because it affects git commands in non-obvious ways (e.g., `git log` in a worktree works differently than in a detached worktree). Consider upgrading to Medium-High or adding a note about specific git operations that break.

#### 6.2 Session migration scenarios

The three scenarios (container-to-host, container rebuild, cross-project) cover the main cases. Scenario B (container rebuild) is the most common real-world case and is well-analyzed.

**Finding:** [non-blocking] Missing scenario: **host-to-container**. A developer starts a session on the host (e.g., running Claude Code locally at `~/code/weft/lace`), then later wants to continue inside the devcontainer (at `/workspace/main`). This is the reverse of Scenario A and is arguably the most common migration direction for new lace users. The same path encoding mismatch applies.

#### 6.3 Mitigation strategies

**6.3.1 Session path aliasing**: Correctly identified as speculative. The `path-aliases.json` idea is interesting but the report is right to note Claude Code does not support this. Proposing it as a feature request is appropriate.

**6.3.2 Environment snapshot at session start**: The `onSessionStart` hook is a reasonable approach. However, the hook syntax shown uses a non-standard format. Claude Code hooks are configured in `.claude/settings.json` or `.claude/settings.local.json` under a `hooks` key, but the exact configuration schema should be verified against current Claude Code documentation. The report's example may not be valid.

**Finding:** [non-blocking] Verify the `onSessionStart` hook configuration syntax against actual Claude Code documentation. The hooks feature exists but the configuration format may differ from what is shown. If the hook system does not support `onSessionStart`, the same effect can be achieved via a shell alias or `postAttachCommand` in devcontainer.json.

**6.3.3 CLAUDE.md dynamic sections**: The `.claude.local.md` approach is excellent. This is a gitignored, per-instance file that Claude Code loads automatically. However, the example script has a quoting issue: it uses a heredoc with `'LOCALEOF'` (single-quoted, preventing variable expansion) but the body contains `$(hostname)`, `${LACE_SSH_PORT:-unknown}`, and other expansions that require the heredoc delimiter to be unquoted.

**Finding:** [blocking] The `.claude.local.md` generation script has a quoting bug. The heredoc delimiter `'LOCALEOF'` prevents variable expansion. Either remove the quotes (use `LOCALEOF`) or use explicit variable interpolation outside the heredoc. The current script would produce literal `$(hostname)` text in the output file.

### Section 7: Auto-Detection Pattern Catalog

The seven patterns are practical and progressively more sophisticated. They provide concrete, copy-paste-ready shell snippets that agents or developers can use.

**Finding:** [non-blocking] Pattern 7 (composite drift detection) writes state files to `.claude/` (e.g., `.claude/last-container-id`, `.claude/last-plugins.txt`, `.claude/last-cwd.txt`). Inside the devcontainer, `.claude/` maps to `/home/node/.claude`, which is bind-mounted to the host. This means drift state files persist across container rebuilds, which is the desired behavior. Good. But the pattern only detects drift; it does not write the current state for the next comparison. A companion "write current state" step should be included (or referenced from Section 6.3.2).

### Section 8: Recommendations

#### Tier 1 (Immediate)

R1 (Populate CLAUDE.md): Correct priority. Highest leverage. Subject to the content revisions noted in Section 3.2 above.

R2 (Inject LACE_* env vars): Correct priority. The "approximately 15 lines of code" estimate is accurate. This requires adding a `containerEnv` merging block to `generateExtendedConfig`.

R3 (Generate .claude.local.md): Correct priority. Subject to the heredoc quoting fix noted above.

**Finding:** No prioritization issues in Tier 1.

#### Tier 2 (Short-term)

R4 (Write environment.json): Reasonable placement. The implementation is slightly more involved than the report suggests because writing to `/etc/lace/` requires root permissions, which means the write must happen during container build (Dockerfile) or in `postCreateCommand` (which runs as root in some configurations but not all). The report should note this permission consideration.

**Finding:** [non-blocking] R4 should note that writing to `/etc/lace/` requires appropriate permissions. In devcontainers, `postCreateCommand` typically runs as the remoteUser (in this case `node`), which does not have write access to `/etc/`. Either the environment manifest should be written to a user-writable location (e.g., `/home/node/.lace/environment.json`) or the write should happen in the Dockerfile or via `sudo` in `postCreateCommand`.

R5 (onSessionStart hook): Reasonable placement. Depends on Claude Code hook support verification.

R6 (Create .claude/rules/): Reasonable placement. Low effort, good impact.

**Finding:** No prioritization issues in Tier 2, modulo the R4 permissions concern.

#### Tier 3 (Medium-term)

R7 (MCP server): Correct placement. Higher effort, requires the plugin/feature distribution decision.

R8 (Plugin sentinel files): Correct placement. Subject to the readonly mount constraint noted above.

**Finding:** No prioritization issues in Tier 3.

#### Tier 4 (Long-term)

R9 (Session path aliasing): Correctly identified as an upstream feature request. Appropriate placement.

R10 (Devcontainer feature for agent support): Good vision. Packaging all agent support mechanisms as a reusable devcontainer feature is the right long-term direction.

**Finding:** No prioritization issues in Tier 4.

### Section 9: Open Questions

All six open questions are relevant and well-framed. A few observations:

OQ1 (Agent-writable companion file): The `/tmp/lace/agent-notes.json` idea has ephemeral lifetime issues -- `/tmp` is wiped on container restart. Consider `/home/node/.lace/agent-notes.json` instead, which would persist via the bind mount if placed under the Claude config directory.

OQ3 (Auto-configure .mcp.json): The report correctly identifies the conflict risk. The answer is: do not auto-generate `.mcp.json`. Instead, document a manual setup step and/or provide a `lace init-mcp` command that creates it with appropriate warnings.

OQ5 (Session portability CLI command): The report correctly notes coupling risk to Claude Code internals. This should remain a long-term consideration, not an immediate action item.

OQ6 (Interaction with teleportation): Good question. The report does not attempt an answer. This is fine for a research report; the answer requires empirical testing with the teleportation feature.

**Finding:** [non-blocking] OQ1 should suggest `/home/node/.lace/` instead of `/tmp/lace/` for persistence across container restarts.

### References

The codebase references are accurate. All cited files exist at the specified paths and contain the described functionality. The external references are relevant and well-chosen.

**Finding:** No issues.

## Verdict

**Accept with revisions.** The report is a solid research foundation that accurately maps the gap and proposes a practical remediation strategy. The three blocking findings should be addressed before using this report as an implementation guide:

1. Separate the CLAUDE.md proposal into "implementable today" vs. "requires environment markers first" tiers.
2. Correct the MCP tool schemas to align with the actual MCP specification (remove or annotate `outputSchema`).
3. Fix the heredoc quoting bug in the `.claude.local.md` generation script.

The non-blocking findings are improvements that strengthen the report but do not block its use as a planning document.

## Action Items

1. [blocking] Revise Section 3.2 to separate CLAUDE.md content into what can be added today (project structure, paths, commands) vs. what requires Section 5 markers to be implemented first (runtime environment detection instructions). See Section 3.2 finding above.

2. [blocking] Remove `outputSchema` from the MCP tool definitions in Section 4.1, or clearly annotate them as informational documentation of expected return format rather than part of the wire protocol schema. If targeting the 2025-06-18 spec's optional `outputSchema`, note the SDK support status. See Section 4.1 finding.

3. [blocking] Fix the heredoc quoting in Section 6.3.3's `.claude.local.md` generation script. Change `'LOCALEOF'` to `LOCALEOF` to enable variable expansion. See Section 6.3.3 finding.

4. [non-blocking] Correct the characterization of `.claude/rules/cdocs.md` in Section 2. It is a plugin-provided reference, not a missing file.

5. [non-blocking] Verify the `overview_and_quickstart.md` reference to `.claude/WORKTREE_CONTEXT.md` in Section 3.3.

6. [non-blocking] Simplify `lace_session_history` tool to auto-discover the previous environment snapshot rather than requiring a path argument. See Section 4.1 finding.

7. [non-blocking] Clarify MCP server distribution: plugin vs. devcontainer feature. Make the `.mcp.json` example consistent with the chosen approach. See Section 4.4 finding.

8. [non-blocking] Consider promoting the `lace-env` shell script alternative to a named recommendation at Tier 1.5. See Section 4.6 finding.

9. [non-blocking] Address the `/etc/lace/` write permission issue in R4. Consider `/home/node/.lace/` as an alternative. See Tier 2 findings.

10. [non-blocking] Add a "host-to-container" migration scenario to Section 6.2. See Section 6.2 finding.

11. [non-blocking] Clarify that plugin sentinel files (R8) cannot be written to readonly mounts. Provide alternative for readonly plugins. See Section 5.4 finding.

12. [non-blocking] Add a "write current state" companion step to Pattern 7's drift detection script. See Section 7 finding.
