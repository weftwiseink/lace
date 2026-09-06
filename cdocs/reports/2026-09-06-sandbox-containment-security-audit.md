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

> BLUF: The rootless-podman kernel boundary is intact and hard to break: lace adds no `--privileged`, no `--cap-add`, no `--security-opt label=disable`, and mounts no container socket, so a compromised agent cannot trivially become host root.
> But the containment the owner asked about is already broken at the data layer, by design, and the easiest break is far worse than "reading other projects' Claude state."
> The shared `~/.claude` mount is read-write and identical in every container, so any compromised agent can (a) exfiltrate the host's Anthropic OAuth credentials in one `cat`, and (b) write a malicious hook into `~/.claude/settings.json` that the host's own Claude Code, and every sibling container, later executes.
> The neovim `~/.local/share/nvim` mount is a second shared, writable, auto-executing-code channel with the same host-and-sibling pivot shape.
> Ranked by ease: stealing host credentials and pivoting through shared writable mounts is trivial-to-moderate and needs no kernel trick; escaping the userns to real host root is hard and no working path was found.
> The single highest-value fix is to make the Claude and neovim mounts read-only or project-scoped, and to stop mounting the live host credential directory.

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

`.devcontainer/Dockerfile` writes `echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}`.
The comment justifies it: "Required by devcontainer features (e.g. sshd) whose init scripts use `sudo` at runtime."
A compromised agent runs `sudo -s` and is root inside the container with zero friction.
Container root defeats every in-container file permission (the `chmod 700` hardening in F1, ownership boundaries, etc.) and can read every mount and install arbitrary tooling.

Crucially, this is NOT host root: under rootless podman with `--userns=keep-id`, container uid 0 maps to an unprivileged host subuid, not host uid 0 (see Containment Posture).
So this finding is severe *inside* the box but does not by itself cross the kernel boundary.
Its real effect is to guarantee that no in-container permission scheme can defend the mounts in F1/F2/F5.

How easy: TRIVIAL.

### F4. Host port bindings and container network reachability (SUSPECTED)

`generatePortEntries` (`packages/lace/src/lib/template-resolver.ts:706-740`) emits `appPort` entries as `` `${alloc.port}:${alloc.port}` ``, i.e. bare `port:port` with no host-IP prefix.
Under podman this publishes on `0.0.0.0`, and `getContainerHostPorts` (`packages/lace/src/lib/up.ts:109`) parses exactly that (`"2222/tcp -> 0.0.0.0:22425"`), which strongly implies every lace-allocated host port (range 22425-22499, `port-allocator.ts:8-9`) is bound on all host interfaces, reachable from the LAN, not just loopback.
The portless feature reinforces this: `portless/devcontainer-feature.json` pins version `0.15.3` specifically because "0.15.4 binds the proxy loopback-only, which breaks host ingress on rootless podman/pasta," i.e. lace deliberately wants the in-container proxy bound on a non-loopback interface.
If containers share the default podman network (unverified), one container can reach another's published proxy and any sshd directly by port.

How easy: MODERATE, and SUSPECTED.
Needs `podman port <container>` and `podman inspect --format '{{.NetworkSettings}}'` on a live container to confirm the bind address and the shared-network assumption.
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

### F6. Unpinned / unverified build-time downloads (CONFIRMED)

Build-time supply-chain surface, blast radius = every container built:

- `lace-fundamentals/steps/chezmoi.sh`: `sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin`, an unpinned `curl | sh` from a third-party host.
- `portless/install.sh`: `VERSION` defaults to `latest` in the script (the feature.json option default of `0.15.3` is what the CLI passes, so pinned in practice, but the script's own default is floating).
- `neovim/install.sh`, `blesh/install.sh` (ble.sh, fzf binary, and fzf shell files from `raw.githubusercontent.com`), and the Dockerfile's `git-delta` `.deb`: all fetched over HTTPS with version pins but no checksum/signature verification.

`lace-fundamentals-init` then runs `chezmoi apply --source /mnt/lace/repos/dotfiles`, which executes templates and `run_` scripts from the dotfiles mount; for the lace repo that mount is `readonly: false` (`.devcontainer/devcontainer.json` `repoMounts`), so a container can modify dotfiles content that a later `chezmoi apply` executes.

How easy: HARD (requires upstream compromise or MITM), but included because a single upstream compromise reaches every container.

### F7. Container-controlled data rendered into the host tmux status bar (SUSPECTED)

The sprack feature writes container-controlled fields into host-visible files: `sprack-metadata-writer.sh` writes `container_name`, `workdir`, and git branch into `/mnt/sprack/metadata/state.json`, and `sprack-hook-bridge.sh` writes `cwd` and `last_assistant_message` into per-session JSONL.
A host-side Rust process (`packages/sprack/crates/sprack-poll`, `sprack-db`) consumes these to drive a host tmux status bar.
If the renderer does not sanitize these fields, a container can inject tmux format strings or terminal escape sequences into the host operator's terminal.

How easy: MODERATE-to-HARD, SUSPECTED.
The sprack `data` mount is project-scoped (`recommendedSource: ~/.local/share/sprack/lace/${lace.projectName}`), which limits blast radius, but the host-side Rust rendering path was not audited here and should be reviewed for escape-sequence handling.

## Findings Summary

| # | Finding | Threat | Confidence | Ease | Severity |
|---|---------|--------|-----------|------|----------|
| F1 | Shared RW `~/.claude` mount: OAuth token theft + write-back hook = host/sibling RCE | (c),(a),(b) | CONFIRMED (read); SUSPECTED (host trigger) | Trivial (read) / Moderate (pivot) | Critical |
| F2 | Shared RW `~/.local/share/nvim` mount: plant Lua, host/sibling nvim executes | (a),(b) | CONFIRMED | Moderate | High |
| F3 | `NOPASSWD:ALL` sudo = instant container root, defeats all in-container perms | in-container | CONFIRMED | Trivial | High (contained by userns) |
| F5 | Mount policy only gates `user.json`; project/settings/repo mounts unchecked | (c) | CONFIRMED | Trivial (hostile repo) | High |
| F4 | Host ports bound `0.0.0.0` + shared network = LAN + inter-container reach | (b) | SUSPECTED | Moderate | Medium |
| F7 | Container data rendered into host tmux status bar (injection) | (a) | SUSPECTED | Moderate/Hard | Medium |
| F6 | Unpinned/unverified build-time fetches (`curl\|sh`, no checksums) | (a) | CONFIRMED | Hard | Medium |
| -- | Kernel/userns escape to real host root | (a) | none found | Hard | -- |

## Containment Posture Assessment

The report is not alarmist about kernel escape: the rootless-podman boundary is doing real work, and lace does not undermine it.

What holds, and why:

- No `--privileged`, `--cap-add`, `--security-opt label=disable`, `--pid=host`, `--network=host`, or `--device` is added by lace.
  `up.ts` injects only `--label lace.project_name=...` and `--name` into `runArgs` (`up.ts:1485-1493`); `runDevcontainerUp` adds only `--docker-path`, `--buildkit never`, `--config`, `--workspace-folder` (`up.ts:1532-1574`).
  A whole-repo grep found no feature declaring `capAdd`, `privileged`, or `securityOpt`. CONFIRMED.
- No container socket is mounted.
  The default mount policy explicitly denies `docker.sock`, the podman socket, and `~/.local/share/containers` (`user-config.ts:78-85`), and no feature or lace code mounts one.
  This closes the classic trivial escape (a mounted docker/podman socket is host-root-equivalent). CONFIRMED for the default configuration.
- `--userns=keep-id` maps container uid 1000 to host uid 1000 and container uid 0 to an unprivileged host subuid.
  So container root (Finding 3) is not host root: it cannot read host files that are not mounted, cannot ptrace host processes, and cannot load kernel modules.
  This is the boundary that actually contains F1-F3 from becoming full host-root compromise.
  Confidence: asserted throughout the codebase (`up.ts:804` and numerous cdocs) and is the devcontainer CLI's standard podman behavior, but the flag is applied by the *external* `devcontainer` CLI, not by lace code in this repo, so it is CONFIRMED-by-design and should be verified live with `podman inspect --format '{{.HostConfig.IDMappings}}'`.
- Most stateful mounts are project-scoped, not shared: sprack `data` and bash-history `history` derive per-project paths (`~/.config/lace/<projectId>/mounts/...` or `~/.local/share/sprack/lace/<projectName>`), so they are not cross-project channels.
  `repoMounts` default to `readonly: true` (`mounts.ts:222-278`).
  The asymmetry with F1/F2 (which use a single fixed shared host path, read-write) is precisely what makes F1/F2 dangerous and these safe.

The honest conclusion: escaping the box to host root is hard and no path was found.
But "containment" for an AI-agent sandbox has to mean protecting the host's credentials and the host's own tools, and there the design leaks by construction.
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
   Emit `appPort` as `127.0.0.1:${port}:${port}` unless the user explicitly opts into LAN exposure, and confirm the podman network model with `podman network inspect` so sibling containers are isolated unless intended.

5. Reconsider `NOPASSWD:ALL` sudo (mitigates F3).
   Grant passwordless sudo only for the specific commands features actually need at runtime, rather than blanket `ALL`.
   This raises the cost of in-container root and re-enables in-container permission hardening as a defense-in-depth layer.

6. Pin and verify build-time downloads (fixes F6).
   Replace `curl | sh` for chezmoi with a pinned, checksum-verified download; add `sha256` verification to the neovim, ble.sh, fzf, and git-delta fetches; give the portless install script a pinned default instead of `latest`.

7. Audit and sanitize the sprack host-side renderer (fixes F7).
   Confirm the Rust status-bar path strips terminal escape sequences and does not interpret container-supplied fields as tmux format strings.

## Verification Needed on a Live Container

The following require a running container and were not confirmed statically:

- `podman inspect` to confirm `--userns=keep-id` id-mappings and the absence of added capabilities/privileges.
- `podman port` / `podman inspect` to confirm host bind address (`0.0.0.0` vs `127.0.0.1`) for allocated ports (F4).
- `podman network inspect` to confirm whether project containers share a network and can reach each other (F4).
- Live confirmation that the host's Claude Code executes hooks written into the shared `~/.claude` from within a container (F1 host trigger).
- Confirm `~/.claude/.credentials.json` exists as a plaintext file on this host (versus the OAuth tokens being held in the system keyring / libsecret): the TRIVIAL credential-theft rating in F1 depends on this host-state fact, which is not verifiable from lace source.
- Review of the sprack Rust rendering path for escape-sequence injection (F7).
