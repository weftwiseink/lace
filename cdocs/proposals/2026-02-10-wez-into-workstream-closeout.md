---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T18:00:00-08:00
task_list: lace/wezterm-plugin
type: proposal
state: live
status: review_ready
tags: [wez-into, closeout, nushell, cli, devcontainer, workstream-tracking]
related_to:
  - cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
  - cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md
  - cdocs/proposals/2026-02-10-wez-into-end-to-end-integration-testing.md
  - cdocs/reports/2026-02-08-wez-into-cli-command-status.md
  - cdocs/reports/2026-02-09-wez-into-packaging-analysis.md
  - cdocs/devlogs/2026-02-10-wez-into-e2e-integration-testing.md
---

# wez-into Workstream Closeout Plan

> **BLUF:** The wez-into workstream has delivered its core value: a working `wez-into` bash script that connects WezTerm to lace-managed devcontainers, validated end-to-end against both the lace and dotfiles containers. Three items remain from the original five-phase proposal: Phase 2 (nushell module), Phase 3 (`--start` flag), and Phases 4-5 (deprecation of predecessor scripts). The nushell module should be deferred -- the bash script works in nushell via PATH fallback and the packaging analysis explored options that are premature for a single-user tool. The `--start` flag should be deferred -- it requires `projects.conf` infrastructure and `devcontainer up` orchestration that adds significant complexity for a marginal convenience gain now that both containers are lacified and stay running. The predecessor script deprecation (Phase 4-5) is partially done: `open-lace-workspace` was already deleted in the self-hosting migration. The remaining item is `wez-lace-into`, which should get a deprecation notice. This closeout plan lists all remaining items, classifies each as "do now" vs "defer," and defines a final verification checklist.

## Workstream Assessment

### What was proposed (original five phases)

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Bash script in lace repo | **Done.** `bin/wez-into` (263 lines) with connect, picker, `--list`, `--status`, `--dry-run`, `--help`, host key pre-population. Validated E2E. |
| 2 | Nushell module (`bin/wez-into.nu`) | **Not started.** Illustrative code in proposal only. |
| 3 | `--start` flag (cold-start container startup) | **Not started.** Deliberately deferred during Phase 1 implementation. |
| 4 | Deprecate `wez-lace-into` | **Not started.** `wez-lace-into` still exists without deprecation notice. |
| 5 | Retire `open-lace-workspace` | **Done.** Deleted in the self-hosting migration (commit `2410918`). |

### What was delivered beyond the proposal

- `--dry-run` flag (not in original proposal, added during Phase 1 implementation)
- Host key pre-population via `ssh-keyscan` to prevent WezTerm trust prompt (not in proposal)
- E2E integration testing across the full pipeline (`lace up` -> Docker -> `lace-discover` -> `wez-into` -> WezTerm)
- Three bugs found and fixed during E2E testing: `lace-discover` JSON output, Dockerfile path rewriting in `up.ts`, dotfiles GHCR metadata workaround
- Packaging analysis report exploring standalone repo, chezmoi externals, nupm, vendor autoload

### Key architectural decisions that hold

1. **Script lives in lace repo** (Decision 2 reversal from R3). Co-location with `lace-discover` works well. No chezmoi deployment needed.
2. **Bash primary, nushell falls through via PATH.** Nushell users invoke the bash script transparently. No loss of functionality.
3. **`exec wezterm connect`** replaces the shell process. Correct behavior for a CLI connector.
4. **Delegates to `lace-discover`** for Docker container discovery. Single source of truth for discovery logic.

## Remaining Items

### 1. Deprecate `wez-lace-into` [DO NOW]

**What:** Add a deprecation notice to `bin/wez-lace-into` that prints a warning on stderr pointing users to `wez-into`, then delegates to `wez-into` for actual execution.

**Why now:** `wez-lace-into` and `wez-into` do the same thing. Having both is confusing. The deprecation notice costs minutes to add and prevents future confusion.

**Scope:**
- Add a `>&2 echo "DEPRECATED: Use 'wez-into' instead of 'wez-lace-into'"` at the top of `bin/wez-lace-into`
- Optionally: replace the body with `exec "$(dirname "$0")/wez-into" "$@"` to delegate entirely

### 2. Nushell module (`wez-into.nu`) [DEFER]

**What:** A nushell custom command module providing structured output, `input list` picker, and tab completion.

**Why defer:**
- The bash script works transparently in nushell via PATH fallback. There is zero loss of functionality.
- The packaging analysis (2026-02-09) explored multiple distribution options (standalone repo, chezmoi externals, vendor autoload, nupm). All add infrastructure complexity for a single-user tool on a single machine.
- The nushell ecosystem's packaging story (nupm) is explicitly "not production-ready."
- The main benefit (structured output, `input list`) is a quality-of-life improvement, not a functional gap.
- The illustrative code in the proposal includes Phase 3 features (`--start`, `resolve-workspace-path`) that do not exist yet, so implementing Phase 2 now would mean either shipping incomplete code or deviating from the proposal.

**Reopen when:** Either (a) a second machine needs `wez-into` and the packaging question becomes real, or (b) the nushell experience gap becomes a daily friction point.

### 3. `--start` flag (cold-start support) [DEFER]

**What:** A `--start` flag that starts a stopped container via `devcontainer up`, then connects.

**Why defer:**
- Both the lace and dotfiles containers are now lacified and stay running as long as Docker is up. Cold-start is rare.
- Implementing `--start` requires: (a) a `projects.conf` file mapping project names to workspace paths, (b) Docker stopped-container label lookup, (c) `devcontainer up` invocation and wait logic, (d) re-discovery after startup. This is significant complexity.
- The Gen 1 launchers had this capability but were 374-379 lines each. The value of `wez-into` is being thin (263 lines). Adding `--start` would roughly double the script size.
- The user can manually run `lace up --workspace-folder <path>` and then `wez-into <project>`. Two commands instead of one is acceptable for an infrequent operation.

**Reopen when:** Cold-starting containers becomes a frequent workflow (e.g., containers are stopped overnight, or new machines are set up regularly).

### 4. `lace-discover` user detection for dotfiles [DEFER]

**What:** `lace-discover` reports `node` for the dotfiles container instead of `vscode` because it defaults to `node` when `Config.User` is `root` or empty.

**Why defer:**
- The user field in `lace-discover` is informational only -- it appears in `wez-into --status` output.
- The actual SSH username for WezTerm connections is handled by the `lace.wezterm` plugin via `docker inspect`, independent of `lace-discover`.
- Fixing this properly requires either: (a) inspecting the image's default user, (b) reading the `remoteUser` from devcontainer metadata, or (c) a convention file. All add complexity.
- The E2E devlog documents this as a known limitation with evidence.

**Reopen when:** The `lace-discover` user field is used for something functional (e.g., SSH connection), not just display.

**Update (2026-02-10):** Commit `fe95926` added `remoteUser` detection from devcontainer metadata to `lace-discover`, which should fix this for containers with a `remoteUser` set. Verify this the next time both containers are running.

### 5. Publish wezterm-server feature to GHCR with `hostSshPort` [DO NOW -- DONE]

**What:** The wezterm-server feature on GHCR needed to be updated to include the `hostSshPort` option and `customizations.lace.ports` metadata.

**Status:** Completed in the GHCR publish devlog (2026-02-10). The `:1` tag on GHCR now points to v1.1.0 with the correct metadata. The dotfiles container still has an explicit `appPort` workaround from the E2E testing (Bug #1) which can be removed after verifying the updated registry metadata is cached.

### 6. Remove dotfiles explicit `appPort` workaround [DO NOW]

**What:** During E2E testing, an explicit `appPort: ["${lace.port(wezterm-server/hostSshPort)}:2222"]` was added to the dotfiles devcontainer.json as a workaround for stale GHCR metadata (Bug #1 in the E2E devlog). Now that the feature is published to GHCR with correct metadata, the workaround should be removed and auto-injection should be verified.

**Scope:**
- Clear the local metadata cache for wezterm-server
- Remove the explicit `appPort` from `/home/mjr/code/personal/dotfiles/.devcontainer/devcontainer.json`
- Run `lace up --no-cache` for dotfiles and verify auto-injection produces the correct `appPort`
- If auto-injection works, commit the removal. If not, keep the workaround and document why.

## Verification Plan

Final checklist to confirm the workstream is complete:

| # | Check | How to verify |
|---|-------|---------------|
| V1 | `wez-into --list` shows both projects | Run with both containers up |
| V2 | `wez-into --dry-run lace` produces correct command | Check port matches `port-assignments.json` |
| V3 | `wez-into --dry-run dotfiles` produces correct command | Check port matches `port-assignments.json` |
| V4 | `wez-into lace` opens WezTerm window | Manual: shell prompt, `whoami` = `node` |
| V5 | `wez-into dotfiles` opens WezTerm window | Manual: shell prompt, `whoami` = `vscode` |
| V6 | `wez-lace-into` shows deprecation notice | Run after adding notice |
| V7 | `lace-discover --json` returns valid JSON | Pipe through `python3 -m json.tool` |
| V8 | No stale `sshPort` references in live cdocs | Search cdocs for `sshPort` in non-archived, non-historical context |
| V9 | Interactive picker works with fzf | Run `wez-into` with both containers up |

Items V1-V3 and V7 were already verified in the E2E devlog. V4-V5 require manual verification (marked as MANUAL in the E2E scorecard). V6 is new work from this closeout. V8 was addressed as part of this closeout (self-hosting proposal updated). V9 was not explicitly tested in the E2E devlog.

## Documents to Update After Closeout

| Document | Update needed |
|----------|---------------|
| `cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md` | Mark `status: done` after V1-V6 verified. Add note that Phases 2-3 are deferred. |
| `cdocs/reports/2026-02-09-wez-into-packaging-analysis.md` | No change. Analysis remains valid for when Phase 2 is reopened. |
| `cdocs/proposals/2026-02-09-lace-devcontainer-self-hosting.md` | Mark `status: done` (all phases implemented). |
