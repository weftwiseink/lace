---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T18:00:00-07:00
task_list: weftwise/parallel-feature-development/design-decisions
type: report
state: live
status: review_ready
tags: [portless, parallel-development, weftwise, design-decisions, supplemental]
---

# Weftwise Parallel-Dev: Design Decisions Supplemental

> BLUF: Twelve design decisions back the parallel-dev workstream.
> The parent proposal at `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md` scopes to D1-D5, D7, D8, D9, D11: multi-project (D1), portless adopted in the container (D2), URL pattern (D3), dev script not lace seeds installs (D4), no pnpm-store mount (D5), lace owns the `portless alias` shellout (D7), lace owns the host portless lifecycle (D8), lace bundles portless via pnpm (D9), portless-coupled feature-port metadata with boolean semantics (D11).
> The follow-up RFP `cdocs/proposals/2026-05-13-rfp-truly-portless-portless.md` consumes D6, D10, D12: HTTPS deferral (D6), auto-reversible sysctl drop-in for `:80` binding (D10), HTTPS as priority follow-up (D12).
> Decision details below apply to whichever workstream owns them; cross-references identify the scope.

## D1: Multi-project is the load-bearing case

The fresh-eyes report's Option A (symmetric :80 publish, single project at a time) is simpler but breaks the moment a second project wants port 80.
Option B (host portless + alias) costs marginally more setup and uses the same tool twice; it natively supports many projects.
The user has multiple projects (weftwise, whelm, dotfiles, clauthier, lace itself); committing to multi-project from day one avoids a second pivot.

## D2: Run portless twice (host + container) rather than a bespoke router

Two instances of one mature tool dominate one instance plus a bespoke router daemon:

- One codebase to learn.
- Free HTTPS path via `portless trust` when desired (D12).
- Upstream owns the routing logic and state machine.

The existing host-proxy daemon proposal at `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md` is superseded; it is marked `state: archived, status: evolved`.

## D3: URL pattern is `{branch}.weftwise.localhost`

The project-named top-level subdomain (`.weftwise.localhost`) is the load-bearing piece for multi-project disambiguation.
The branch slot disambiguates worktrees within a project.

Per-service prefixes (`web.`, `storybook.`, `sync.`) are deferred until weftwise actually exposes multiple services per worktree; they slot in as `<service>.<branch>.weftwise.localhost` when needed.

## D4: Install-on-demand lives in the weftwise dev script, not in lace

An earlier draft added a lace `installDeps` flag plus a `mergePostCreateCommand` extension to seed `node_modules` for every sibling worktree at container creation.
That mechanism does not handle worktrees added after the container is up, requires non-trivial lace code, and bakes project-specific package-manager assumptions into lace.

Moving the responsibility to `scripts/worktree.sh dev`:

- Handles fresh and incremental worktrees identically (install-if-missing).
- Keeps lace package-manager-agnostic.
- Single source of truth for "make this worktree runnable + reachable."

Cost: users who bypass the dev script (running `pnpm dev` directly) hit the original install-missing footgun.
Self-imposed limitation; document the dev script as canonical.

## D5: No pnpm-store mount

Weftwise's Dockerfile installs deps into `/build` during prebuild, baking the pnpm content-addressed store into the image.
The verification devlog clocked the bind-mount-workspace install at 2.5s, served from that baked store.
No host-side mount earns its complexity (E5 permission risk under rootless podman userns, an extra mount declaration to maintain).

## D6: HTTP-only in initial scope; HTTPS is a follow-up (see D12 for priority)

`portless trust` adds a local CA and gives `https://main.weftwise.localhost/` for free, but the trust install is a system-CA modification and benefits from being a deliberate opt-in.
Initial scope ships HTTP (on `:1355` per the parent proposal, graduating to `:80` per the truly-portless-portless RFP); HTTPS is tracked as `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md` and prioritized per D12.

## D7: Lace owns `portless alias` lifecycle, not weftwise scripts

The container's portless host port is allocated by lace.
Pushing alias management into a weftwise-side script means weftwise has to learn that port at runtime (via `.lace/devcontainer.json` parsing) and shell out to the host from inside the container — awkward.
Lace already knows the port and already runs on the host; the alias call is a natural extension of the `lace up` pipeline.

## D8: Lace owns host portless lifecycle (no systemd unit, no user-managed daemon)

The earlier draft asked the user to run `portless service install` to register a systemd-user unit.
That is durable host state lace cannot easily reverse.

Lace instead spawns the host portless process itself:

- On `lace up` for any project whose container declares a `portlessAlias: true` port, lace probes for a running host portless.
- If absent, lace spawns one via `child_process.spawn` with `detached: true, stdio: "ignore"` and `unref()`s it.
- PID + start-time recorded in `~/.config/lace/portless-runtime.json`.
- Subsequent `lace up` invocations reuse the running process.
- `lace doctor --reset` terminates it and removes the runtime state file.

No systemd unit, no user-managed daemon, no install ceremony beyond the binary itself.

## D9: Lace bundles portless via pnpm; no global user install

The earlier draft asked the user to run `npm install -g portless`.
That puts portless on the user's PATH (clutter) and demands the user remember to upgrade it.

Lace adds `portless` as a dependency in `packages/lace/package.json`.
Lace resolves the binary at runtime via `require.resolve("portless/dist/cli.js")` (or the equivalent Node API for the published shape of portless's bin entry).
The user installs lace via `pnpm add -g @weftwiseink/lace` (or its eventual published form); portless comes along for free.

Upgrading portless is then a lace dependency bump, not a separate user action.

## D10: Sysctl is the minimum unavoidable durable config; lace owns the drop-in

Binding port 80 on Linux requires either root or a sysctl that lowers `net.ipv4.ip_unprivileged_port_start` to ≤80.
Setcap (`setcap cap_net_bind_service=ep`) is the only narrower alternative but applies to a specific binary — fragile across upgrades.

Lace owns the drop-in at `/etc/sysctl.d/99-lace-unprivileged-ports.conf` containing one line: `net.ipv4.ip_unprivileged_port_start=80`.

Reversibility is fully automatic:

- Install: `sudo cp` the file, `sudo sysctl --system`.
- Uninstall: `sudo rm` the file, `sudo sysctl --system`.

`lace doctor --uninstall` handles this (alongside `lace doctor --reset` which covers the runtime state, the two operations target the two distinct reversibility surfaces); the file is also human-readable and removable by any user with sudo.

This is the only piece of host state lace cannot avoid; all other host config is either lace-owned runtime state or lives in the user's home directory.

## D11: `portlessAlias` is portless-coupled feature-port metadata, boolean-only

The lace metadata flag is `customizations.lace.ports.<option>.portlessAlias: boolean`:

- `true`: declares that this port participates in the portless host-aliasing flow. Consumed by `lace validate` (informational + generic host-port-availability check) and by the `lace up` pipeline (host portless lifecycle + `portless alias <project> <host-port>` shellout, with the alias name derived from `deriveProjectName()`).
- `false` / absent: no host alias behaviour.

Portless-coupled over generic reasoning:

- The name `portlessAlias` explicitly ties the metadata to the portless featureset.
- Future features that want host-side aliasing through a different mechanism (Caddy, nginx, a custom router) should declare a different metadata key with its own semantics.
- Keeping the name portless-specific avoids the maintenance trap of a "generic" schema that ends up encoding portless-specific assumptions anyway.

Boolean-only (no string override) in the initial scope:

- Simpler schema; one field, two states.
- Alias name is unambiguously the project name (= `deriveProjectName()`, = container name); no override mechanism in the initial scope.
- A future RFP may extend to `boolean | string` if a real use case for an explicit alias name appears.

Cost: a project that wants a non-project-name alias has no override. Acceptable for single-developer scope.

## D12: Prioritize HTTPS follow-up given port-80 security considerations

Binding port 80 on `*.localhost` has two security considerations worth surfacing:

- **Local impostor risk.** Any user process on the same machine that races portless can bind 80 first and serve impostor pages at `http://*.weftwise.localhost/`. Mitigation in HTTP-only mode: depend on no other user process targeting 80.
- **Cookie/origin leakage.** A site running on `http://anywhere.localhost/` can set cookies on `.localhost` (depending on browser implementation of public-suffix rules for `.localhost`). Some browsers treat `.localhost` as a single eTLD+1, which would mean cookies set by one project's site CAN be sent to another's.

HTTPS via `portless trust` mitigates both:

- TLS prevents the impostor case (the local CA serves only portless-signed certs).
- Cookies marked `Secure` are scoped to HTTPS contexts and not exposed to plain-HTTP impostors.

The HTTPS RFP at `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md` is therefore a HIGH-PRIORITY follow-up, not a passive future-work entry.
Recommend scheduling it immediately after the initial proposal's Phase 5 (e2e validation) completes.

## References

- Source proposal: `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md`.
- Companion design-space report: `cdocs/reports/2026-05-13-worktree-portless-parallel-dev-prior-work.md`.
- Clean-URL fresh-eyes report: `cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md`.
- HTTPS follow-up RFP: `cdocs/proposals/2026-05-13-rfp-portless-https-via-trust.md`.
- Stale-alias follow-up RFP: `cdocs/proposals/2026-05-13-rfp-lace-stale-portless-alias-cleanup.md`.
- Superseded host-proxy proposal: `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md`.
