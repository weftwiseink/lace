---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T01:15:00-08:00
task_list: lace/dogfooding
type: devlog
state: archived
status: done
tags: [investigation, research, wezterm, sshd, ports, devcontainer, prebuild]
---

# Wezterm and SSHD Port Mechanics Investigation: Devlog

## Objective

Research two foundational questions about the lace port architecture:
1. Does `wezterm-mux-server` have its own TCP port configuration independent of SSH?
2. Can the upstream sshd feature's port be altered at runtime when the feature is prebaked into an image?

These questions feed into the symmetric-prebuild-port-binding proposal and determine whether the `containerPort` metadata approach is necessary or if there are simpler alternatives.

## Plan

1. Read all local lace source files related to wezterm-server, sshd, port allocation, and devcontainer configs.
2. Fetch upstream sshd feature source (`install.sh`, `devcontainer-feature.json`).
3. Research wezterm multiplexing architecture from official docs (domain types, protocols, socket vs TCP).
4. Read the lace.wezterm plugin to understand the actual connection flow.
5. Research devcontainer feature lifecycle (entrypoints, install.sh, prebuild behavior).
6. Synthesize findings into a structured report.
7. Self-review and write devlog.

## Testing Approach

Pure research -- no code changes, no tests needed. Verification is by cross-referencing multiple sources and checking claims against actual file contents.

## Implementation Notes

### Research strategy

Started with local file reads in parallel: wezterm-server `install.sh`, `devcontainer-feature.json`, lace `.devcontainer/devcontainer.json`, and the dotfiles devcontainer. This established the local codebase context.

Next, fetched upstream sources. The sshd feature's `install.sh` was fetched from GitHub (raw URL initially 404'd, succeeded via the blob page). The `devcontainer-feature.json` for sshd was successfully fetched from raw GitHub.

For wezterm documentation, the official docs at `wezterm.org` returned 404 on several paths (the site may have restructured since the docs were last linked). Fell back to web search, which surfaced the multiplexing docs, GitHub discussions, and the SshDomain configuration reference. The GitHub discussion #5361 about mux path specification was particularly valuable -- it revealed the `XDG_RUNTIME_DIR` control mechanism for socket paths.

### Key discovery: wezterm-mux-server is Unix-socket-only

The most important finding was confirming that `wezterm-mux-server` has no independent TCP listener. It only uses Unix domain sockets. This means there is no "wezterm port" to manage -- the only network port in the architecture is sshd's. This simplifies the port story significantly and validates the current approach of treating `sshPort` on wezterm-server as a pure routing label for the SSH port.

### Key discovery: sshd entrypoint timing

The second critical finding was the entrypoint timing. The sshd feature uses `"entrypoint": "/usr/local/share/ssh-init.sh"`, which runs as part of the container ENTRYPOINT before any lifecycle hooks. This means `postStartCommand` cannot modify sshd configuration before sshd starts. Combined with the fact that `ssh-init.sh` does not read environment variables for the port (it just runs `service ssh start` against whatever is in `sshd_config`), this makes runtime port override impractical.

### Research gaps

The devcontainer spec is underspecified in several areas:
- How multiple feature entrypoints are chained (implementation-defined)
- What happens when a prebaked feature is also specified in the `features` block (undefined)
- Whether `install.sh` re-runs for features already in the image (empirically no, but not spec-guaranteed)

These gaps are documented in the report as caveats rather than definitive claims.

### Existing prior art

The symmetric-prebuild-port-binding proposal at `cdocs/proposals/2026-02-09-symmetric-prebuild-port-binding.md` had already identified several of these findings (F7, F10). The report confirms and deepens those findings with additional evidence and extends them with new findings about wezterm's architecture and the entrypoint timing.

## Changes Made

| File | Description |
|------|-------------|
| `cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md` | New report: investigation of wezterm mux server port config and sshd runtime port override feasibility |
| `cdocs/reviews/2026-02-10-review-of-wezterm-sshd-port-mechanics.md` | Self-review of the report (accepted with non-blocking suggestions) |
| `cdocs/devlogs/2026-02-10-wezterm-sshd-port-mechanics-investigation.md` | This devlog |

## Sources Consulted

- Local: wezterm-server `install.sh` and `devcontainer-feature.json`
- Local: lace `.devcontainer/devcontainer.json` and `.devcontainer/wezterm.lua`
- Local: dotfiles `.devcontainer/devcontainer.json`
- Local: lace.wezterm plugin `init.lua`
- Local: `template-resolver.ts`, `validation.ts` (lace port pipeline code)
- Local: symmetric-prebuild-port-binding proposal
- Remote: upstream sshd feature `install.sh` and `devcontainer-feature.json`
- Remote: wezterm multiplexing docs, SshDomain config, TlsDomainServer config
- Remote: GitHub discussions #5361 (mux path), #1568 (SSH tunnel proxy)
- Remote: devcontainer features spec, lifecycle reference, CLI issues

## Verification

This is a research-only session. No code changes to verify. The report and review are complete and cross-referenced. The report's `last_reviewed` frontmatter has been updated to reflect the self-review acceptance.
