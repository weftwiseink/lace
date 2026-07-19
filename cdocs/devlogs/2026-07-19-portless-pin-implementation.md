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

# Portless Pin Implementation (Phases 1 and 1b)

> BLUF: Phases 1 and 1b of the [pin proposal](../proposals/2026-07-18-portless-feature-version-pin-and-ingress-durability.md) are implemented and published.
> The pin value is 0.15.3: it passed the scratch-container smoke test (wide `::` bind, Host-header routing, exact version report), so the 0.13.0 fallback was not needed.
> Feature 1.0.1 is live on ghcr; weftwise main carries the option override and a refreshed lock.
> Nothing about the running weftwise container changed: rebuild, verification, and relay cleanup (phase 6) remain for the maintainer's chosen time.

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

## Deliberately not done

- No rebuild, restart, or stop of the running weftwise container: its hand-started relay is load-bearing for active work.
- The in-container relay and host `~/.cache/weft-portless-bridge.mjs` were NOT deleted (phase 6 is gated on a verified rebuild at the maintainer's chosen time).
- No upstream issue filed against vercel-labs/portless (draft text delivered in the weftwise handback report, awaiting maintainer go-ahead; phase 5).
- No bridge/forwarder process added anywhere.
- Phases 2 (doctor canary), 3 (loopback-scoped publish), 4 (origin discoverability), 5 (upstream issue), and 6 (cleanup) remain outstanding.
- The proposal's success criteria (relay-free host `200` on a rebuilt container) are therefore NOT yet verified end to end; the smoke test verifies the pin value's bind behavior, and the rebuild verification is handed to weftwise.

## Handback

Weftwise-side rebuild/cleanup sequencing and the upstream issue draft: `cdocs/reports/2026-07-19-portless-pin-handback.md` in the weftwise repo.
