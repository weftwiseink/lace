---
review_of: cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T20:00:00-06:00
task_list: lace/wezterm-server
type: review
state: live
status: done
tags: [fresh_agent, architecture, test_plan, technical_accuracy, code_snippets, entrypoint, heredoc_escaping, proposal_report_boundary]
---

# Review (Round 3): Workspace-Aware wezterm-server: Eliminating the Per-Project wezterm.lua

## Summary Assessment

This proposal eliminates five coordinated pieces of per-project wezterm boilerplate by making the wezterm-server feature self-starting (via entrypoint) and workspace-aware (via env var).
The restructured version separates research into a companion report and expands implementation phases with exact file paths, line numbers, complete code snippets, and test cases with assertions.
The architecture is sound, the code snippets are accurate against the current source, and prior review action items have been addressed.
Verdict: **Accept** with two non-blocking items.

## Round 2 Action Item Disposition

### Action Item 1 (D2 WEZTERM_CONFIG_FILE reference): Addressed

D2 (proposal lines 102-109) now states "Users override by replacing the file (bind mount or COPY) or replacing the entrypoint" and includes a NOTE clarifying that `WEZTERM_CONFIG_FILE` does NOT override `--config-file`.
This is consistent with the E1 edge case.

### Action Item 2 (su -c env var inheritance test): Addressed

Phase 1.4 (proposal lines 260-267) includes an explicit "su -c env var inheritance test" that verifies `CONTAINER_WORKSPACE_FOLDER` survives the `su -c` privilege drop, with a parenthetical noting that `su` without `-l` preserves parent env on Debian-based images.

## Section-by-Section Findings

### Proposal-Report Boundary

The split is well-executed.
The proposal contains everything an implementer needs: objective, architecture table, design decisions, edge cases, phased implementation with code.
The report contains the CLI source code investigation that justifies why alternatives were rejected.
The proposal's "Background" and "Design Decisions" sections are self-sufficient: an implementer does not need to read the report to understand what to build or why.

The report's "Approaches Considered" section (A through F) provides useful context for reviewers and future architects but is not essential for implementation.
This is the correct boundary.

**No issues.**

### Technical Accuracy: Phase 1 Code Snippets vs. Actual Source

**`install.sh`:** The proposal says to append after "line 75" (binary installation) and "line 83" (runtime directory creation).
The actual `install.sh` has the case statement ending at line 75, runtime directory creation at lines 78-83, and final echo at lines 85-86.
The insertion point description is accurate: the new code appends after all existing functionality.

**`devcontainer-feature.json`:** The diff adding `"entrypoint"` and bumping to v1.3.0 is straightforward and correct.
The current file is at v1.2.0 and has no existing `entrypoint` field.

**`up.ts` line references:** The proposal says to insert "after line 738, before the 'Write extended config' comment at line 740."
Verified: line 738 is the closing brace of `if (options.projectName)`, line 740 is `// Write extended config`.
The injection point is precisely correct.

The Phase 2 code snippet uses `options.projectName` (not bare `projectName`), which matches the function's pattern: `projectName` is accessed via `options.projectName` throughout the function body (it is not destructured at lines 645-652).
This was noted as a concern in round 1, and the current proposal uses the correct form.

**`.devcontainer/Dockerfile` lines 100-104:** Verified: lines 100-104 contain the exact `mkdir -p /home/${USERNAME}/.config/wezterm` and `chown` commands shown in the proposal's Phase 3.3 diff.

**`.devcontainer/devcontainer.json`:** The mounts array (line 52-58) contains the wezterm.lua bind mount at line 55.
The `postStartCommand` (line 70) contains `wezterm-mux-server --daemonize 2>/dev/null || true`.
Both match the proposal's Phase 3.2 diffs.

**`up-mount.integration.test.ts` lines 1138-1191:** The test fixture at line 1147 contains the wezterm.lua mount string, and lines 1185-1189 contain the preservation assertion.
The proposal's Phase 3.4 diffs are accurate.

**No issues with technical accuracy.**

### Phase 1 Entrypoint Heredoc: Escaping Subtlety (Non-blocking)

The entrypoint heredoc (proposal lines 178-192) uses an unquoted heredoc (`<< ENTRYPOINT`), so shell variables expand at install time.
This is intentional: `${_REMOTE_USER}` and `$WEZTERM_SERVER_DIR` bake their values into the output.
The `\$(id -u)` correctly escapes to produce a runtime `$(id -u)` in the output.

The `\\` at end of lines within the `su -c '...'` string produces `\<newline>` in the output.
Inside single quotes, this is a literal backslash followed by a newline.
When `su -c` passes this to `sh`, the shell interprets `\<newline>` as line continuation, so the multi-line command joins correctly.
This works but is a two-level shell interpretation that an implementer might find confusing.

Consider putting the `su -c` command on a single line to avoid the multi-level escaping:

```sh
su -c 'wezterm-mux-server --daemonize --config-file /usr/local/share/wezterm-server/wezterm.lua 2>/dev/null || true' ${_REMOTE_USER}
```

This is clearer and avoids any ambiguity about backslash-newline semantics across shell layers.

### Phase 2 Test Coverage

The five proposed tests cover the key scenarios well:
1. Injection of `CONTAINER_WORKSPACE_FOLDER` from `workspaceFolder`.
2. Injection of `LACE_PROJECT_NAME`.
3. No-overwrite of user-defined `CONTAINER_WORKSPACE_FOLDER`.
4. No injection when `workspaceFolder` is absent.
5. Preservation of existing `containerEnv` entries.

**Weak assertion in test 4 (non-blocking):** The test "does not inject CONTAINER_WORKSPACE_FOLDER when workspaceFolder absent" (proposal lines 408-438) uses a conditional assertion:

```typescript
if (!extended.workspaceFolder) {
  expect(containerEnv?.CONTAINER_WORKSPACE_FOLDER).toBeUndefined();
}
```

If `workspaceFolder` happens to be set (e.g., if lace's workspace detection assigns a default even for image-only configs), the entire assertion is skipped and the test passes vacuously.
This could be strengthened by asserting that `workspaceFolder` is indeed absent for this config shape, or by using `expect(extended.workspaceFolder).toBeUndefined()` as a precondition.
Not blocking because the test body acknowledges the ambiguity with its comment, but an implementer should verify the assumption.

### Edge Cases

The edge case table covers seven scenarios.
All previously identified cases (user custom config, entrypoint ordering, workspace path changes, user-defined env var, feature without lace, entrypoint as root, feature not installed) are present.

**No gaps identified.**

### Design Decisions

D1 through D5 are internally consistent and well-reasoned.
D2 now correctly documents the `WEZTERM_CONFIG_FILE` limitation.
D5's `$_REMOTE_USER` baking approach is consistent with the existing `install.sh` line 79 (`_REMOTE_USER="${_REMOTE_USER:-root}"`).

**No issues.**

### Writing Quality

The proposal follows cdocs conventions:
- BLUF is present and accurate.
- Sentence-per-line formatting is used throughout.
- Colons preferred over em-dashes.
- No emojis.
- Tables are used effectively for the architecture overview and edge cases.
- Code snippets use diffs where showing changes and full blocks where showing new code.
- The `related_to` frontmatter links the companion report and investigation.

One minor convention note: the `related_to` field is not defined in the frontmatter spec (`plugins/cdocs/rules/frontmatter-spec.md`).
This is fine as an extension, and both the proposal and report use it consistently.

### Research Report

The report is well-structured, sourced from specific CLI files, and reaches clear conclusions.
The four key findings are logically ordered and each has a stated implication.
The six approaches considered are each concisely evaluated with clear accept/reject reasoning.
The "Source Files Examined" table provides an audit trail.

The report correctly identifies that feature `containerEnv` values are not substituted (finding #1), which is the key insight ruling out approach D.
The entrypoint mechanism description (finding #2) matches the pattern used by docker-in-docker.
The `containerEnv` availability via `docker run -e` (finding #4) correctly distinguishes it from `remoteEnv`.

**No issues with the report.**

## Verdict

**Accept.** The restructured proposal-report pair is clear, technically accurate, and implementation-ready.
The implementation phases provide exact file paths, line numbers, and copy-ready code snippets.
The test coverage is comprehensive.
Both prior review rounds' action items have been addressed.
Two non-blocking improvements are noted below.

## Action Items

1. [non-blocking] Simplify the Phase 1 entrypoint heredoc's `su -c` command to a single line, avoiding the two-level `\<newline>` interpretation across the heredoc boundary and the `su -c` shell invocation.
2. [non-blocking] Strengthen the Phase 2 test "does not inject CONTAINER_WORKSPACE_FOLDER when workspaceFolder absent" by adding a precondition assertion that `extended.workspaceFolder` is undefined, rather than conditionally skipping the check.
