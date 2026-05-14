---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T13:12:41-07:00
task_list: weftwise/parallel-feature-development/prior-work
type: report
state: live
status: review_ready
tags: [worktree, portless, parallel-development, weftwise, planning]
---

# Worktree and Portless: Prior Work for Streamlined Parallel Feature Development on Weftwise

> BLUF(opus/weftwise/parallel-feature-development/prior-work):
> Q1 - Lace's `bare-worktree` layout intentionally mounts an entire bare-repo root into one container per project.
> Worktrees are sibling directories inside that single container, not isolated environments.
> This is the longstanding, deliberate design: it preserves cross-worktree resource sharing (one image build, one set of feature installs, one optional shared `node_modules` cache) and supports fluid intra-container navigation.
> Q2 - Portless is shipped as a devcontainer feature that installs the `portless` npm package and asymmetrically maps a host port from lace's 22425-22499 range to container port 1355.
> It is not consumed by any project today.
> Portless's Host-header demux is the natural primitive for the one-container-N-worktrees pattern: one proxy, many `*.localhost` routes, one published host port.
> Q3 - Inside the shared container, the gaps for parallel feature development are: dev-server ports collide on container port 3000 between concurrent `pnpm dev` invocations, the host has no published mapping for those ports, `node_modules` is not auto-seeded per worktree after image build, and host-side discovery of "which URL serves which worktree" is absent.
> Q4 - Candidate approaches all live inside the shared-container model.
> Portless adoption is central (intra-container Host-header demux solves the port collision and gives stable `*.localhost` URLs per worktree).
> Honouring `forwardPorts` or project-level `customizations.lace.ports` covers single-service projects that do not want portless.
> A `postCreateCommand: pnpm install` hook (optionally iterating sibling worktrees) closes the seeding gap.
> The companion RFP will pick a winner.

> NOTE(opus/weftwise/parallel-feature-development/prior-work): An earlier draft of this report mistakenly framed lace's one-container-per-project design as an "architectural mismatch" with parallel development.
> That is incorrect: one container per bare-repo root is the intentional, longstanding design.
> Worktrees are filesystem views inside a single container, not isolated environments.
> This rewrite anchors the analysis on that correct premise.

## Q1: How the worktree flow actually works today

### One container per project; worktrees are filesystem views inside it

The `customizations.lace.workspace.layout: "bare-worktree"` declaration is parsed by `extractWorkspaceConfig` in `packages/lace/src/lib/workspace-layout.ts`.
When set, `applyWorkspaceLayout` runs `classifyWorkspace` on the host workspace folder, which inspects the `.git` file at the workspace path.
The classifier (`packages/lace/src/lib/workspace-detector.ts`) recognises the nikitabobko convention: a parent directory containing `.bare/` (the bare git database), a `.git` text file pointing to `.bare`, and one or more worktree directories as siblings.
A worktree's own `.git` file points to `../.bare/worktrees/<name>` via a relative path.

For a workspace inside a worktree, `classifyWorkspace` returns `{ type: "worktree", bareRepoRoot, worktreeName, usesAbsolutePath }`.
For a workspace at the bare root itself, it returns `{ type: "bare-root", bareRepoRoot }`.

When `applyWorkspaceLayout` accepts the classification, it mutates the in-memory config:

- `workspaceMount` is set to `source=<bareRepoRoot>,target=<mountTarget>,type=bind,consistency=delegated`
- `workspaceFolder` is set to `<mountTarget>/<worktreeName>` for worktrees, or just `<mountTarget>` for bare-root
- `postCreateCommand` is merged with `git config --global --add safe.directory '*'`
- `git.repositoryScanMaxDepth: 2` is merged into the VS Code settings

The default `mountTarget` is `/workspaces`, but weftwise overrides to `/workspaces/weftwise` so the workspace path inside the container is `/workspaces/weftwise/main`.

Each container hosts one project's full bare-worktree tree.
Worktrees are filesystem views, not isolated environments.
This is intentional: it preserves cross-worktree resource sharing (single container image build, single set of feature installs, optional shared `node_modules` cache via the bare-repo-root `.pnpm-store/`), and supports fluid `cd <worktree>` navigation between branches without container churn.

### Container identity is per-project, not per-worktree

`deriveProjectName` in `packages/lace/src/lib/project-name.ts` returns `basename(classification.bareRepoRoot)` for worktree and bare-root layouts.
The worktree name is deliberately excluded from the project name.
The doc comment is explicit: "in the worktrunk model, one container holds all worktrees as siblings."

`up.ts` then injects `--name <sanitized-project-name>` into `runArgs`.
For weftwise the container is named `weftwise`, not `weftwise-main`.
Running `lace up` from `/home/mjr/code/weft/weftwise/main` and from `/home/mjr/code/weft/weftwise/loro_migration` resolves to the same container.
The `.lace/` state is per-worktree (each worktree has its own `.lace/devcontainer.json`), but the runtime artifact (the container) is per-project.

This is reinforced by `cdocs/reports/2026-02-13-worktree-aware-devcontainers.md`, which scopes itself explicitly to "a single container model: mount the entire bare-repo root (all worktrees) into one devcontainer, then navigate between worktrees as sibling directories" and locates the contrasting one-container-per-worktree model (BranchBox, DevTree, devcontainers/cli `--mount-git-worktree-common-dir`) outside lace's intended design.
`cdocs/reports/2026-02-16-project-naming-reference.md` and `cdocs/reports/2026-02-16-worktree-naming-support-status.md` state the same invariant in lace's CLI surface terms.

### There is no `lace worktree` subcommand

`packages/lace/src/commands/` contains: `prebuild.ts`, `resolve-mounts.ts`, `restore.ts`, `status.ts`, `up.ts`, `validate.ts`.
Grepping for `worktree add`, `wt-clone`, `--branch` in `packages/lace/src/` finds no implementation.

Worktree creation is handled by a separate user-side tool, `wt-clone`, documented in `cdocs/proposals/2026-03-05-worktree-conversion-script.md` (status: `result_accepted`, state: `archived`).
`wt-clone` is a nushell command in dotfiles that runs the 6-step ceremony: bare clone, `.git` file, refspec, fetch, worktree add, relative-gitdir fixup.
The user's intended workflow is "push, delete, re-clone" rather than in-place conversion.

For adding a NEW worktree to an existing bare-repo (the parallel-feature-development case), the user is expected to use plain `git worktree add` or external tooling (`wt`/worktrunk).
Lace simply makes the new sibling directory visible inside the already-running container the next time the user `cd`s into it; no rebuild and no second container.

### Weftwise's host layout

Verified on disk at `/home/mjr/code/weft/weftwise/`:

```
weftwise/
  .bare/                  # bare git database with worktrees/ subdirectory
  .git                    # text file: "gitdir: /var/home/mjr/code/apps/weft/.bare"  (absolute, legacy)
  .pnpm-store/            # cross-worktree pnpm cache (host-only)
  .worktree-root          # nikitabobko-convention marker
  main/                   # worktree (gitdir: ../.bare/worktrees/main, relative)
    .git
    .lace/                # per-worktree state
  loro_migration/         # worktree (gitdir: ../.bare/worktrees/loro_migration, relative)
    .git
```

Two notable details:

1. The bare-repo's own `.git` file uses an **absolute path** (`/var/home/mjr/code/apps/weft/.bare`), pointing at a legacy location that may not exist.
   Worktree `.git` files use relative paths and resolve correctly inside the container mount.
   This is the same `usesAbsolutePath` warning the classifier emits; the bare-root condition triggers it but the workspace is opened inside a worktree, so the mount resolution still works.
2. The container hostname is the truncated container ID, not `weftwise` (per Step 1 of `cdocs/devlogs/2026-05-13-verify-weftwise-migration.md`).
   This is a cosmetic issue, but it means shell prompts and logs do not identify the project by name even though the container is named `weftwise`.

### Prior cdocs on worktree development

| Path | One-line summary |
|------|------------------|
| `cdocs/reports/2026-02-13-worktree-aware-devcontainers.md` | Catalogues failure modes and three tiers of support; chose Tier 2 (auto-configuration via `customizations.lace.worktree`), now implemented as `customizations.lace.workspace.layout: "bare-worktree"`. |
| `cdocs/reports/2026-02-13-worktree-support-executive-summary.md` | Executive companion to the above. |
| `cdocs/proposals/2026-02-15-workspace-validation-and-layout.md` | Spec for the workspace-detector + workspace-layout modules that are now in tree. |
| `cdocs/proposals/2026-02-16-unify-worktree-project-identification.md` | Establishes that bare-repo basename, not worktree name, is the project identity. |
| `cdocs/proposals/2026-03-05-worktree-conversion-script.md` | Specifies `wt-clone`; explicitly out of scope for lace core (lives in dotfiles). |
| `cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md` | Adds container-side git version validation for `extensions.relativeWorktrees`. |
| `cdocs/reports/2026-03-25-worktrunk-merge-workflow-analysis.md` | Documents `wt merge`'s inverted semantics. Tangential to the parallel-dev story but relevant if RFP adopts `wt` for worktree creation. |

## Q2: How portless actually works

### The feature manifest declares one port, one option

`devcontainers/features/src/portless/devcontainer-feature.json` declares two options:

- `proxyPort` (default `"1355"`, description: "Container-internal portless proxy port. With lace, this default is used as the container side of an asymmetric port mapping (e.g., 22435:1355). Not used by install.sh.")
- `version` (default `"latest"`)

It carries `customizations.lace.ports.proxyPort` with `label: "portless proxy"`, `onAutoForward: "silent"`, `requireLocalPort: true`.
The id matches the option name (`proxyPort`), per the featureId/optionName key convention enforced by `validatePortDeclarations` in `packages/lace/src/lib/feature-metadata.ts`.

`installsAfter` lists `ghcr.io/devcontainers/features/common-utils`.
`dependsOn` lists `ghcr.io/devcontainers/features/node:1` (npm is required for install).

### Install does nothing port-related

`devcontainers/features/src/portless/install.sh` runs `npm install -g portless@${VERSION}`, verifies the binary, and writes `/usr/local/share/portless-feature/entrypoint.sh` that runs `portless proxy start` (no port argument).
There is no `/etc/profile.d/`, no `PORTLESS_PORT` baking, no port-related config files.
The container always listens on port 1355 internally.

### Lace consumes the metadata via asymmetric injection

The portless feature is designed to be referenced from `customizations.lace.prebuildFeatures` (not top-level `features`), per the design rationale at `cdocs/reports/2026-02-26-portless-integration-design-rationale.md`.

When lace's pipeline (`packages/lace/src/lib/template-resolver.ts`) sees a prebuild feature with `customizations.lace.ports`, `injectForPrebuildBlock()` reads the option's `default` value and produces an asymmetric appPort entry: `${lace.port(portless/proxyPort)}:1355`.

`PortAllocator` (`packages/lace/src/lib/port-allocator.ts`) allocates a free port from the range 22425-22499 (the comment notes "w=22, e=4, z=25 spells 'wez' in alphabet positions") and persists the assignment in `.lace/port-assignments.json` for stable reuse across runs.

The resolved entry becomes `appPort: ["22435:1355"]`.
Docker maps host 22435 to container 1355.
The container image does not encode the host port; reassignment is a mapping change, not a rebuild.

`FeaturePortDeclaration.requireLocalPort` defaults to `true` and surfaces as a `portsAttributes` entry with the same flag set, signalling to VS Code's port forwarder that the local-side port number is load-bearing (not auto-remappable on conflict).

### The routing mechanism is in-container HTTP Host-header demux

Portless is a userspace HTTP reverse proxy.
It runs inside the project's single container and routes by HTTP `Host` header.
Per `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md`:

- Browser sends `Host: web.main.localhost` to portless on its proxy port.
- Portless reads `~/.portless/routes.json`, finds the route for `web.main.localhost`, forwards to `127.0.0.1:<allocated-port>`.
- `portless <name> <command>` is the registration entrypoint: it allocates a port in 4000-4999, writes the route, and sets `PORT=<allocated>` and `HOST=127.0.0.1` in the child env.

This is exactly the primitive the one-container-N-worktrees model needs.
The single container holds dev-server processes from multiple worktrees; each registers a distinct `Host` value (e.g., `web.main`, `web.feature-x`, `web.loro_migration`); portless demuxes them onto distinct container-internal ports; a single asymmetric host-port mapping exposes the proxy to the browser.

`*.localhost` resolves to 127.0.0.1 without DNS configuration:

- Linux: `nss-myhostname` (part of systemd) resolves any `*.localhost` to 127.0.0.1.
- macOS: native resolution.
- Browsers: per RFC 6761 they treat `*.localhost` as a secure context and resolve it independently.

So with the portless feature wired up, a developer can run `portless web.main next dev` and `portless web.feature-x next dev` concurrently inside the same weftwise container, and the host browser reaches each at `http://web.main.localhost:22435` and `http://web.feature-x.localhost:22435` via the same Docker mapping.

### The two-tier proxy design is documented but not implemented

The architecture report (`cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md`) proposes a **second** proxy on the host at port 80 that strips a project segment from the hostname (`web.main.weft-app.localhost` → routes to `weft-app`'s container portless port, with rewritten Host `web.main.localhost`).
This second tier is what would eliminate the port number from URLs and enable cross-project multiplexing.

It is explicitly out of scope for the existing portless feature (Decision 5 in `cdocs/reports/2026-02-26-portless-integration-design-rationale.md`).
No host-proxy daemon or `lace setup` sysctl exists in tree.
`packages/lace/src/commands/` has no `setup` command.

> NOTE(opus/weftwise/parallel-feature-development/prior-work): The "near-zero system setup" pitch in the architecture report assumes a `sysctl net.ipv4.ip_unprivileged_port_start=80` change plus a `~200-300 lines Node.js` host daemon plus `~/.config/lace/proxy-state.json` state.
> None of those exist in the lace tree.
> For weftwise's immediate needs the container-side feature (which exists) is sufficient if the user accepts URLs with port numbers.

### Portless has never been used in a project

Grep verification:

- The `portless` directory is the only reference to portless in `devcontainers/features/src/`.
- Weftwise's `.devcontainer/devcontainer.json` does not declare portless in `features` or in `customizations.lace.prebuildFeatures`.
- The generated `/home/mjr/code/weft/weftwise/main/.lace/devcontainer.json` reflects the source: features are `neovim`, `nushell`, `claude-code`, `lace-fundamentals`.
- No other consumer is reachable from the workspaces enumerated in the working directory.

The feature exists, was reviewed, has integration test scaffolding (`packages/lace/src/__tests__/portless-scenarios.test.ts`), but is wholly dormant in real use.

### Prior cdocs on portless

| Path | One-line summary |
|------|------------------|
| `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md` | Defines two-tier proxy (container portless + host port-80 daemon), the `*.localhost` domain choice, and naming convention. |
| `cdocs/reports/2026-02-25-portless-alternatives-survey.md` | 15-tool survey; only portree (Go, 3 stars, no container awareness) is at the same intersection. |
| `cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md` | Initial portless analysis; partially superseded by the architecture report. |
| `cdocs/reports/2026-02-25-local-domain-dns-configuration-research.md` | `.test` + dnsmasq analysis; superseded by `.localhost`. |
| `cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md` | Symmetric vs asymmetric injection paths in `template-resolver.ts`. |
| `cdocs/reports/2026-02-26-portless-integration-design-rationale.md` | Seven decisions: feature over docs, no fork, asymmetric mapping, no env propagation, container-only scope, dot-hierarchy naming, two-option schema. |
| `cdocs/proposals/2026-02-26-portless-devcontainer-feature.md` | Implementation proposal (accepted, marked `implementation_wip`). |
| `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md` | Spec for the missing host-side proxy daemon. |
| `cdocs/devlogs/2026-02-26-portless-feature-implementation.md` | Implementation devlog. |
| `cdocs/devlogs/2026-02-26-portless-integration-exploration.md` | Pre-proposal exploration notes. |
| `cdocs/reviews/2026-02-26-review-of-portless-devcontainer-feature.md` | Review of the proposal. |
| `cdocs/reviews/2026-02-26-review-of-host-proxy-project-domain-routing.md` | Review of the host-proxy proposal. |
| `cdocs/reviews/2026-02-26-review-of-portless-feature-implementation.md` | Review of the implementation. |

## Q3: Gap between today and "parallel feature development is effortless"

The shared container is the right substrate.
The gaps live inside it: workspace seeding, intra-container port conflict, host-side reachability, and discovery.

### Today, manually, end-to-end

The path from "I have a bare-repo with worktrees `main` and `feature-x`" to "two browser tabs showing two running dev servers" looks like this with the current primitives:

1. `cd /home/mjr/code/weft/weftwise/main && lace up` - builds the image, starts container `weftwise`, mounts the bare-repo root at `/workspaces/weftwise`, opens at `/workspaces/weftwise/main`.
2. Inside the container, `pnpm install --frozen-lockfile` in each worktree directory - required because the workspace is bind-mounted and the Dockerfile installed deps into `/build`, not the bind-mount target. Per Finding 1 of `cdocs/devlogs/2026-05-13-verify-weftwise-migration.md`.
3. Open three terminal panes inside the container. Pane 1 in `/workspaces/weftwise/main`, Pane 2 in `/workspaces/weftwise/feature-x` (after `git worktree add` on the host), Pane 3 in `/workspaces/weftwise/feature-y`.
4. Run `pnpm dev` in Pane 1. Vite binds container port 3000.
5. Run `pnpm dev` in Pane 2. Vite fails with `EADDRINUSE` on port 3000.
6. Even if Pane 1's server resolved, the host has no port mapping for 3000. Per Finding 3 of the verification devlog: `appPort` only includes the lace-allocated SSH port (22425), no `forwardPorts` entry for 3000, no published mapping. `curl localhost:3000` from the host fails with connection refused, despite the container having a listening server.

So today, with no additional work:

- Workspace disambiguation works (each worktree is a distinct directory under the same mount root).
- Container reuse works (single container holds all worktrees).
- Dev-server port conflict is real (intra-container `EADDRINUSE` between concurrent `pnpm dev` invocations from different worktrees).
- Host reachability is broken (no published mapping for 3000).
- Workspace dependency seeding is manual (one `pnpm install` per worktree per fresh container).

### What works automatically

- Adding a new worktree on the host makes it instantly visible at `/workspaces/weftwise/<new-worktree>` from inside the container. No rebuild required; the bare-repo root is already mounted, so the new sibling directory just appears.
- Worktree mounting is automatic via `customizations.lace.workspace.layout: "bare-worktree"`.
- The lace port allocator (`packages/lace/src/lib/port-allocator.ts`) handles the host-side port range and stable reuse correctly for feature-declared ports. The problem is that no project-declared dev-server port flows through it today.
- The `.lace/port-assignments.json` file persists allocations, so port numbers do not churn across `lace up` runs.

### What breaks

#### Workspace `node_modules` seeding

The Dockerfile installs into `/build` (an isolated layer for Electron prebuild).
The bind-mounted workspaces at `/workspaces/weftwise/<worktree>` start empty (no `node_modules`).
First `pnpm dev` fails with `sh: 1: vite: not found`.
A manual `pnpm install --frozen-lockfile` is fast (~2.5s, pnpm hot-cache hit from the prebuilt store), but required once per worktree, and nothing automates it.

Devcontainer lifecycle hooks are the obvious lever:

- `onCreateCommand`: runs the first time the container is created. Once per container lifetime. Would not handle worktrees added after the container exists.
- `updateContentCommand`: runs on container start AND when content changes are detected by the devcontainer CLI. Conceptually a fit for "seed deps when the workspace content changes."
- `postCreateCommand`: runs after `onCreateCommand`, after VS Code mounts the workspace. Once per container lifetime.

Lace currently merges `git config --global --add safe.directory '*'` into `postCreateCommand` via `mergePostCreateCommand` in `workspace-layout.ts`.
Weftwise's project devcontainer.json adds nothing else (the project supplies an empty `runArgs: []` and lets lace handle `postCreateCommand`).
There is precedent for lace-managed `postCreateCommand` injection, and the mechanism is already namespaced (`lace:workspace` vs `lace:user-setup` keys).

A `postCreateCommand` step that runs `pnpm install --frozen-lockfile` should iterate every sibling worktree under the mounted bare-repo root, not just the active one, because the shared container serves all of them.
The cost is bounded: the host-side `.pnpm-store/` is bind-mountable into the container, making per-worktree installs near-instant once the store is warm.

> NOTE(opus/weftwise/parallel-feature-development/prior-work): Weftwise has a host-side `.pnpm-store/` directory at the bare-repo root.
> If pnpm is configured to use that as a global store via the bind mount, `pnpm install` becomes near-instant in every worktree.
> The RFP should treat the store mount and the multi-worktree iteration as a single decision.

#### Intra-container dev-server port conflict

Multiple `pnpm dev` invocations in the same container all want port 3000.
The second one fails.
The fix is intra-container demux: each `pnpm dev` is wrapped (`portless web.main next dev`), portless allocates a unique container-internal port (4000-4999 range), injects `PORT=<allocated>` into the child env, and routes the proxy port to it via Host header.
The browser uses `http://web.main.localhost:22435` regardless of internal port; concurrent worktrees get distinct Host values and distinct URLs.

The portless feature gives us this today (the code exists), with two prerequisites:

- The project's devcontainer.json must declare portless in `prebuildFeatures` and the user must invoke their dev servers via `portless <name> ...`.
- Vite is in the framework-specific list of CLIs that ignore `PORT` env var, so portless injects the appropriate CLI flag (e.g., `--port`) automatically; weftwise's vite setup currently hard-codes port 3000 in its config (per the verification devlog), which would need to be relaxed to `process.env.PORT ?? 3000` for portless to override.

For projects that do not adopt portless (single dev server, no concurrent worktrees), the simpler `forwardPorts`/project-`lace.ports` path is sufficient: one published host port maps to container 3000, host browser uses `http://localhost:<port>`, and concurrent worktrees are not attempted.

#### Dev server host reachability

Even after solving the intra-container conflict, the host needs to reach the dev server.
Today:

- `appPort` only contains `22425:22425` (the lace-allocated SSH port that is itself broken, per Finding 2 of the verification devlog).
- `forwardPorts` only contains 22425.
- No mechanism in the current weftwise devcontainer.json publishes 3000.

Options:

- **Add `forwardPorts: [3000]` and `appPort: ["3000:3000"]` to the project devcontainer.json.** Simplest, project-local. Only one process inside the container can bind 3000 at a time, but that is exactly the single-dev-server case.
- **Declare a project-level lace port** that allocates from 22425-22499 and forwards `<allocated>:3000`. Requires lace to honour `customizations.lace.ports` at the project level (today it is only honoured for features). The `host-proxy-project-domain-routing` proposal anticipates this gap.
- **Use portless and accept `*.localhost:22435` URLs.** No project-level lace.ports support needed; the existing portless feature handles the host mapping via its prebuild-feature plumbing, and any number of concurrent worktrees route through the same host port.
- **Use the unimplemented host port-80 proxy** for clean URLs without port numbers. Out of scope for any near-term work.

#### SSH-tunnel workaround is also broken

A common "I can't reach this port" workaround is `ssh -L 3000:localhost:3000 -p 22425 node@localhost`.
Per Finding 2 of the verification devlog, this does not work today: `sshd` inside the container listens on 2222 but the host port (22425) is mapped to 22425 because `lace-fundamentals` does not honour the injected `sshPort` option.
Even if SSH were wired up, an `-L` tunnel per dev server is poor UX.

#### Host-side worktree discovery

The host has no way to enumerate "which worktrees are currently serving, and at which URLs."
`lace-discover --list` surfaces container names and SSH ports but not portless routes or dev-server URLs.
A small extension that prints active portless routes (read from inside the container) would close this loop.

## Q4: Design space for solving this

Four candidate approaches, all operating within the single-container model.
Each is described in terms of: mechanism, lace code changes, weftwise config changes, what it does for the user, what it does not solve, and how it relates to the other candidates.

### A. Project-level `customizations.lace.ports` honouring user-declared dev ports

**Mechanism.**
Extend lace's template-resolver pipeline so that `customizations.lace.ports.<label>` in the project's devcontainer.json (not just in a feature) participates in port allocation.
The user declares e.g.:

```jsonc
"customizations": {
  "lace": {
    "ports": {
      "dev": {
        "label": "vite dev server",
        "containerPort": 3000,
        "onAutoForward": "openBrowser",
        "requireLocalPort": false
      }
    }
  }
}
```

Lace allocates from 22425-22499, generates `appPort: ["<allocated>:3000"]` (asymmetric), and the user opens `http://localhost:<allocated>`.

**Lace code changes.**

- Add a project-port extraction step parallel to `extractLaceCustomizations` for features. The `ports` shape exists today in `LaceCustomizations`; the missing piece is project-side parsing.
- Extend `autoInjectPortTemplates` (or add a sibling function) to produce asymmetric appPort entries for project-declared ports.
- Decide a label namespace: per the mount precedent, project-level keys are prefixed `project/<label>`. Port labels could follow the same convention.
- Decide whether `containerPort` is an extra field on the project-port declaration (since features encode it as the option default, but project ports have no option to draw a default from).

**Weftwise changes.** Add the `customizations.lace.ports.dev` block above to `.devcontainer/devcontainer.json`. Relax vite config to read `process.env.PORT` so the same approach can be applied if the port needs to change.

**Pros.** Generalises beyond portless. No npm dependency. No new runtime daemons. Works for any TCP service (HTTP, websockets, sync server on 42069, etc.).

**Cons.** Only one container-side process can bind port 3000 at a time. Concurrent `pnpm dev` invocations from different worktrees still collide intra-container on 3000. Suitable for single-dev-server projects or when the user serializes worktree-level dev sessions; does not provide intra-container demux.

**Dependencies.** Independent. Pairs naturally with B (just-add-forwardPorts) but is more flexible.

### B. Honour standard `forwardPorts` in lace's port pipeline

**Mechanism.**
The devcontainer spec already has a `forwardPorts` field.
Today lace passes it through unchanged.
This option teaches lace to auto-map declared `forwardPorts` into `appPort` entries when no host port collision exists, and to allocate from 22425-22499 (with asymmetric mapping) when there IS a collision (e.g., another lace container has port 3000 published).

**Lace code changes.**

- During the up pipeline, after feature port allocation, scan `forwardPorts` for entries not already in `appPort`.
- For each, check host availability via `isPortAvailable`. If free, add `<port>:<port>` (symmetric). If taken, allocate a new host port from the lace range and add `<allocated>:<port>` (asymmetric).
- Persist the choice in `.lace/port-assignments.json` keyed by `project/forwardPorts/<port>`.

**Weftwise changes.** Add `forwardPorts: [3000]` to the devcontainer.json.

**Pros.** Uses the standard devcontainer surface. Other tooling (VS Code, Codespaces) already understands `forwardPorts`. Zero new schema.

**Cons.** Same intra-container conflict as A. No demux. Still only one dev server reachable per project at a time.

**Dependencies.** Strict subset of A in capability. If A is built, B is partially redundant. If B is built first, A becomes a "more powerful overlay."

### C. Adopt portless for weftwise (use the existing feature)

**Mechanism.**
Add the portless feature to weftwise's `customizations.lace.prebuildFeatures`.
Replace `pnpm dev` with `portless <worktree> next dev` (or `portless <service>.<worktree> next dev` for multi-service worktrees) in the user workflow.
Browser opens `http://web.main.localhost:22435` (where 22435 is the lace-allocated host port for the portless proxy).
Concurrent worktrees register distinct Host values and route through the same host port; one proxy demuxes them all.

**Lace code changes.** None to lace core. The portless feature is published (or local-path consumable today via `./devcontainers/features/src/portless`).

**Weftwise changes.**

- Add `"./devcontainers/features/src/portless": {}` (during dev) or the GHCR reference (when published) to `customizations.lace.prebuildFeatures`.
- Add `portsAttributes` for 4000-4999 with `onAutoForward: "silent"` per the proposal's recommendation.
- Adjust `vite.config.ts` to honour `process.env.PORT` so portless's port injection takes effect.
- Document the `portless` wrapper in weftwise's README.

**Pros.**

- Solves the intra-container dev-server conflict directly: this is portless's raison d'etre.
- Per-worktree URLs work via dotted Host headers, with one published host port serving all worktrees in the project's container.
- No lace core changes.
- Fits the single-container model exactly: one proxy, one host mapping, N route entries.

**Cons.**

- URLs carry a port number until the host-side proxy lands.
- Portless is new (created 2026-02-15) and pinned at "latest" today; pinning a known-good version is best practice but creates a new release-management thread.
- Per the design rationale, framework-specific CLI flags are needed for Vite, Astro, and Angular; this is handled by portless's CLI launcher today, but is a moving target.
- Requires team buy-in on a non-standard `portless <name> ...` wrapper around dev commands.
- Does not address `pnpm install` seeding.

**Dependencies.** Independent of A and B. Compatible with D (`pnpm install` automation). Becomes more powerful when the unimplemented host port-80 proxy lands (the URLs lose the port number).

### D. `pnpm install` as `postCreateCommand`, iterating sibling worktrees

**Mechanism.**
Lace appends `pnpm install --frozen-lockfile` (or similar) to `postCreateCommand`, iterating every sibling worktree under the mounted bare-repo root rather than only the currently-active workspace folder.

**Lace code changes.**

- A new opt-in `customizations.lace.workspace.postCreate.installDeps: true` flag, off by default.
- When set, lace appends an install loop to the existing `lace:workspace` postCreateCommand entry: enumerate sibling directories under `mountTarget` (excluding `.bare`), and for each that contains a `package.json`, run the appropriate install command.
- Detect the package manager (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn).
- Optionally mount the host-side `.pnpm-store/` into the container so the install is hot-cache-served.

**Weftwise changes.** Opt in by setting the flag. Optionally declare a `project` mount for `.pnpm-store`.

**Pros.** Eliminates the documented manual step for every worktree, not just the entry one. Composes cleanly with A, B, or C.

**Cons.**

- `postCreateCommand` runs once per container creation. Worktrees added after the container exists still need a manual install. (Could be addressed by also using `updateContentCommand`, but that runs on every start.)
- Detecting the right package manager and lockfile is heuristic.
- Inflates first-`lace up` time noticeably (cold install can be 30-60s; warm is 2.5s per the verification devlog) times the number of worktrees.
- For users running on hot caches, the install is a no-op, which is fine; for users with stale state, it might do too much.

**Dependencies.** Orthogonal to A-C. Solves a different problem (workspace seeding), but it is the most-frequently-needed quality-of-life fix in the verification findings.

### Composition matrix

| Combination | What the user gets | What remains broken |
|-------------|-------------------|---------------------|
| A only | Reliable host reachability for a declared dev port | Concurrent worktree dev servers collide intra-container on 3000 |
| B only | Same as A but using standard `forwardPorts` | Same as A |
| C only | Intra-container demux, per-worktree URLs (with port suffix) | `pnpm install` seeding, URL aesthetics |
| C + D | Above plus zero-touch dep seeding across all worktrees | URL aesthetics until host-side proxy lands |
| A + D | Single dev server reachable on host with stable URL, zero-touch deps | No multi-worktree dev concurrency |
| C + A + D | Portless for demux, project-level lace.ports for non-HTTP ports (e.g. sync-server, debug ports), zero-touch deps | URL aesthetics |

### Out-of-band concerns the RFP must address

- **SSH-port allocation is broken (Finding 2 of the verification devlog).** Any RFP that touches the port pipeline should address whether `sshPort` is fixed-up in `lace-fundamentals` or removed as a phantom option. Until then, candidates B (forwardPorts) and A (project-level ports) both work, but the SSH-mounted developer flow does not.
- **pnpm version split-brain (Finding 4 of the verification devlog).** Out of scope for the RFP unless `pnpm install` automation is selected (option D), in which case the install command must be invariant to interactive PATH.
- **Vite hard-coded port.** Whatever candidate is chosen, weftwise's vite config needs to honour `process.env.PORT` or the chosen mechanism cannot relocate the port.
- **Host-side discovery.** None of A-D include a `lace-discover` extension that surfaces dev-server URLs alongside container metadata. The RFP should decide whether that lives in the same proposal or a follow-up.

## Citations

### Lace source code

- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/workspace-layout.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/workspace-detector.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/project-name.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/port-allocator.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/template-resolver.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/feature-metadata.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/up.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/lib/up.ts`
- `/var/home/mjr/code/weft/lace/main/packages/lace/src/commands/` (directory enumeration)

### Lace feature sources

- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/portless/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/portless/install.sh`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/lace-fundamentals/devcontainer-feature.json`
- `/var/home/mjr/code/weft/lace/main/devcontainers/features/src/lace-fundamentals/install.sh`

### Weftwise host artefacts

- `/home/mjr/code/weft/weftwise/main/.devcontainer/devcontainer.json`
- `/home/mjr/code/weft/weftwise/main/.lace/devcontainer.json` (generated)
- `/home/mjr/code/weft/weftwise/main/package.json`
- `/home/mjr/code/weft/weftwise/.git`, `/home/mjr/code/weft/weftwise/.bare/`, `/home/mjr/code/weft/weftwise/.worktree-root`
- `/home/mjr/code/weft/weftwise/main/.git`, `/home/mjr/code/weft/weftwise/loro_migration/.git`

### Prior cdocs - worktree architecture and naming

- `cdocs/reports/2026-02-13-worktree-aware-devcontainers.md`
- `cdocs/reports/2026-02-13-worktree-support-executive-summary.md`
- `cdocs/proposals/2026-02-15-workspace-validation-and-layout.md`
- `cdocs/proposals/2026-02-16-unify-worktree-project-identification.md`
- `cdocs/proposals/2026-03-05-worktree-conversion-script.md`
- `cdocs/proposals/2026-03-10-git-relativeworktrees-version-mismatch.md`
- `cdocs/reports/2026-03-25-worktrunk-merge-workflow-analysis.md`

### Prior cdocs - portless and port allocation

- `cdocs/reports/2026-02-25-worktree-domain-routing-architecture.md`
- `cdocs/reports/2026-02-25-portless-alternatives-survey.md`
- `cdocs/reports/2026-02-25-portless-devcontainer-integration-analysis.md`
- `cdocs/reports/2026-02-25-local-domain-dns-configuration-research.md`
- `cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md`
- `cdocs/reports/2026-02-26-portless-integration-design-rationale.md`
- `cdocs/proposals/2026-02-26-portless-devcontainer-feature.md`
- `cdocs/proposals/2026-02-26-host-proxy-project-domain-routing.md`
- `cdocs/devlogs/2026-02-26-portless-feature-implementation.md`
- `cdocs/devlogs/2026-02-26-portless-integration-exploration.md`
- `cdocs/reviews/2026-02-26-review-of-portless-devcontainer-feature.md`
- `cdocs/reviews/2026-02-26-review-of-host-proxy-project-domain-routing.md`
- `cdocs/reviews/2026-02-26-review-of-portless-feature-implementation.md`

### Migration context (cross-link)

- `cdocs/devlogs/2026-05-13-verify-weftwise-migration.md` - verification of weftwise post-migration, source of Findings 1-4 cited throughout this report.
- `cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md` - accepted migration proposal.
- `cdocs/reports/2026-05-13-initial-migration-scoping.md` - scope clarification carving portless and host-SSH replacement out of the initial migration.
