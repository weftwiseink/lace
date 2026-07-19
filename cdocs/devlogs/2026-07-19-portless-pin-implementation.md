---
first_authored:
  by: "@claude-fable-5"
  at: 2026-07-19T08:33:54-07:00
task_list: portless/ingress-durability
type: devlog
state: live
status: done
tags: [portless, devcontainer, networking, dependency_pinning, dev-infra]
---

# Portless Pin Implementation (Phases 1, 1b, and 6)

> BLUF: Phases 1, 1b, and 6 of the [pin proposal](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md) are implemented and verified.
> The pin value is 0.15.3: it passed the scratch-container smoke test (wide `::` bind, Host-header routing, exact version report), so the 0.13.0 fallback was not needed.
> Feature 1.0.1 is live on ghcr; weftwise main carries the option override and a refreshed lock.
> Phase 6 (maintainer-authorized, 2026-07-19): the weftwise container was rebuilt via `lace up --rebuild`, the hand relay and host tunnel were killed and deleted, and the acceptance test passed end to end: relay-free host `HTTP 200` on both origins, in-container portless 0.15.3 on a wide `::` bind, alias registered by `lace up` itself.

## Phase 1: pin value smoke test (0.15.3)

Throwaway podman container from `docker.io/library/node:24` (node v24.18.0, satisfies portless >= 0.13.1's node >= 24 requirement).
Installed `portless@0.15.3`, started the proxy with the feature entrypoint's exact flags (`portless proxy start --port 22427 --no-tls`), started a trivial HTTP backend on 8123, registered an alias (`portless alias smoke 8123` -> "Alias registered: smoke.localhost -> 127.0.0.1:8123").

Evidence, pasted from the container:

Bind check (port 22427 = hex 579B; state `0A` = LISTEN):

```
/proc/net/tcp6:   1: 00000000000000000000000000000000:579B 00000000000000000000000000000000:0000 0A ...
```

The listener is the `::` wildcard (dual-stack all-interfaces), not loopback.

Host-header routing, via loopback and via the container's interface address:

```
$ curl -s -H "Host: smoke.localhost" http://127.0.0.1:22427/
hello-from-backend
$ curl -s -H "Host: smoke.localhost" http://192.168.0.65:22427/
hello-from-backend
```

The interface-address request succeeding is the load-bearing result: it is exactly the path pasta uses to deliver published ports, and exactly what 0.15.4's loopback-only bind breaks.

Version check:

```
$ portless --version
0.15.3
```

All three checks pass, so PIN_VERSION = 0.15.3 and the 0.13.0 fallback is unused.
Scratch container removed after the test.

## Feature changes (this repo)

`devcontainers/features/src/portless/devcontainer-feature.json`:
- `version` option default: `"latest"` -> `"0.15.3"`, with the pin reason and unpin condition in the option description.
- Feature's own `version`: `1.0.0` -> `1.0.1`.

`devcontainers/features/src/portless/README.md`:
- New "Version pin" section: 0.15.4 (published 2026-07-16) binds loopback only, which breaks host ingress on rootless podman/pasta; unpin condition is an upstream opt-in bind flag decoupled from LAN mode.
- Corrected the stale upstream link `nicobrinkkemper/portless` -> `vercel-labs/portless`.

Commit: `1846f7d`.

## Phase 1b: publish and consumer lock refresh

Pushed `main` to origin; the `Release Devcontainer Features` workflow ran and succeeded in 21s: <https://github.com/weftwiseink/lace/actions/runs/29693044839>.
`skopeo list-tags docker://ghcr.io/weftwiseink/devcontainer-features/portless` now includes `1.0.1` (alongside `1`, `1.0`, `latest`), confirming the review's r2 note 2: the `:1` major tag picks up the patch release.

Weftwise main (`/var/home/mjr/code/weft/weftwise/main`):
- `.devcontainer/devcontainer.json`: portless feature now carries `{ "version": "0.15.3" }` (the phase-1 immediate mitigation; `install.sh` honors it against any locked digest).
- Lock refresh command (r2 residual note 1): `devcontainer upgrade --workspace-folder . --config .devcontainer/devcontainer.json` (devcontainer CLI 0.87.0).
  A `--dry-run` first confirmed only the portless entry changes; the refreshed lock holds feature `1.0.1` at `sha256:aec6cae8...`, all other digests unchanged.
- Weftwise commit: `07e60707`.

The generated `.lace/devcontainer.json` and `.lace/devcontainer-lock.json` were not hand-edited; `lace up` regenerates them, and the prebuild path re-seeds from the refreshed consumer lock (`extractPrebuiltEntries`), so the new digest propagates.

## Phase 6: rebuild, verification, and runtime-drift cleanup (2026-07-19)

The maintainer directly authorized tearing down the dirty runtime state ("nuke the current dirty state and verify everything lines up"), so the cleanup ran with the ordering inverted from the handback sequence: relay killed first to prove the `502` baseline, then rebuild, then verification.
Nothing was running in the container at the time.

Before-state (`ps` on the host):

```
mjr  482722  ... node -e ...listen(22427,"192.168.0.65",...)                # hand relay (container pid 179360)
mjr 1833217  ... node /var/home/mjr/.cache/weft-portless-bridge.mjs         # host tunnel
```

In-container portless was 0.15.4, bound loopback-only (`/proc/net/tcp` `0100007F:579B`).

1. **Teardown.** Relay and tunnel killed; `~/.cache/weft-portless-bridge.mjs` deleted. Host baseline confirmed broken:

   ```
   $ curl -sI http://mirror-rearch.weftwise.localhost:1355/
   HTTP/1.1 502 Bad Gateway
   X-Portless: 1
   ```

2. **Rebuild.** `lace up --rebuild` from `/var/home/mjr/code/weft/weftwise/main` (fresh `--no-cache` prebuild, container recreated):

   ```
   info: reusing host portless on :1355 (pid 3030001).
   info: registered portless alias weftwise -> :22427.
   lace up completed successfully
   ```

3. **Pin verification** in the rebuilt container:

   ```
   $ podman exec weftwise sh -lc 'portless --version'
   0.15.3
   /proc/net/tcp6: 00000000000000000000000000000000:579B ... 0A   # :: wildcard LISTEN, wide bind
   ```

4. **Relay-free host `200` on both origins**, with `pnpm wt-dev` serving the weftwise `main` worktree (vite :4252) in the container:

   ```
   $ curl -sI http://main.weftwise.localhost:1355/
   HTTP/1.1 200 OK
   x-portless: 1
   $ curl -sI http://main.weftwise.localhost:22427/
   HTTP/1.1 200 OK
   X-Portless: 1
   ```

5. **No forwarders anywhere.** Host `ps` has no relay/tunnel/`node -e` matches, the bridge file is gone, and the container's only 22427 listener is the feature entrypoint's `portless proxy start --foreground --port 22427`.

Deviation of record: the weftwise `mirror-rearch` worktree named in the proposal's verification methodology no longer exists on the host (only `main` remains), so the two-origin acceptance test ran against `main`. The weftwise `qa-up` probes target that missing worktree and were not re-run.

The weftwise-side verification record lives in the weftwise repo: `cdocs/reports/2026-07-19-portless-pin-handback.md`.

## Deliberately not done

- No upstream issue filed against vercel-labs/portless (draft text delivered in the weftwise handback report, awaiting maintainer go-ahead; phase 5).
- No bridge/forwarder process added anywhere; the temporary-relay contingency was not needed.
- Phases 2 (doctor canary), 3 (loopback-scoped publish), 4 (origin discoverability), and 5 (upstream issue) remain outstanding.
