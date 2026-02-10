---
review_of: cdocs/proposals/2026-02-08-wez-into-devcontainer-cli.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-08T10:45:00-08:00
task_list: lace/wezterm-plugin
type: review
state: live
status: done
tags: [self, architecture, nushell, chezmoi, deployment, implementation_feasibility]
---

# Review: `wez-into` -- Universal CLI for WezTerm Devcontainer Connection

## Summary Assessment

This proposal solves a real and well-defined problem: the user wants to type `wez-into lace` from any terminal. The architecture is sound -- thin orchestration layer delegating to existing tools. The dual bash/nushell approach is practical. There are two blocking issues: (1) the chezmoi deployment path uses a `dot_local/private_bin/` directory that does not exist in the dotfiles repo and uses an incorrect chezmoi convention for executability, and (2) the nushell module uses `source` while the proposal says `use`, but the existing config.nu pattern uses `source` not `use` -- and `source` has parse-time implications documented in the project memory. One non-blocking concern about the `--start` flag hiding `devcontainer up` output from the user.

**Verdict: Revise.** Two blocking issues need resolution before acceptance.

## Section-by-Section Findings

### BLUF

Clear, complete, and accurate. Correctly identifies the predecessor, the deployment mechanism, and the key prerequisite.

### Objective

Well-scoped. The four requirements (accessible, short, multi-project, shell-native) are testable.

### Background

Thorough and well-referenced. Correctly identifies the three problems with `wez-lace-into`.

**Finding 1 (non-blocking): Claim about chezmoi deployment path.**
The proposal states "Files at `dot_local/bin/` deploy to `~/.local/bin/`." This is technically correct for chezmoi's naming convention, but `dot_local/` does not exist in the dotfiles repo. This is not blocking (creating it is fine), but it should be noted as a new directory that must be created.

### Proposed Solution -- File Locations

**Finding 2 (blocking): chezmoi `private_bin` convention is wrong.**

The proposal uses `dot_local/private_bin/wez-into` and states "chezmoi `private_` prefix ensures 0700 permissions, making it executable." This is incorrect on two counts:

1. Chezmoi's `private_` prefix sets the directory permissions to 0700 (owner-only access), but it does NOT make files inside executable. Files still need the `executable_` prefix to get the execute bit. Without it, `wez-into` would be deployed as a regular file (0600 or 0644), not executable.

2. The correct chezmoi path for an executable script at `~/.local/bin/wez-into` would be: `dot_local/bin/executable_wez-into`. This uses `executable_` on the file (sets 0755) within a normal directory. Alternatively, if the file already has the shebang and execute bit in the source, chezmoi preserves permissions from the source file.

The dotfiles repo has no existing `dot_local/` directory, so there is no precedent to follow within the repo. The `run_once_before_*` scripts at the repo root use plain filenames (not `executable_` prefix), but those are executed by chezmoi itself, not deployed to a target path.

**Recommendation:** Use `dot_local/bin/executable_wez-into` as the chezmoi source path. Or, since the user's existing `run_once` scripts do not use the `executable_` prefix pattern, verify the preferred approach by checking chezmoi documentation or testing `chezmoi add --autotemplate ~/.local/bin/wez-into` after manually placing the script.

### Proposed Solution -- Nushell Implementation

**Finding 3 (blocking): `use` vs `source` mismatch with existing config.nu pattern.**

The proposal says to add `use scripts/wez-into.nu *` to `config.nu`. However, the existing `config.nu` uses `source` for all six script modules (aliases.nu, colors.nu, etc.), not `use`. The project memory explicitly warns: "Nushell `source` is parse-time: all sourced files must exist before nushell starts."

The `use` keyword works differently from `source` in nushell:
- `source` executes the file in the current scope (like bash `source`). All definitions become available in the current scope.
- `use` imports a module. When using `use scripts/wez-into.nu *`, the file must define exportable commands (with `export def`).

The proposal's nushell code uses bare `def`, not `export def`. For `use ... *` to work, all `def` commands must be prefixed with `export`. Additionally, `use` is also parse-time in nushell, so the same "file must exist" constraint applies.

**Recommendation:** Either:
- (a) Change the nushell code to use `export def` for all public commands and keep the `use` approach (cleaner namespacing), or
- (b) Switch to `source` to match the existing config.nu pattern and use bare `def` (consistent with repo conventions).

Option (a) is better -- `use` with `export def` gives proper module semantics and the `wez-into` subcommand pattern benefits from it. But the code must be updated to add `export` to all the `def` statements that should be public.

### Proposed Solution -- Bash Implementation

**Finding 4 (non-blocking): `--start` suppresses `devcontainer up` output.**

The bash implementation runs `devcontainer up --workspace-folder "$workspace_path" >/dev/null 2>&1`. This hides all output, including build progress and errors beyond the exit code. For a potentially long-running operation (container builds can take minutes), showing no output is a poor experience. The nushell version has the same issue (`| ignore`).

**Recommendation:** Stream `devcontainer up` stderr to the user (redirect stdout to /dev/null but keep stderr, or use `2>&1` to a log file with a message about where to find it). This gives visibility into what is happening during the build. Example: `devcontainer up --workspace-folder "$workspace_path" 2>&1 | tee /tmp/wez-into-devcontainer-up.log >&2`.

**Finding 5 (non-blocking): `resolve_workspace_path` subshell variable capture.**

In the bash implementation, `resolve_workspace_path()` uses a `while read` loop inside a pipeline to search Docker containers. Due to bash's subshell behavior with pipelines, the `folder` variable is set inside a subshell created by the pipe and the `while` loop. However, the function uses `$()` command substitution which captures stdout, so this actually works correctly. No action needed, but it is worth noting for clarity.

**Finding 6 (non-blocking): Nushell `input list` returns empty string on escape, not null.**

The proposal checks `if ($choice | is-empty)` after `input list`. In nushell 0.110.0 (the installed version), `input list` returns `null` when the user presses Escape, not an empty string. The `is-empty` check handles both cases, so this works, but the mental model in the code comment could be more precise.

### Design Decisions

All six decisions are well-reasoned. Decision 3 (bash primary, nushell companion) is particularly well-justified.

**Finding 7 (non-blocking): Decision 6 -- `exec` behavior with nushell.**

The proposal discusses `exec wezterm connect` replacing the shell process. This is correct for the bash implementation. However, in the nushell version, `^wezterm connect` does NOT use `exec` -- it runs the external command as a child process. When `wezterm connect` blocks (as the status report notes), the nushell process waits. This is acceptable behavior but differs from the bash version. The nushell version could use `exec` via `^exec wezterm connect ...` but nushell does not have a built-in `exec` -- the `^exec` would invoke the system `exec` command. This is a minor behavioral divergence that does not need to be fixed, but the proposal should acknowledge it.

### Edge Cases

Thorough coverage. The `lace-discover` fallback paths and the project name ambiguity edge case are well-handled.

### Test Plan

Comprehensive. Good coverage of both bash and nushell variants.

**Finding 8 (non-blocking): Missing chezmoi permission verification test.**

The test plan includes "chezmoi apply places wez-into at ~/.local/bin/wez-into with correct permissions" but does not specify what the correct permissions are or how to verify. Add: "Verify with `ls -la ~/.local/bin/wez-into` -- should show execute permission (e.g., `-rwxr-xr-x` or `-rwx------`)."

### Implementation Phases

Well-structured with clear dependencies. Phase 3 (--start) being deferred from Phase 1 is a good call.

### Open Questions

**Finding 9 (non-blocking): Open Question 1 is partially answerable.**

The dotfiles repo does not currently use chezmoi's `private_` or `executable_` prefixes anywhere (verified by grep). The `dot_local/` directory does not exist. This means the implementer needs to establish the convention. The chezmoi documentation states that `executable_` on a file sets mode 0755. This resolves the question -- use `dot_local/bin/executable_wez-into`.

**Finding 10 (non-blocking): Open Question 3 is answerable.**

Nushell version is 0.110.0 (verified). `input list` has been available since nushell 0.86.0. This is not a concern.

## Verdict

**Revise.** Two blocking issues must be resolved:

1. Fix the chezmoi deployment path from `dot_local/private_bin/wez-into` to `dot_local/bin/executable_wez-into` (or equivalent correct convention).
2. Add `export` to nushell `def` statements that should be public, and decide whether to use `use` or `source` in config.nu (recommend `use` with `export def`).

## Action Items

1. [blocking] Fix chezmoi path: change `dot_local/private_bin/wez-into` to `dot_local/bin/executable_wez-into` throughout the proposal (File Locations table, Phase 1 scope, Phase 3 files modified). Update the explanation of the naming convention.
2. [blocking] Add `export` keyword to all public `def` commands in the nushell module (`wez-into`, `wez-into discover`, `wez-into list`, `wez-into status`). Keep `resolve-workspace-path` as a non-exported helper. Clarify in Phase 2 that `use` (not `source`) is the correct approach for module loading.
3. [non-blocking] Change `devcontainer up` invocation in `--start` to show stderr output instead of suppressing all output. Users need visibility into long-running container builds.
4. [non-blocking] Note in Decision 6 that the nushell version does not use `exec` and runs `wezterm connect` as a blocking child process (minor behavioral divergence from bash).
5. [non-blocking] Resolve Open Question 1: use `dot_local/bin/executable_wez-into` as the chezmoi convention.
6. [non-blocking] Resolve Open Question 3: nushell 0.110.0 supports `input list` (available since 0.86.0). Not a concern.
7. [non-blocking] Add permission verification step to integration test: verify `ls -la ~/.local/bin/wez-into` shows execute permission after `chezmoi apply`.
