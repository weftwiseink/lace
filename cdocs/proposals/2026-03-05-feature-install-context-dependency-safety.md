---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-05T12:00:00-06:00
task_list: lace/feature-dependencies
type: proposal
state: live
status: request_for_proposal
tags: [devcontainer-features, dependencies, install-safety, lace]
---

# Feature Install Context Dependency Safety

> BLUF: Our devcontainer features (wezterm-server, claude-code, neovim, portless)
> install into containers that may lack prerequisites they need at runtime or install
> time. The devcontainer spec now includes a `dependsOn` property for hard feature
> dependencies, but this only covers feature-on-feature dependencies -- not
> prerequisites baked into the base image (like `curl`, `dpkg`, or a running `sshd`).
> We need a layered strategy: runtime guards in `install.sh` for immediate safety,
> lace-level dependency validation for our orchestration layer, and `dependsOn`
> declarations where the spec supports them.
>
> - **Motivated By:** `cdocs/reports/2026-03-05-devcontainer-feature-dependency-research.md`

## Objective

Our devcontainer features assume prerequisites that are not guaranteed to exist in the
install context:

- **wezterm-server** needs `curl` and `dpkg` at install time, and relies on `sshd`
  being present at runtime for SSH domain multiplexing. It declares
  `installsAfter: ["ghcr.io/devcontainers/features/sshd"]`, but `installsAfter` is a
  soft dependency -- it only reorders installation if the user also declares `sshd` in
  their `features` block. If `sshd` is omitted, wezterm-server installs fine but SSH
  connections silently fail at runtime.
- **claude-code** needs `npm` at install time. Without it, `install.sh` fails with an
  error message pointing at `ghcr.io/devcontainers/features/node`, but the failure is
  only discoverable through container build logs.
- **neovim** needs `curl` at install time. Same pattern as wezterm-server.
- **portless** needs `npm` at install time. Same pattern as claude-code.

The devcontainer spec historically had no mechanism for declaring hard dependencies
between features. The only tool was `installsAfter`, which is purely advisory -- it
influences ordering but does not ensure a dependency is present. As of the current spec
revision, a `dependsOn` property has been added that allows features to declare hard
dependencies that implementing tools must install as prerequisites. The reference CLI
(v0.83.3, which we use) supports this.

However, `dependsOn` only covers feature-on-feature relationships. It cannot express:
- "I need `curl` to be present in the base image"
- "I need `sshd` to be running at runtime, not just installed"
- "I need `npm`, which could come from the base image or from a feature"

This proposal explores strategies for making our features fail safely and predictably
when their prerequisites are missing, ranging from simple runtime guards to lace-level
orchestration.

## Scope

The full proposal should explore the following options and make recommendations.

### Option 1: install.sh Runtime Guards

Features check for prerequisites at the top of `install.sh` and fail with actionable
error messages.

**Current state:** We already do this partially. All four features have `command -v`
checks:
- wezterm-server: checks for `curl`
- claude-code: checks for `npm`
- neovim: checks for `curl`
- portless: checks for `npm`

Each check exits with a message like `"Error: npm is required. Install Node.js or add
ghcr.io/devcontainers/features/node."` This is the baseline.

**What is missing:** Runtime dependency checks. wezterm-server installs successfully
even if `sshd` is not present, but SSH domain connections fail silently later. There is
no post-install validation that the feature's runtime environment is complete.

**Analysis dimensions:**
- *Spec compliance:* Fully compliant. Features are allowed to exit non-zero from
  `install.sh`. Error messages appear in container build logs.
- *User experience:* The user sees an error during `devcontainer up` and must parse
  the build log to find the actionable message. Not ideal, but functional.
- *Maintenance burden:* Low. Each feature owns its own guards. No shared infrastructure.
- *Portability:* Works everywhere -- any devcontainer implementation, with or without
  lace.

### Option 2: Self-Contained Features

Features bundle their own dependencies. For example, wezterm-server would install its
own `sshd` instead of relying on a separate sshd feature.

**Analysis dimensions:**
- *Spec compliance:* Fully compliant. A feature can install whatever it wants in
  `install.sh`.
- *User experience:* Good -- fewer moving parts for the user. Declare one feature,
  get everything it needs.
- *Maintenance burden:* High. Each feature becomes responsible for installing,
  configuring, and maintaining dependencies it did not author. wezterm-server would need
  to track sshd security updates, configuration changes, and cross-distro packaging. The
  sshd feature already handles this well; duplicating that logic is wasteful.
- *Portability:* Works everywhere. But leads to bloated features that duplicate
  functionality available in the standard feature ecosystem.

### Option 3: Lace-Level Dependency Declaration

Extend `customizations.lace` in `devcontainer-feature.json` to declare dependencies
that lace validates and auto-injects before calling `devcontainer up`.

**Sketch:**
```jsonc
{
  "customizations": {
    "lace": {
      "dependencies": {
        "features": {
          "ghcr.io/devcontainers/features/sshd:1": {}
        },
        "commands": ["curl", "dpkg"]
      }
    }
  }
}
```

When lace resolves features, it reads `customizations.lace.dependencies.features` and
ensures those features are present in the generated `.lace/devcontainer.json`. If the
user has not declared them, lace injects them. For `commands`, lace could warn but
cannot easily validate base image contents without building the image first.

**Analysis dimensions:**
- *Spec compliance:* Uses the `customizations` namespace, which is explicitly reserved
  for tool-specific extensions. Fully spec-compliant.
- *User experience:* Excellent for lace users. Dependencies are resolved automatically.
  Missing features are injected with a log message explaining why.
- *Maintenance burden:* Medium. Requires lace to understand feature metadata, fetch
  `devcontainer-feature.json` from OCI registries (which it already does for
  `customizations.lace.ports` and `customizations.lace.mounts`), and implement
  dependency injection logic.
- *Portability:* Lace-only. Users who use our features outside lace get no benefit.
  However, this can coexist with Option 1 (runtime guards) as a fallback.

### Option 4: Composite Features

Create wrapper features that install multiple sub-features. For example, a
`wezterm-ssh` feature that ensures both `wezterm-server` and `sshd` are installed
together.

**Analysis dimensions:**
- *Spec compliance:* Features can use `dependsOn` (now in the spec) to declare their
  sub-feature dependencies. The composite feature's `install.sh` could be a no-op if
  all work is done by dependencies. Alternatively, the composite feature could call
  `install.sh` scripts from its dependencies, but this breaks the feature isolation
  model.
- *User experience:* Good -- the user declares one feature and gets the stack. But it
  proliferates feature identifiers. Instead of `wezterm-server`, users must know to use
  `wezterm-ssh`. If they use the wrong one, they are back to the original problem.
- *Maintenance burden:* Medium. Each composite feature is thin (mostly a
  `dependsOn` declaration), but the number of features to publish and version doubles.
- *Portability:* Works with any implementation that supports `dependsOn`. As of the
  current spec, this is the standard mechanism.

### Option 5: Documentation-Only

Document prerequisites clearly in each feature's README and `devcontainer-feature.json`
description field. Trust users to read docs.

**Analysis dimensions:**
- *Spec compliance:* N/A -- no technical mechanism.
- *User experience:* Poor. Users discover missing prerequisites through opaque build
  failures or silent runtime breakage. The error message is "read the docs", which
  assumes users read docs.
- *Maintenance burden:* Lowest. Just write docs.
- *Portability:* Universal.

### Option 6: dependsOn (Spec-Level Hard Dependencies)

Use the `dependsOn` property that is now part of the devcontainer spec to declare
hard feature dependencies directly in `devcontainer-feature.json`.

**Sketch:**
```jsonc
{
  "id": "wezterm-server",
  "dependsOn": {
    "ghcr.io/devcontainers/features/sshd:1": {}
  },
  "installsAfter": [
    "ghcr.io/devcontainers/features/common-utils"
  ]
}
```

When the devcontainer CLI processes this, it automatically adds `sshd:1` to the
feature set if the user has not already declared it, resolves the dependency graph,
and installs `sshd` before `wezterm-server`.

**Analysis dimensions:**
- *Spec compliance:* This IS the spec mechanism. It is the canonical way to express
  feature-on-feature hard dependencies.
- *User experience:* Excellent. The user declares `wezterm-server` and `sshd` is
  pulled in automatically. Failures are reported by the CLI with clear dependency
  chain errors.
- *Maintenance burden:* Low. One line in `devcontainer-feature.json`. The CLI handles
  resolution, ordering, and error reporting.
- *Portability:* Works with the reference CLI (v0.44.0+) and VS Code. **DevPod does
  not implement `dependsOn`** -- [issue #1073](https://github.com/loft-sh/devpod/issues/1073)
  was stale-closed; [issue #1950](https://github.com/loft-sh/devpod/issues/1950) remains
  open. The official `devcontainers/features` collection uses `dependsOn` in zero of its
  30+ features, relying exclusively on `installsAfter` + self-contained `install.sh`.
  Adoption in the wild is near-zero (see research report).

**Limitations:** Only covers feature-on-feature dependencies. Cannot express "I need
`curl` in the base image" -- that remains an `install.sh` runtime guard concern.
DevPod users would silently miss auto-installed dependencies.

## Recommendations

### Short-Term (Do Now)

**Adopt Option 1 (hardened guards) immediately. Add Option 6 (`dependsOn`) alongside
`installsAfter` but understand the portability tradeoff.**

1. **Harden existing install.sh guards** as the primary safety layer. The `command -v`
   checks we already have are good. Add a **post-install validation** step to
   wezterm-server that checks for `sshd` presence and exits with a clear error if
   missing (e.g., "sshd not found -- add ghcr.io/devcontainers/features/sshd:1 to
   your devcontainer.json features"). This works everywhere, regardless of tool support.

2. **Add `dependsOn` to wezterm-server, claude-code, and portless** alongside the
   existing `installsAfter`. This is the spec-blessed mechanism and the reference CLI
   supports it. **Caveat:** DevPod silently ignores `dependsOn` (does not auto-install
   the dependency), and the official features collection has zero adoption of
   `dependsOn`. The `install.sh` guards from step 1 are the safety net for these cases.

3. **Add runtime dependency documentation** to each feature's README listing what is
   needed and why.

This layered approach provides defense in depth: `dependsOn` handles it automatically
where supported, `install.sh` guards catch it everywhere else.

### Medium-Term (If We Want Lace-Level Safety)

**Layer Option 3 on top for lace-managed orchestration.**

Once lace already fetches feature metadata (which it does for port and mount
resolution), extend the metadata reader to also parse `customizations.lace.dependencies`
and validate that the generated config satisfies all declared dependencies. This gives
lace users a pre-flight check before `devcontainer up` even starts, catching
misconfigurations earlier in the pipeline.

This is only valuable if we find that `dependsOn` alone is insufficient -- for example,
if we need to express dependencies on base image capabilities (commands, libraries) that
features cannot provide. For feature-on-feature dependencies, `dependsOn` should be
sufficient and lace should not duplicate the CLI's resolution logic.

### Upstream Contribution

**No spec proposal needed.** The `dependsOn` property already addresses the core
feature-on-feature dependency problem. The remaining gap -- "I need `curl` in the
base image" -- is inherently unsolvable at the feature spec level because features
cannot introspect or modify the base image. Runtime guards in `install.sh` are the
correct pattern for this, and the spec's best practices documentation already recommends
it.

If we discover patterns that `dependsOn` cannot express (e.g., "I need sshd to be
*running*, not just installed"), that would be worth raising as an issue on
`devcontainers/spec`. But this is a lifecycle concern (runtime vs. install-time), not a
dependency concern.

## Open Questions

1. **dependsOn CLI version requirement:** What is the minimum devcontainer CLI version
   that supports `dependsOn`? If users on older CLI versions encounter our features
   with `dependsOn` declarations, does the CLI ignore the unknown property gracefully,
   or does it error? This determines whether we can safely add `dependsOn` without
   breaking backwards compatibility.

2. **Feature version pinning in dependsOn:** When wezterm-server declares
   `"dependsOn": { "ghcr.io/devcontainers/features/sshd:1": {} }`, what happens when
   the user has `sshd:2` declared in their devcontainer.json? Does the CLI treat this
   as satisfied, or does it install both `sshd:1` and `sshd:2`? The version resolution
   semantics for `dependsOn` need testing.

3. **Runtime vs. install-time dependencies:** wezterm-server needs sshd *running* at
   container start, not just installed. `dependsOn` ensures sshd is installed, but does
   the sshd feature's entrypoint/lifecycle hooks guarantee it is running by the time
   wezterm-server's entrypoint runs? Feature entrypoint ordering may need investigation.

4. **Circular dependency risk:** If feature A depends on feature B and feature B
   depends on feature A (unlikely in practice but worth understanding), how does the
   CLI handle the cycle? The spec likely errors, but we should verify.

5. **OCI registry metadata for dependsOn:** Does lace's existing OCI metadata fetching
   pipeline already extract `dependsOn` from `devcontainer-feature.json`? If not, does
   it need to, or can we rely entirely on the CLI's resolution?

6. **npm/node as a base image capability vs. feature:** Many devcontainer base images
   include Node.js. For features that need `npm` (claude-code, portless), should
   `dependsOn` pull in the node feature unconditionally, or should install.sh check
   for `npm` first and only fail if absent? Installing the node feature on an image
   that already has node could cause conflicts or override the user's preferred version.

## Prior Art

- **Existing install.sh guards:** All four lace features already implement `command -v`
  prerequisite checks with actionable error messages. This is the baseline pattern.
- **devcontainers/spec Issue #16:** The original discussion on feature dependency
  management, which led to `installsAfter` (soft) and eventually `dependsOn` (hard).
- **devcontainers/spec Issue #43:** Feature installation order discussion, covering the
  ordering semantics of `installsAfter` and its limitations.
- **wezterm-server installsAfter:** Our wezterm-server feature already declares
  `installsAfter: ["ghcr.io/devcontainers/features/sshd"]`, demonstrating awareness of
  the dependency but using the weaker mechanism.
- **containers.dev feature authoring best practices:** Recommends checking for
  prerequisites in `install.sh` and providing clear error messages.
