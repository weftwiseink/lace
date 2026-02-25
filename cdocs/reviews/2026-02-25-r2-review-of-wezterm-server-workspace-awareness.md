---
review_of: cdocs/proposals/2026-02-25-wezterm-server-workspace-awareness.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-25T17:30:00-06:00
task_list: lace/wezterm-server
type: review
state: live
status: done
tags: [rereview_agent, architecture, devcontainer, edge_cases, privilege_drop, entrypoint, env_var_inheritance]
---

# Review (Round 2): Workspace-Aware wezterm-server: Eliminating the Per-Project wezterm.lua

## Summary Assessment

This round 2 review verifies fixes to the two non-blocking items from round 1: the incorrect E1 mitigation suggesting `WEZTERM_CONFIG_FILE` as an override, and the missing edge case about entrypoint running as root.
Both items have been substantively addressed: E1 now correctly documents that `WEZTERM_CONFIG_FILE` does not override `--config-file`, and the new E6 edge case thoroughly covers the root-to-user privilege drop with a concrete `su -c` pattern.
However, the fix to E1 was not propagated to D2, which still contains the incorrect `WEZTERM_CONFIG_FILE` suggestion.
Verdict: **Accept** with one non-blocking fix for D2 consistency.

## Round 1 Action Item Disposition

### Action Item 1 (E1 mitigation): Addressed

The E1 mitigation (lines 404-412) has been rewritten. The previous incorrect option suggesting `WEZTERM_CONFIG_FILE` as an override has been replaced with two correct options:

1. Replace the feature's config file via bind mount or Dockerfile COPY.
2. Override the entrypoint entirely with their own startup script.

A clarifying note is added: "WEZTERM_CONFIG_FILE env var does NOT override the --config-file CLI flag used in the entrypoint."

This is correct. WezTerm's `--config-file` CLI flag takes precedence over the `WEZTERM_CONFIG_FILE` environment variable.

### Action Item 2 (root user context): Addressed

A new E6 edge case (lines 440-467) documents the root user context comprehensively:

- Explains that feature entrypoints typically execute as root during container init.
- Notes that `_REMOTE_USER` is available at install time but not at container runtime.
- Recommends baking the username at install time (approach 1) and explains why.
- Provides a concrete entrypoint script using `su -c`.

The entrypoint script in the overview section (lines 217-229) has been updated to include the `su -c` privilege drop with a root check. The Phase 1 implementation (lines 502-518) shows the corresponding `install.sh` heredoc that bakes `$_REMOTE_USER` at feature install time. Both are consistent with each other: the overview shows the rendered output (hardcoded `node`), and Phase 1 shows the template that produces it.

## New Findings

### D2 still references WEZTERM_CONFIG_FILE as an override (non-blocking)

D2 (line 345-346) states:

> If a user wants to override the feature's config entirely, they can replace the entrypoint or set `WEZTERM_CONFIG_FILE` env var.

This directly contradicts E1's corrected note (lines 410-412):

> Note: `WEZTERM_CONFIG_FILE` env var does NOT override the `--config-file` CLI flag used in the entrypoint.

The E1 fix was correctly applied but D2 was not updated to match. D2 should read something like: "they can replace the entrypoint or replace the config file at `/usr/local/share/wezterm-server/wezterm.lua`."

### Environment variable inheritance through su -c (non-blocking observation)

The entrypoint uses `su -c 'wezterm-mux-server ...' node` to drop privileges. The `su` command without `-l` (login shell) typically preserves the parent process's environment on most Linux distributions. This means `CONTAINER_WORKSPACE_FOLDER` (set via `docker run -e`) should be inherited by the `wezterm-mux-server` process.

However, if the container's PAM configuration for `su` includes modules that reset the environment (e.g., `pam_env` with `user_readenv=1`), the env var could be lost. In the devcontainer context (Debian-based images), the default PAM config for `su` preserves the environment, so this should work. Implementers should verify with a quick `su -c 'env | grep CONTAINER_WORKSPACE_FOLDER' node` in the test plan.

This is not a proposal-level concern but is worth noting for Phase 1 testing.

### Heredoc indentation in Phase 1 code (non-blocking)

The Phase 1 install.sh snippet (lines 504-517) uses `<< ENTRYPOINT` (unquoted, non-stripping heredoc) with the content and closing delimiter indented inside a markdown code block. In a real shell script, the closing `ENTRYPOINT` delimiter must appear at column 0 (no leading whitespace) unless `<<-` is used with tab indentation. This is an artifact of the proposal's code formatting and not an error in the proposal itself, but implementers should be aware of this when translating the snippet to actual shell code.

### Overall coherence after changes

The proposal reads coherently after the E1/E6 additions. E6 flows naturally after E5 (feature without lace) by addressing the privilege context question. The overview entrypoint, E6 explanation, and Phase 1 implementation are all consistent in their use of the `su -c` pattern. The `_REMOTE_USER` baking approach is consistent with how the existing `install.sh` already uses `_REMOTE_USER` for runtime directory creation (line 79 of the current `install.sh`).

## Verdict

**Accept.** Both round 1 action items have been properly addressed. The E1 mitigation is now technically correct, and the E6 edge case provides thorough coverage of the root-user privilege context. The one remaining inconsistency (D2 still referencing `WEZTERM_CONFIG_FILE`) is non-blocking and easily fixed. The proposal is ready for implementation.

## Action Items

1. [non-blocking] Update D2 rationale (line 346) to remove the `WEZTERM_CONFIG_FILE` reference, which contradicts the corrected E1 note. Replace with "replace the entrypoint or replace the config file" to match E1's guidance.
2. [non-blocking] Add an env var inheritance check to the Phase 1 test plan: verify `CONTAINER_WORKSPACE_FOLDER` survives the `su -c` privilege drop in the target base image.
