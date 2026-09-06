---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T11:14:34-07:00
task_list: lace/security-audit/sandbox-containment
type: report
state: live
status: done
last_reviewed:
  status: accepted
  by: "@claude-opus-4-8"
  at: 2026-09-06T12:05:00-07:00
  round: 1
tags: [security, containment, devcontainer, features, audit]
---

# Sandbox Containment Security Audit

> BLUF: The rootless-podman kernel boundary is intact and hard to break: lace's own runArgs inject only `--label` and `--name`, add no `--privileged` or `--cap-add`, and mount no container socket, so a compromised agent cannot trivially become host root.
> Two static "defenses" the first draft claimed are false in the running config, corrected here from live inspection: the devcontainer CLI's podman path adds `--security-opt label=disable` to every container, so SELinux MAC confinement is OFF on an Enforcing host (F8), and some projects' own runArgs pass device access (jif adds `--device=/dev/kvm` and `--device=/dev/dri/renderD128`).
> The "no working host-root escape found" conclusion still stands, but the reassurance is narrower than a clean bill.
> But the containment the owner asked about is already broken at the data layer, by design, and the easiest break is far worse than "reading other projects' Claude state."
> The shared `~/.claude` mount is read-write and identical in every container, so any compromised agent can (a) exfiltrate the host's Anthropic OAuth credentials in one `cat`, and (b) write a malicious hook into `~/.claude/settings.json` that the host's own Claude Code, and every sibling container, later executes.
> The neovim `~/.local/share/nvim` mount is a second shared, writable, auto-executing-code channel with the same host-and-sibling pivot shape.
> Ranked by ease: stealing host credentials and pivoting through shared writable mounts is trivial-to-moderate and needs no kernel trick; escaping the userns to real host root is hard and no working path was found.
> The single highest-value fix is to make the Claude and neovim mounts read-only or project-scoped, and to stop mounting the live host credential directory.

> NOTE(opus/security-audit/2026-09-06): Amended after read-only live-container inspection (podman inspect on the four running containers).
> The live config contradicts two static "defenses" and lets three SUSPECTED items resolve; changes are folded in below.

## Threat Model and Trust Boundaries

Lace provisions rootless-podman devcontainers as sandboxes for AI coding agents.
Claude Code runs *inside* a container.
The adversary is a compromised agent or malicious code executing with the container user's privileges (uid 1000, `node`), which trivially escalates to container root via passwordless sudo (Finding 3).

Three exfiltration/escape questions, in the owner's words "how easily could a compromised agent or malicious code break containment":

- (a) escape to the host (host-root or host-user code execution),
- (b) pivot into other containers,
- (c) exfiltrate host credentials or keys.

Trust boundaries, from most to least trusted:

- Host user account and its home directory (the crown jewels: OAuth tokens, SSH keys, the host's own Claude Code).
- The rootless-podman user namespace (the kernel boundary).
- The container filesystem and the set of host paths bind-mounted into it (the real attack surface).
- The agent running inside, which is assumed hostile for this audit.

The known, accepted leak is that the shared Claude config lets one container read other projects' Claude state.
This audit's job is to show that that framing understates the exposure: the same mount is a credential store and a write-back code-execution channel, not just a cross-project reader.

## Findings

Ranked by ease of exploit (easiest and highest-impact first).
Each is marked CONFIRMED (code was read) or SUSPECTED (needs a live container to verify).

### F1. Shared read-write `~/.claude` mount: host credential theft + write-back host pivot (CONFIRMED)

`devcontainers/features/src/claude-code/devcontainer-feature.json:20-33` declares two lace mounts with no `readonly` flag:

- `config`: target `/home/${_REMOTE_USER}/.claude`, `recommendedSource: ~/.claude`, `sourceMustBe: directory`.
- `config-json`: target `/home/${_REMOTE_USER}/.claude/.claude.json`, `recommendedSource: ~/.claude.json`, `sourceMustBe: file`.

With no settings override, `MountPathResolver.resolveValidatedSource` (`packages/lace/src/lib/mount-resolver.ts:351-380`) resolves both to the recommended source, i.e. the live host `~/.claude` directory and `~/.claude.json` file.
`resolveFullSpec` (`mount-resolver.ts:468-498`) emits no `readonly` token because the declaration sets none, so the bind is read-write.
The source is a single fixed host path, so *every* container for *every* project mounts the *same* host directory.
`.devcontainer/devcontainer.json` wires `CLAUDE_CONFIG_DIR` to this mount's target, confirming Claude Code reads and writes it in-container.

What this exposes, quantified:

- `~/.claude/.credentials.json` on Linux holds the Anthropic OAuth access and refresh tokens.
  This is a host credential, reachable by `cat` from any container.
  This is threat (c), fully, and it is trivial.
- `~/.claude/settings.json` (and project/local settings, memory files, hooks) are writable from the container.
  Claude Code executes hook commands defined in its settings.
  A container that writes a `PreToolUse`/`SessionStart` hook into the shared `settings.json` plants code that the host's own Claude Code, running on the host with the host user's privileges, executes on its next run, and that every sibling container's Claude also executes.
  This is threat (a) (host code execution as the host user, without any kernel escape) and threat (b) (pivot to every other container), achieved purely through a data mount.
- The install script's `chmod 700 ~/.claude` (`claude-code/install.sh`) is irrelevant: it hardens the in-container copy against other in-container users, not against the container user who owns it, and container root (Finding 3) defeats it regardless.

How easy: reading credentials is TRIVIAL.
The write-back host pivot is MODERATE and partly SUSPECTED: it is confirmed that the mount is shared and writable and that Claude executes settings hooks, but the exact host-side trigger depends on the host running Claude Code against the same directory and on hook-precedence rules, which should be confirmed live.

### F2. Shared read-write neovim plugin mount: cross-container and host code execution (CONFIRMED)

`devcontainers/features/src/neovim/devcontainer-feature.json` declares mount `plugins`, target `/home/${_REMOTE_USER}/.local/share/nvim`, `recommendedSource: ~/.local/share/nvim`, no `readonly`.
Same resolution path as F1: every container binds the one host `~/.local/share/nvim`, read-write, shared across all projects and shared with the host.
That directory holds Neovim plugin code, `pack/*/start` autoloaded plugins, and Lua that Neovim executes on startup with no confirmation.
A compromised container writes a malicious plugin or `plugin/*.lua` file; the next time the host user (a heavy Neovim user in this environment) or any sibling container opens `nvim`, the payload runs.
This is a second host-and-sibling pivot with the same shape as F1.

How easy: MODERATE.
It requires the victim to open Neovim, but that is routine, and the write itself is trivial.

### F3. Passwordless `NOPASSWD:ALL` sudo grants instant container root (CONFIRMED)

`.devcontainer/Dockerfile:70-71` writes `echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}`.
The comment justifies it (`Dockerfile:69`): "Required by devcontainer features (e.g. sshd) whose init scripts use `sudo` at runtime."
That justification is stale: a repo-wide grep for runtime `sudo` across every feature install/entrypoint/step script, every `bin/` script, and the `.devcontainer/devcontainer.json` lifecycle (`postCreateCommand:66` is `nvim --headless '+Lazy! sync'`) returns zero callers, and no sshd feature ships here (entry is `podman exec` via `bin/lace-into`).
All root work happens at build time in `RUN` layers; the portless entrypoint self-manages privilege via `id -u`/`su -c` (`portless/install.sh:41-47`), needing no sudo.
So within lace's own surface the minimal needed sudoers allowlist is empty.
The only consumers are downstream projects' own lifecycle commands (for example weftwise's postStart `sudo mkdir -p /run/user/1000 && sudo chown node:node /run/user/1000 && sudo chmod 700 /run/user/1000`), which live in the consuming repo, not here.
A compromised agent runs `sudo -s` and is root inside the container with zero friction.
Container root defeats every in-container file permission (the `chmod 700` hardening in F1, ownership boundaries, etc.) and can read every mount and install arbitrary tooling.

Crucially, this is NOT host root: under rootless podman with `--userns=keep-id`, container uid 0 maps to an unprivileged host subuid, not host uid 0 (see Containment Posture).
So this finding is severe *inside* the box but does not by itself cross the kernel boundary.
Its real effect is to guarantee that no in-container permission scheme can defend the mounts in F1/F2/F5.

The recurring downstream need is only `/run/user/1000`, absent because rootless podman with `--userns=keep-id` does not auto-create the per-uid runtime dir.
The cleaner fix than any allowlist: have lace create `/run/user/1000` (owned by node, mode 700) centrally at container start via a root-run entrypoint, then drop the grant to empty (or remove it).
That re-enables in-container file permissions as a real defense-in-depth layer over the F1/F2 mounts, which the blanket grant currently nullifies.

How easy: TRIVIAL.

### F4. Host port bindings and container network reachability (CONFIRMED, live)

`generatePortEntries` (`packages/lace/src/lib/template-resolver.ts:706-740`) emits `appPort` entries as `` `${alloc.port}:${alloc.port}` ``, i.e. bare `port:port` with no host-IP prefix.
Under podman this publishes on `0.0.0.0`, and `getContainerHostPorts` (`packages/lace/src/lib/up.ts:109`) parses exactly that (`"2222/tcp -> 0.0.0.0:22425"`).
Live inspection (2026-09-06) confirms this: every published port on the four running containers binds `0.0.0.0` (ports 22425/22427/22429-22433), reachable via the host IP and the LAN, not just loopback.
The portless feature reinforces the intent: `portless/devcontainer-feature.json` pins version `0.15.3` specifically because "0.15.4 binds the proxy loopback-only, which breaks host ingress on rootless podman/pasta," i.e. lace deliberately wants the in-container proxy bound on a non-loopback interface.

The network model is `pasta` (`NetworkMode=pasta`), with no shared podman bridge and no container-to-container L2 IPs.
So the sibling pivot is not via a shared network: it is via the `0.0.0.0` host ports, which each container reaches through the host IP.
The cross-container reach is real, but it flows through host ports, not a common L2 segment.

How easy: MODERATE, now CONFIRMED.
Note the current entry model is `podman exec` via `bin/lace-into` (`$RUNTIME exec -it --user ... /bin/bash -l`), not sshd, so no sshd feature ships in this repo and the sshd-on-LAN concern is latent rather than active in the default feature set.

### F5. Mount policy is asymmetric: it only gates `user.json` mounts (CONFIRMED)

`packages/lace/src/lib/user-config.ts:48-86` defines a credential denylist (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gh`, `/var/run/docker.sock`, `/run/docker.sock`, the podman socket, etc.).
But `validateMountSources` (same file, 293-346) is invoked at `up.ts:420` *only* against `userConfig.mounts` (the `user/` namespace).
It is never applied to:

- raw `mounts` strings in a project's `.devcontainer/devcontainer.json`,
- project or feature `customizations.lace.mounts` declarations,
- `repoMounts`,
- `settings.json` `mounts[label].source` overrides (these flow through `MountPathResolver`, which checks only `existsSync`, not policy).

Consequently a malicious or untrusted project repo that you `lace up` can add `type=bind,source=/home/you/.ssh,target=/mnt/x` and lift your SSH keys, and a `settings.json` override can point any feature mount at a credential directory with no policy check.
The denylist defends the user-footgun path while leaving the untrusted-project-config path open.

How easy: TRIVIAL for a hostile repo author; this is a supply-chain / repo-trust finding rather than a runtime escape, but it directly answers threat (c) for anyone who runs `lace up` on code they do not fully trust.

Exact remediation surface.
All six mount-source ingestion paths converge at one post-resolution choke point:
user.json mounts (`up.ts:418-436`, already policy-checked at `:420`), feature and project `customizations.lace.mounts` (resolved by `MountPathResolver.resolveValidatedSource`, `mount-resolver.ts:332-388`, existence-only), `settings.json` `mounts[label].source` overrides (`mount-resolver.ts:337-349`, existence-only, can repoint any label including `claude-code/config`), raw `mounts` strings in the project `.devcontainer/devcontainer.json` (flow through `configForResolution.mounts` at `up.ts:608` into the generated config), and `repoMounts` (`mounts.ts:129-`, default `readonly: true` but source unchecked).
Every resolved mount appears as a concrete `source=...` string in the existence scan at `up.ts:803-835` (source extracted at `:825`).
Insert `evaluateMountPolicy(realpathSync(source), loadMountPolicy())` there and hard-error on `deny`, keeping the existing `up.ts:420` user.json check as a pre-resolution first pass.

Tricky bits:
- The check must run AFTER template resolution: sources like `${lace.mount(...)}` and `${localWorkspaceFolder}` are only concrete post-resolution, which is why the `up.ts:803` scan is the right hook and the `up.ts:420` site alone is insufficient.
- The `up.ts:826` skip of any source still containing `${...}` is a bypass: a devcontainer-runtime variable like `${localEnv:HOME}/.ssh` is resolved later by the CLI and escapes the check, so resolve `localEnv`/`localWorkspaceFolder` first or deny credential-shaped unresolved sources.
- Call `realpathSync` before policy eval, or a symlinked `~/.ssh` slips the denylist (this is what `validateMountSources` already does via `resolveSourceForPolicy`).

### F6. Unpinned / unverified build-time downloads (CONFIRMED)

Build-time supply-chain surface, blast radius = every container built.

Top priority, the one true `curl | sh`:
- `lace-fundamentals/steps/chezmoi.sh:7`: `sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin`, an unpinned installer piped straight to a root shell from a third-party host.

Version-pinned but NOT checksum/signature-verified:

| Fetch | file:line | Host | Pinned | Verified |
|---|---|---|---|---|
| neovim tarball | `neovim/install.sh:33-35` | github releases | `v0.11.6` | no sha256 |
| ble.sh tarball | `blesh/install.sh:40-43` | github releases | `0.4.0-devel3` | no sha256 |
| fzf binary | `blesh/install.sh:96-99` | github releases | `0.74.3` | no sha256 |
| fzf shell files | `blesh/install.sh:117-121` | `raw.githubusercontent.com` | tag `v0.74.3` | no sha256 |
| git-delta `.deb` | `.devcontainer/Dockerfile:58-61` | github releases | `0.18.2` | no sha256, `dpkg -i` |

Floating / not digest-pinned:
- `claude-code` npm default is `latest` (`claude-code/devcontainer-feature.json:10`); portless is effectively pinned to `0.15.3` via feature.json.
- Base image `node:24-bookworm` (`Dockerfile:2`) is tag-pinned, not digest-pinned; `Dockerfile:38` uses `pnpm@latest-10` (floating).

Second-order:
- `chezmoi apply --source <dotfiles mount>` executes templates and `run_` scripts from the dotfiles repo mount; for the lace repo that mount is `readonly: false` (`.devcontainer/devcontainer.json` `repoMounts`), so a container can modify dotfiles content that a later `chezmoi apply` executes.

Remediation: replace the chezmoi `curl | sh` with a pinned, sha256-verified download (highest priority); add a per-`(version,arch)` sha256 check to the neovim, ble.sh, fzf, and git-delta fetches; pin the fzf shell files by commit SHA; pin `claude-code` to an explicit version; digest-pin the base image.

How easy: HARD (requires upstream compromise or MITM), but included because a single upstream compromise reaches every container.

### F7. Container-controlled data rendered into the sprack TUI (LOW, informational)

The suspected tmux `#(...)` / format-string command injection does NOT exist.
sprack is a ratatui TUI, not the tmux status bar.
Its status bar (`packages/sprack/crates/sprack/src/render.rs:279-305`) is drawn into the ratatui frame buffer and shows only a poller-health indicator and a static help string, with no container data.
`sprack-poll` only READS tmux: `list-panes -a -F <fixed format>` (`sprack-poll/src/tmux.rs:42-98`) and `show-options -qvt $session @lace_*` (`tmux.rs:193-218`), and `show-options -qv` returns a literal value, not a format-expansion context.
The only tmux writes in the tree set plain `@lace_container`/`@lace_user`/`@lace_workspace` option values host-side (`bin/lace-into:516-569`, `bin/lace-split:90-92`), whose values are host-derived, not container-authored, and navigation `switch-client`/`select-window`/`select-pane` (`sprack/src/tmux.rs:44-70`) passed as argv.
No `status-left`/`status-right`/`status-format` references those options anywhere: a repo-wide grep returns zero.
So there is no path by which container data reaches a tmux format context, and `#(command)` substitution is not reachable.

Container-authored fields do reach the ratatui TUI body: `git_branch`/`git_commit_short` from the container-written `state.json` (`sprack-metadata-writer.sh:25-32` -> `sprack-claude/src/main.rs:698-728`), plus `model`/`last_tool`/`session_name`/tasks/`session_summary` from the container's JSONL and hook events, rendered as ratatui `Span`s (`render.rs:151-276`).
ratatui 0.28 renders strings into its cell buffer grapheme-by-grapheme and skips zero-width graphemes; C0/C1 control chars (ESC 0x1b included) have display width 0 and are dropped rather than emitted to the host terminal, which neutralizes ANSI escape-sequence injection.
sprack contains no explicit sanitizer (grep for `is_control`/`\x1b`/`strip` in the crates found none), so the safety rests entirely on ratatui's zero-width filtering.

How easy: worst realistic case is cosmetic garbling of the operator's sprack TUI, not host command execution and not tmux injection.
Remediation is optional defense-in-depth: strip C0/C1 control bytes at the DB-write or render boundary for the container-authored fields (including `pane_title`, also container-settable via OSC) rather than relying on ratatui internals.

### F8. SELinux confinement disabled on every container (CONFIRMED, live)

Live inspection (2026-09-06) shows `SecurityOpt=[label=disable]` on all four running containers (whelm/jif/clauthier/weftwise), while the host runs SELinux `Enforcing`.
This turns off the SELinux/svirt MAC layer that would otherwise confine each container process on a Fedora host.
The origin is not lace source and not project `runArgs`: it is the devcontainer CLI's podman path, which applies `--security-opt label=disable` by default (CHANGELOG: "Podman: Use label=disable instead of z flag"), invoked whenever lace runs `devcontainer up`.
Because it is a CLI default, it is present on every lace container regardless of project.

The effect is a removed defense-in-depth layer rather than an escape by itself: with svirt off, any mount misconfiguration (F1/F2/F5) or future container escape faces one fewer barrier on the host.
On a stock docker/moby host this layer would not have existed either, but on this Enforcing Fedora host the first draft's "no `--security-opt label=disable`" reassurance was simply wrong.

A related posture correction, folded in from the same inspection: jif's own project `runArgs` add `--device=/dev/kvm` and `--device=/dev/dri/renderD128` for an in-container emulator.
Direct `/dev/kvm` access is a real added-privilege surface (it is not present on the other three containers), so device passthrough is a per-project concern the base posture does not cover.

How easy: not an escape on its own; CONFIRMED as a widened blast radius.

## Findings Summary

| # | Finding | Threat | Confidence | Ease | Severity |
|---|---------|--------|-----------|------|----------|
| F1 | Shared RW `~/.claude` mount: OAuth token theft + write-back hook = host/sibling RCE | (c),(a),(b) | CONFIRMED (read); SUSPECTED (host trigger) | Trivial (read) / Moderate (pivot) | Critical |
| F2 | Shared RW `~/.local/share/nvim` mount: plant Lua, host/sibling nvim executes | (a),(b) | CONFIRMED | Moderate | High |
| F3 | `NOPASSWD:ALL` sudo = instant container root, defeats all in-container perms | in-container | CONFIRMED | Trivial | High (contained by userns) |
| F5 | Mount policy only gates `user.json`; project/settings/repo mounts unchecked | (c) | CONFIRMED | Trivial (hostile repo) | High |
| F4 | Host ports bound `0.0.0.0`; pasta net, no shared bridge = sibling reach via host ports/LAN | (b) | CONFIRMED (live) | Moderate | Medium |
| F8 | `--security-opt label=disable` on all containers = SELinux/svirt MAC off on Enforcing host | (a) | CONFIRMED (live) | n/a (defense removed) | Medium |
| F6 | Unpinned/unverified build-time fetches (`curl\|sh`, no checksums) | (a) | CONFIRMED | Hard | Medium |
| F7 | Container data in sprack ratatui TUI: no tmux injection, escapes dropped by ratatui | (a) | CONFIRMED (no injection path) | Cosmetic only | Low |
| -- | Kernel/userns escape to real host root | (a) | none found | Hard | -- |

## Containment Posture Assessment

The report is not alarmist about kernel escape: the rootless-podman boundary is doing real work, and lace does not undermine it.

What holds, and why:

- Lace's own runArgs add no `--privileged`, `--cap-add`, `--pid=host`, `--network=host`, or `--device`.
  `up.ts` injects only `--label lace.project_name=...` and `--name` into `runArgs` (`up.ts:1485-1493`); `runDevcontainerUp` adds only `--docker-path`, `--buildkit never`, `--config`, `--workspace-folder` (`up.ts:1532-1574`).
  A whole-repo grep found no feature declaring `capAdd`, `privileged`, or `securityOpt`.
  But the effective running config is not clean: the devcontainer CLI's podman path adds `--security-opt label=disable` to every container, so SELinux/svirt MAC is off on this Enforcing host (F8), and jif's own project `runArgs` add `--device=/dev/kvm` and `--device=/dev/dri/renderD128`.
  So the "no security-opt / no device" reassurance holds only for what lace source injects, not for what actually runs.
- No container socket is mounted.
  The default mount policy explicitly denies `docker.sock`, the podman socket, and `~/.local/share/containers` (`user-config.ts:78-85`), and no feature or lace code mounts one.
  This closes the classic trivial escape (a mounted docker/podman socket is host-root-equivalent). CONFIRMED for the default configuration, and unaffected by the live-inspection corrections.
- `--userns=keep-id` id-mapping CONFIRMED live (2026-09-06): container uid 0 maps to an unprivileged host subuid (contained, good), and container uid 1000 (`node`) maps to the REAL host user.
  So container root (Finding 3) is not host root: it cannot read host files that are not mounted, cannot ptrace host processes, and cannot load kernel modules.
  This is the boundary that actually contains F1-F3 from becoming full host-root compromise.
  The flip side of the same mapping is why F1/F2 are so exposed: keep-id deliberately runs the agent as the host user for every mounted host path, so the shared `~/.claude` and `~/.local/share/nvim` binds are read and written with the host user's own identity.
- Most stateful mounts are project-scoped, not shared: sprack `data` and bash-history `history` derive per-project paths (`~/.config/lace/<projectId>/mounts/...` or `~/.local/share/sprack/lace/<projectName>`), so they are not cross-project channels.
  `repoMounts` default to `readonly: true` (`mounts.ts:222-278`).
  The asymmetry with F1/F2 (which use a single fixed shared host path, read-write) is precisely what makes F1/F2 dangerous and these safe.

The honest conclusion: escaping the box to host root is hard and no path was found, and the userns boundary is doing that work.
But the defense-in-depth around that boundary is thinner than the first draft implied: SELinux/svirt, a key Fedora MAC layer, is off on every container (F8), so a mount misconfig or a future escape meets one fewer barrier.
And "containment" for an AI-agent sandbox has to mean protecting the host's credentials and the host's own tools, and there the design leaks by construction.
The userns stops the kernel escape; it does nothing about a read-write mount that hands over the OAuth token and a code-execution write channel into the host's Claude and Neovim.

## Recommended Hardening

Prioritized. The first item alone closes the highest-impact, easiest path.

1. Stop mounting the live host credential directory read-write (fixes F1).
   - Make the `claude-code/config` and `config-json` mounts `readonly: true` in the feature declaration, or
   - Point the recommended source at a per-project, credential-scrubbed copy rather than the live `~/.claude`, and
   - Do not mount `.credentials.json` into containers at all; inject a short-lived, container-scoped token via `containerEnv` instead of the host's long-lived OAuth store.
   - At minimum, treat the shared config as an untrusted input on the host side: the host's Claude Code should not execute hooks whose definitions could have been written by a container.

2. Make `neovim/plugins` `readonly: true` or project-scoped (fixes F2).
   Plugin state is regenerable; there is no need to share one writable host directory across all containers and the host.

3. Extend the mount policy to all mount sources, not just `user.json` (fixes F5).
   Run `validateMountSources` (or an equivalent policy check) against resolved `settings.json` overrides, project `customizations.lace.mounts`, raw `mounts` strings, and `repoMounts` sources, so a project config or override cannot bind a credential directory.
   Print a clear warning when a project's own devcontainer.json requests a denied path.

4. Scope container port publishing to loopback by default (fixes F4).
   Emit `appPort` as `127.0.0.1:${port}:${port}` unless the user explicitly opts into LAN exposure.
   Live inspection confirms the ports bind `0.0.0.0` on a `pasta` network with no shared bridge, so the residual exposure is the LAN and cross-container reach through host ports, which the loopback bind closes.

5. Replace `NOPASSWD:ALL` sudo with a central `/run/user/1000` bootstrap (fixes F3).
   The grant has no runtime callers in this repo; the only consumers are downstream projects setting up `/run/user/1000`.
   Have lace create `/run/user/1000` (owned node, mode 700) at container start via a root-run entrypoint, then drop the grant to empty.
   This raises the cost of in-container root and re-enables in-container permission hardening as a real defense-in-depth layer over the F1/F2 mounts.

6. Pin and verify build-time downloads (fixes F6).
   Replace `curl | sh` for chezmoi with a pinned, checksum-verified download (top priority); add `sha256` verification to the neovim, ble.sh, fzf, and git-delta fetches; pin `claude-code` to an explicit version instead of `latest`; digest-pin the `node:24-bookworm` base image.

7. Optionally sanitize the sprack renderer (fixes F7, low priority).
   There is no tmux format-injection path and ratatui already drops control chars, so this is defense-in-depth only: strip C0/C1 bytes from container-authored fields at the DB-write or render boundary rather than relying on ratatui internals.

8. Re-enable SELinux confinement, or accept it explicitly (mitigates F8).
   The `--security-opt label=disable` comes from the devcontainer CLI's podman default, not lace source.
   Evaluate whether relabeled mounts (`:z`/`:Z`) can replace the blanket disable so svirt confinement is restored on the Enforcing host, and gate device passthrough like jif's `--device=/dev/kvm` behind an explicit per-project opt-in.

## Verification

### Verified live 2026-09-06

Resolved by read-only `podman inspect` on the four running containers:

- `--userns=keep-id` id-mapping: container uid 0 maps to an unprivileged host subuid, container uid 1000 (`node`) maps to the real host user.
- Host bind address: every published port binds `0.0.0.0` (ports 22425/22427/22429-22433), not loopback (F4).
- Network model: `pasta` (`NetworkMode=pasta`), no shared podman bridge and no container-to-container L2 IPs, so sibling reach is via host ports, not a shared network (F4).
- `SecurityOpt=[label=disable]` present on all four containers while the host is Enforcing (F8); jif adds `--device=/dev/kvm` and `--device=/dev/dri/renderD128`.
- The sprack rendering path: no tmux format-injection path exists; escape-sequence handling relies on ratatui's zero-width-grapheme filtering (F7).

### Still open

Host-state facts the code cannot prove:

- Live confirmation that the host's Claude Code executes hooks written into the shared `~/.claude` from within a container (F1 host trigger).
- Confirm `~/.claude/.credentials.json` exists as a plaintext file on this host (versus the OAuth tokens being held in the system keyring / libsecret): the TRIVIAL credential-theft rating in F1 depends on this host-state fact, which is not verifiable from lace source.
