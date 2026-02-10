---
review_of: cdocs/reports/2026-02-09-wezterm-sshd-port-mechanics.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-10T01:00:00-08:00
task_list: lace/dogfooding
type: review
state: archived
status: done
tags: [self, architecture, ports, wezterm, sshd, investigation, prebuild]
---

# Review: Wezterm Mux Server and SSHD Port Mechanics

## Summary Assessment

This report investigates two foundational questions about the lace port architecture: whether wezterm-mux-server has its own TCP port, and whether the sshd feature's prebaked port can be altered at runtime. The investigation is thorough, well-sourced, and arrives at clear conclusions that directly support the symmetric-prebuild-port-binding proposal's design decisions. The main weakness is a small number of claims that rely on inference rather than direct verification, and one factual nuance about the SSH domain connection flow that deserves clarification. Verdict: **Accept** with minor non-blocking suggestions.

## Section-by-Section Findings

### BLUF

The BLUF is well-structured and hits the key points concisely. It correctly summarizes both questions and their implications.

**Non-blocking:** The BLUF says the port "CAN be overridden at runtime via `sshd -p <port>` in a `postStartCommand`" but the body of the report characterizes all runtime override approaches as impractical. The BLUF should front-load the practical conclusion more strongly, since the "CAN" framing may give a misleading first impression. The final sentence does clarify, but a reader skimming only the BLUF might take away the wrong message.

### F1: Unix domain socket finding

Correct and well-sourced. The socket path derivation from `$XDG_RUNTIME_DIR` is accurate per the wezterm docs and the GitHub discussion.

### F2: Domain type table

Clean and informative. The table format makes the three domain types easy to compare.

### F3: SSH domain connection flow

**Non-blocking nuance:** Step 2 says "wezterm spawns `wezterm-mux-server --daemonize` on the remote host (if not already running)." In the lace architecture, the mux server is already started by `postStartCommand` in the devcontainer config (line 94 of the lace devcontainer.json: `"postStartCommand": "wezterm-mux-server --daemonize 2>/dev/null || true"`). The SSH domain connection still works if the server is already running -- wezterm detects the existing socket and connects to it. The report's parenthetical "(if not already running)" covers this, but it would be more precise to note that lace explicitly pre-starts the mux server via `postStartCommand` rather than relying on SSH domain auto-spawning. The auto-spawn is a fallback, not the primary mechanism in lace's architecture.

**Non-blocking nuance:** Step 2 references `remote_wezterm_path` correctly, but the value in the lace.wezterm plugin is actually the path to the `wezterm` CLI binary (`/usr/local/bin/wezterm`), not `wezterm-mux-server`. The SSH domain uses the CLI's `proxy` subcommand, not the mux-server binary directly. The finding's text could be more precise on this distinction.

### F4: install.sh analysis

Correct. The code citations from `install.sh` (lines 4-5, 51-63, 78-83) and `devcontainer-feature.json` (lines 12-15) are accurate per the files read during research.

### F5: Container-side wezterm config

Correct. Verified against the actual file at `/var/home/mjr/code/weft/lace/.devcontainer/wezterm.lua`.

### F6: TLS domains assessment

Sound analysis. The recommendation against pursuing TLS domains is well-reasoned: the SSH infrastructure already exists, and TLS adds certificate management overhead without clear benefits for the devcontainer use case.

### F7: sshd install.sh analysis

**Non-blocking correction:** The report states "The feature's `devcontainer-feature.json` notably does NOT declare `sshd_port` as an option at all." This is correct -- the upstream sshd feature has `version` and `gatewayPorts` options only. The `SSHD_PORT` variable defaults to `"2222"` in the script itself (line 1 of the script). However, the report could note that the devcontainer features spec converts option names to uppercase environment variables. Since there is no `sshd_port` option, there is no way to pass a custom port through the standard feature options mechanism. This strengthens the finding.

### F8: Entrypoint timing

The execution order (entrypoint before lifecycle hooks) is correct per the devcontainer spec. The claim that `ssh-init.sh` starts sshd via `/etc/init.d/ssh start` is accurate based on the fetched script content.

### F9: Runtime override approaches

This is the strongest section of the report. Each approach is analyzed with specific problems identified. The analysis of Approach A (stop/restart race) and Approach D (env var not read at runtime) are particularly valuable.

**Non-blocking:** Approach A mentions the `-D` flag conflict with `&`. This is a valid concern, but there is a simpler restart approach: `service ssh stop && service ssh start` after modifying `sshd_config`. The `-D` flag is not necessary if using the service manager. However, this still has the race condition and timing problems already identified, so the overall conclusion is unchanged.

### F10: Prebaked features and install.sh re-run

The claim that "the devcontainer CLI does NOT re-execute `install.sh` at container creation time" for prebaked features is stated as fact but is based on inference from the spec and observed behavior, not from direct examination of the CLI source code. The report should note this is an empirically observed behavior consistent with the spec, not a verified implementation guarantee.

**Non-blocking:** The final paragraph hedges appropriately with "the devcontainer CLI behavior is unclear" for the overlap case.

### F11: Entrypoint chaining

The report correctly identifies this as implementation-defined behavior. The claim about prebaked feature entrypoints being preserved in image metadata and included in the chain is well-supported by the observation that sshd works in the lace devcontainer with sshd in `prebuildFeatures`.

### Architectural Implications

The connection flow diagram is excellent -- clear, concise, and covers every layer from host to Unix socket. The analysis of `sshPort` naming is insightful and directly useful for the ongoing design work.

### Recommendations

All five recommendations are practical and well-justified.

**Non-blocking on R4:** The suggestion to rename `sshPort` to `hostPort` or `lacePort` is interesting but the report correctly identifies the breaking change risk. One additional consideration: `sshPort` communicates the *purpose* of the port (SSH access), while `hostPort` communicates the *location* (host side). Both are valid naming strategies. The current name is fine with better documentation.

## Verdict

**Accept.** The report is thorough, well-sourced, and arrives at clear, actionable conclusions. The findings directly support the symmetric-prebuild-port-binding proposal's `containerPort` metadata approach. The non-blocking items are minor clarifications that do not affect the conclusions.

## Action Items

1. [non-blocking] Soften the BLUF's "CAN be overridden" language to better convey the impracticality. Suggest: "the port could theoretically be overridden at runtime, but all approaches are impractical due to entrypoint timing."
2. [non-blocking] Clarify F3 step 2 to note that lace pre-starts the mux server via `postStartCommand`, and the SSH domain auto-spawn is a fallback. Also clarify that `remote_wezterm_path` points to the `wezterm` CLI, not `wezterm-mux-server`.
3. [non-blocking] In F10, add a note that the no-re-run behavior is empirically observed and spec-consistent, not verified from CLI source code.
4. [non-blocking] In F7, add a note about the feature option-to-env-var conversion mechanism to strengthen the finding that there is no way to pass a custom port.
