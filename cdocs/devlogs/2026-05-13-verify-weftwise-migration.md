---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T13:08:09-07:00
task_list: prebuild/legacy-builder-migration/weftwise/verification
type: devlog
state: live
status: review_ready
tags: [prebuild, migration, weftwise, verification]
---

# Verify Weftwise Migration End-to-End

> BLUF(opus/verification): Three user-facing flows tested.
> Step 1 (`lace-into` reachability via `podman exec`) PASSES.
> Step 2 (SSH on allocated port 22425) FAILS - sshd inside the container is bound to default port 2222, not 22425.
> Step 3 (renderer dev server) PARTIAL - the dev server starts cleanly on container port 3000 after a manual in-container `pnpm install`, but the port is not published to the host, so the host cannot reach it.

The migration produced a running container with a working bind-mounted workspace, but two cross-cutting host-to-container reachability problems block real-world use: the allocated SSH port is a no-op, and renderer dev servers have no automatic host forwarding.

## Step 1 - `lace-into` reachability

### What was tested

`podman exec --user node weftwise /bin/bash -l -c 'echo "hostname=$(hostname); pwd=$(pwd); whoami=$(whoami); node=$(node --version); pnpm=$(pnpm --version)"'`

### Result

PASS. Output:

```
hostname=7e1227aca48c; pwd=/workspaces; whoami=node; node=v24.15.0; pnpm=11.1.1
```

- Container is reachable as user `node`.
- Login shell starts cleanly.
- Node 24.15.0 present.
- pnpm resolves via login PATH to `/usr/local/share/nvm/current/bin/pnpm` (version `11.1.1`), NOT the Dockerfile-pinned `/usr/local/bin/pnpm` (version `10.26.2`).

> NOTE(opus/weftwise-verification): The Dockerfile explicitly pins pnpm@10.26.2 because pnpm 11.x enforces `approve-builds` and breaks the electron postinstall.
> A login shell's PATH puts nvm's pnpm ahead of the pinned one, so any direct `pnpm` invocation in an interactive shell uses 11.1.1.
> When `pnpm install` is run from the workspace root, `packageManager: pnpm@10.26.2` in `package.json` is honored (corepack-style routing), so the install itself uses 10.26.2.
> But ad-hoc `pnpm --version` reports 11.1.1 - this misleads anyone debugging version issues.

### Hostname caveat

The container hostname is the truncated container ID (`7e1227aca48c`), not `weftwise`.
This is fine for reachability but means shell prompts and logs do not identify the project by name.
The container has the `--name weftwise` label, so `podman exec weftwise` works as a CLI identifier.

## Step 2 - SSH on allocated port 22425

### What was tested

```sh
ssh -p 22425 -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
    -i /home/mjr/.config/lace/ssh/id_ed25519 node@localhost \
    'echo ssh-ok'
```

### Result

FAIL. Error: `kex_exchange_identification: read: Connection reset by peer`.

### Root cause

Host port `22425` is correctly mapped (`podman port weftwise` confirms `22425/tcp -> 0.0.0.0:22425`).
Inside the container, `sshd` IS running, but it is bound to port `2222` (the devcontainer feature default), not `22425`:

```
$ podman exec --user root weftwise /bin/bash -c 'cat /proc/net/tcp | awk "$4==0A"'
   0: 00000000:08AE 00000000:0000 0A ...   # 0x08AE = 2222
```

`/etc/ssh/sshd_config` contains `Port 2222`. Nothing in the lace-fundamentals feature install script reconfigures sshd to use the assigned `sshPort`.

### Why this happens

`/var/home/mjr/code/weft/lace/main/devcontainers/features/src/lace-fundamentals/devcontainer-feature.json` declares only one option (`defaultShell`).
**There is no `sshPort` option in the feature schema**, no install-script reference to `sshPort`, and no sshd config drop-in.
Yet `.lace/devcontainer.json` injects:

```jsonc
"ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1": {
    "sshPort": 22425,
    ...
}
```

The lace port allocator emits `sshPort` as a feature option, but the feature ignores it.
The `appPort: ["22425:22425"]` mapping is also a no-op for SSH because nothing inside listens on 22425.

> WARN(opus/weftwise-verification): This is a systemic migration gap, not a weftwise-specific bug.
> Any lace project relying on the lace-fundamentals SSH allocation has the same broken SSH posture.
> The published `ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1` may diverge from the local source in this repo - verify the deployed feature artifact before treating local-source absence as definitive.

### Auxiliary observations

- `authorized_keys` mount is correctly wired: `/home/node/.ssh/authorized_keys` is the expected ed25519 public key.
- The container uses `pasta` rootless networking with no published port for `2222`, so even if a user knew about the port mismatch, there is no way to reach sshd from the host.

## Step 3 - Renderer dev server

### Script identification

Root `package.json` exposes `"dev": "pnpm --filter weft dev"` which delegates to `packages/weft/package.json`:

```
"dev": "vite"
```

This is the correct renderer dev server (not the electron-main bundler).
Custom Vite config sets the listen port to `3000`, not the Vite default `5173`.

### Initial state: workspace `node_modules` missing

Inside the bind-mounted workspace at `/workspaces/weftwise/main`, only ROOT dev dependencies (tsx, typescript) are present in `node_modules/`.
Crucially:

- No `node_modules/.pnpm` virtual store.
- No `packages/weft/node_modules/`.
- No `packages/yjs-multiplex/node_modules/`.

The Dockerfile installs deps into `/build` (an isolated layer for Electron prebuild), not into the bind-mounted workspace.
A fresh container has zero workspace dependencies installed.

First attempt to run `pnpm dev` failed with:

```
sh: 1: vite: not found
WARN Local package.json exists, but node_modules missing, did you mean to install?
ELIFECYCLE Command failed with exit code 1.
```

### After running `pnpm install --frozen-lockfile`

The install completed in 2.5s (pnpm hot-cache hit from the prebuilt `/build` layer's pnpm store).
`pnpm dev` then started cleanly:

```
> weft@ dev /workspaces/weftwise/main/packages/weft
> vite

[sync-server] Embedded sync server ready at /sync

  VITE v7.3.0  ready in 1493 ms
  Local:   http://localhost:3000/
  Network: http://192.168.0.65:3000/
```

Vite binds port `3000` (IPv6 ANY).
Embedded sync-server binds port `42069`.

### Host reachability

Tested four endpoints from the host:

| Target                       | Result                       |
|------------------------------|------------------------------|
| `http://localhost:3000/`     | Connection refused (000)     |
| `http://127.0.0.1:3000/`     | Connection refused (000)     |
| `http://192.168.0.65:3000/`  | Connection refused (000)     |
| `http://localhost:3000/` (inside container via `podman exec`) | HTTP 200 |

`podman inspect` shows only port `22425` is published.
Port `3000` has no host mapping.
The "Network: 192.168.0.65:3000" line in Vite output is misleading: pasta networking shows the host's LAN IP inside the container, but the port is not reachable from outside the container namespace.

### Verdict

PARTIAL. Dev server runs inside the container after a manual `pnpm install`.
Host cannot reach it without manual port-forwarding (e.g., `podman exec ... socat` or rebuilding the container with explicit `-p 3000:3000`).

## Findings and recommendations

### Finding 1 - Workspace `node_modules` does not transfer from `/build` to the bind mount

The Dockerfile's `pnpm install --frozen-lockfile` runs in `/build`, but the runtime workspace at `/workspaces/weftwise/main` is bind-mounted from the host with no dependency seeding.
This means the first interaction with the container always requires a `pnpm install` inside the workspace.

The install is fast (2.5s) because the pnpm store in `/build/node_modules/.pnpm` is reused via pnpm's content-addressed cache.
But it is a hard prerequisite that nothing documents or automates.

**Recommendation**: either (a) add a `postCreateCommand` that runs `pnpm install` against the bind-mounted workspace, or (b) document the requirement in the project README / `lace-into` first-run banner.

### Finding 2 - Allocated `sshPort` is a phantom option

`lace-fundamentals` accepts no `sshPort` option, but lace's devcontainer generator injects one anyway.
The result: port allocation succeeds, host port mapping succeeds, but sshd is still on `2222` and unreachable.

**Recommendation**: either (a) extend the `lace-fundamentals` feature install script to write `/etc/ssh/sshd_config.d/lace.conf` containing `Port ${SSHPORT}` and restart sshd, or (b) remove the `sshPort` option from lace's devcontainer.json emitter until the feature supports it. Currently it is dead config.

Note also: the migration agent's prior report claimed the SSH flow was wired - the wiring is only halfway. The mount and host port mapping are correct, but sshd binding is not.

### Finding 3 - Renderer dev port has no automatic host forwarding

The dev server runs on container port 3000.
No feature declares this port, the devcontainer.json `forwardPorts` only lists `22425`, and rootless pasta networking does not expose unlisted ports.

**Recommendation**: this is a project-specific concern. Options:

- Add `3000` to `forwardPorts` and `appPort` in `weftwise/.devcontainer/devcontainer.json` (simplest, project-local).
- Have a lace feature declare a "dev server port" allocation analogous to `sshPort` (more general but requires the same fix as Finding 2 - feature must actually act on the option).
- Document a `lace-into` ssh-port-forward workaround (`-L 3000:localhost:3000`) - blocked by Finding 2.

### Finding 4 - pnpm version split-brain in interactive shells

Login PATH resolves `pnpm` to nvm's `11.1.1` while `packageManager` in `package.json` enforces `10.26.2` for `pnpm install`. Confusing, especially for debugging electron-related install failures (the issue 10.26.2 was pinned to avoid).

**Recommendation**: drop the nvm-installed pnpm from PATH, or shim `pnpm` to the corepack-managed binary. Out of scope for this verification but worth noting.

## Open items for follow-up workstream

- Wire `sshPort` through `lace-fundamentals` install script to actually reconfigure sshd. **Blocking** for any SSH-based developer flow.
- Decide on workspace `node_modules` seeding strategy (postCreateCommand vs documented manual step).
- Decide on dev-server port forwarding strategy. For weftwise specifically, add `3000` (and consider `42069` for sync-server) to `forwardPorts`.
- Confirm the published `ghcr.io/weftwiseink/devcontainer-features/lace-fundamentals:1` matches the local source (i.e., that `sshPort` is genuinely missing from the deployed feature, not just the local source).
- Investigate the pnpm 10 vs 11 PATH precedence issue for cleanliness.

## 2026-05-13 Update: Dev Server Forwarding Fixed

Applied minimal fix for Finding 3 (renderer dev port host forwarding).
Whelm-pattern `"appPort": [3000]` added to weftwise's `devcontainer.json`, and the stale "appPort removed" comment block deleted.

### Diff applied to `.devcontainer/devcontainer.json`

```diff
   "remoteUser": "node",
+  // Vite dev server binds to container port 3000; map it symmetrically to host port 3000.
+  "appPort": [3000],
   // NOTE: NET_ADMIN/NET_RAW capabilities removed - were only needed for firewall
   ...
-  // NOTE: appPort removed -- lace port allocator assigns from 22425-22499 range.
   // REMOVED: bash-history mount (nushell is now the primary shell)
```

### `lace up` wall time

First invocation: 0.82s, but a no-op - lace did not detect the config change and did not recreate the running container.
`podman port weftwise` still showed only `22425/tcp -> 0.0.0.0:22425`.

Second invocation with `lace up --rebuild`: **72.22 seconds**.
Container recreated (created timestamp jumped from 12:06 to 14:55).

> NOTE(opus/weftwise-verification): `lace up` without `--rebuild` did not pick up the new `appPort`.
> Whether this is intentional (devcontainer-cli behavior) or a lace gap is unclear, but worth flagging.
> Users editing devcontainer.json should expect to pass `--rebuild` to apply the change.

### Post-fix port mapping

```
$ podman port weftwise
3000/tcp -> 127.0.0.1:3000
22425/tcp -> 0.0.0.0:22425
```

Port 3000 is published on `127.0.0.1` (loopback only). This is sufficient for host-side `curl localhost:3000`; LAN reachability would require a different binding.

### Host curl result

```
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
HTTP 200
$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/
HTTP 200
```

Both endpoints return 200.

### `pnpm install` needed?

No. The workspace `node_modules/` persisted from the prior in-container `pnpm install` documented in the verification body above (the workspace is bind-mounted from the host, so it survived container recreation).
A fresh worktree on another host would still need a `pnpm install` first - **Finding 1 (workspace `node_modules` seeding) remains unaddressed**. That is RFP territory.

### Still un-fixed (RFP / future-work territory)

- **Finding 1**: workspace `node_modules` seeding strategy.
- **Finding 2**: SSH-on-injected-port (`sshPort` is still a phantom option; sshd is still on 2222 inside the container with no host mapping).
- **Finding 4**: cosmetic pnpm/nvm PATH shadowing (10.26.2 vs 11.1.1).
