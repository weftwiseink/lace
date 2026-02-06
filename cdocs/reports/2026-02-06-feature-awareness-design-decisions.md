---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T20:00:00-08:00
task_list: lace/feature-overhaul
type: report
state: live
status: review_ready
tags: [design-decisions, architecture, features, templating, ports, devcontainer-spec]
revisions:
  - at: 2026-02-06T23:30:00-08:00
    by: "@claude-opus-4-6"
    summary: >
      Added D12 (auto-injection design) and updated D7 to align with
      auto-injection: metadata is now required for auto-injection, not
      best-effort. Without metadata (--skip-metadata-validation), auto-injection
      does not occur. Updated examples to show minimal user config.
  - at: 2026-02-06T22:00:00-08:00
    by: "@claude-opus-4-6"
    summary: >
      Updated to reflect proposal revision: removed references to eliminated
      lace.* template variables (lace.home, lace.containerUser, etc.); limited
      portsAttributes scope to requireLocalPort and label only; removed D9
      (flat namespace discussion no longer relevant with single template
      variable); updated examples throughout.
references:
  - cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
  - cdocs/reports/2026-02-06-port-provisioning-assessment.md
  - cdocs/reports/2026-02-05-plugin-architecture-devcontainer-features-analysis.md
  - cdocs/reports/2026-02-06-feature-manifest-fetching-options.md
---

# Feature Awareness Design Decisions

> **BLUF:** This report documents the rationale behind key design decisions in the Lace Feature Awareness v2 proposal. The proposal itself states decisions concisely; this report provides the full analysis, alternatives considered, and tradeoffs for each.

## D1: Symmetric port model -- `${lace.port(featureId/optionName)}` allocates a single port used on both host and container sides

**Decision:** When lace allocates a port, the same port number is used for the Docker host mapping and the container listener. For example, if `${lace.port(wezterm-server/sshPort)}` allocates 22430, Docker maps `22430:22430` and the feature listens on 22430 inside the container.

**Alternatives considered:**

1. **Asymmetric mapping with explicit containerPort:** `${lace.port(label, 2222)}` would allocate a host port and pair it with a fixed container port. This was the R1 design. It required tracking two port numbers per label, made the override story more complex (which side are you overriding?), and added a parameter to every `lace.port()` call.

2. **Docker ephemeral ports (`0:containerPort`):** Let Docker pick the host port. Rejected because the port changes every restart, breaking wezterm domain configs and SSH aliases that need stable ports. See [port provisioning assessment](./2026-02-06-port-provisioning-assessment.md), Alternative C.

**Why symmetric works:** Lace's default port range (22425-22499) does not collide with any standard service port inside containers. No common base image (Ubuntu, Debian, Alpine, Node, Python) runs services on ports in this range. The feature receives a port option value and listens on it -- it does not care whether the value is 2222 or 22430. Symmetric mapping eliminates the complexity of tracking two port numbers and makes the override story trivial: if you want asymmetric, write your own `appPort` entry.

**Risk:** Custom or enterprise images that happen to bind to ports in 22425-22499 would conflict. Mitigation: the port allocator checks availability via TCP scan before assignment, and a future `portRange` override can relocate the range.

## D2: Template resolution across the entire devcontainer.json

**Decision:** `${lace.port()}` expressions can appear in any string value anywhere in the devcontainer.json, not just inside a lace-specific section. Resolution applies to all string values but not object keys.

**Alternatives considered:**

1. **Resolution only in `customizations.lace.features`:** The original design restricted templates to feature option values. This prevented useful patterns like `"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]` for asymmetric overrides.

2. **Resolution only in `customizations.lace.*`:** Broader than option 1 but still prevents templates in standard devcontainer.json fields.

**Why global scope:** Consistent with how `${localEnv:}` works in the devcontainer spec -- it can appear anywhere. Lace processes the entire config before writing `.lace/devcontainer.json`, so resolution timing is unambiguous. Unknown `${lace.*}` expressions hard-fail, preventing silent misconfiguration. Spec-native expressions (`${localEnv:}`, `${containerEnv:}`) pass through unchanged for later resolution by the devcontainer CLI.

## D3: No separate `customizations.lace.features` section -- features declared in standard `features` field

**Decision:** Features that need lace template resolution are declared in the standard top-level `features` field of devcontainer.json, just like any other feature. Lace resolves `${lace.port()}` templates in their option values in-place. There is no separate "lace features" declaration surface and no "feature promotion" pipeline.

**Alternatives considered:**

1. **`customizations.lace.features` with promotion:** Features needing lace templates would be declared in `customizations.lace.features`, undergo template resolution, then be "promoted" into the top-level `features` field of the extended config. This was the v1 design. Problems: (a) confusion with the existing `prebuildFeatures` system, which also moves features between sections; (b) users had to decide which section to put each feature in; (c) the overlap detection between `customizations.lace.features` and `features` added error surface; (d) features were in a non-standard location, making the devcontainer.json less portable.

**Why direct resolution:** Simpler mental model -- features go where features go. Lace is a preprocessor that auto-injects port templates (from feature metadata) and resolves them before passing the config downstream. The user's devcontainer.json looks completely standard -- no lace-specific syntax is needed. If the user writes `${lace.port()}` explicitly, it works the same as auto-injection. This also eliminates the overlap detection problem entirely.

## D4: Port labels auto-namespaced as `featureId/optionName`

**Decision:** The label in `${lace.port(featureId/optionName)}` is composed of the feature's short ID and the option name from the feature's schema. For example, `${lace.port(wezterm-server/sshPort)}`. Lace validates that `sshPort` exists in the wezterm-server feature's option schema (via feature metadata).

**Alternatives considered:**

1. **User-chosen arbitrary labels:** `${lace.port(ssh)}` with a separate mapping from label to feature option. This was the v1 design. Problems: (a) the label was disconnected from the feature's actual option name, requiring the user to mentally map between them; (b) no automatic validation that the label targets a real option; (c) a feature could have a `"port"` option for separate purposes, and a `"port"` label in the mapping, and it is unclear which maps to which.

2. **Feature ID only:** `${lace.port(wezterm-server)}` with implicit option detection. This fails when a feature has multiple port options (e.g., `sshPort` and `httpPort`).

**Why `featureId/optionName`:** The label is a 1:1 mapping to the feature's input. The feature ID disambiguates between features; the option name disambiguates between ports within a feature. Lace can validate the option name against the feature's schema. Feature authors are guided to use descriptive option names (`sshPort`, `httpPort`) rather than generic ones (`port`), because the option name appears in the template expression and serves as documentation.

## D5: Features declare port attributes via `customizations.lace.ports` in their `devcontainer-feature.json`

**Decision:** Features declare their port semantics (display label, local port requirement) in `customizations.lace.ports` within their own `devcontainer-feature.json`. The key in this object matches the option name (e.g., `sshPort`). Lace reads this via feature metadata fetching (required by default; see D7). Only `label` and `requireLocalPort` are supported attributes.

**Alternatives considered:**

1. **Port attributes in user's devcontainer.json:** Users would declare port attributes in `customizations.lace.ports`. This duplicates the feature's own knowledge about its ports and increases the user's configuration burden.

2. **No port attributes -- bare `appPort` only:** Simpler but loses labeling and `requireLocalPort` safety. VS Code users would see unlabeled ports.

3. **Full portsAttributes support (onAutoForward, protocol, elevateIfNeeded, etc.):** More comprehensive but adds complexity with minimal benefit for the initial use case. Users who need these attributes can add them in their own `portsAttributes` entries.

**Why feature-level declaration with limited scope:** Features know their own port semantics. The `customizations` field in `devcontainer-feature.json` is the spec-sanctioned extensibility point. This keeps feature-specific knowledge in the feature. Declaring ports here serves a dual purpose: (1) it triggers auto-injection of `${lace.port()}` templates so users don't need to write them (see D12), and (2) it provides port attributes for `portsAttributes` generation. Limiting to `label` and `requireLocalPort` keeps the initial implementation simple while covering the primary needs (human-readable identification and port stability). Users override port behavior through standard devcontainer.json fields (`appPort`, `forwardPorts`, `portsAttributes`), not through a lace-specific section.

## D6: Lace auto-generates `appPort` + `forwardPorts` + `portsAttributes`

**Decision:** For every port allocated via `${lace.port()}`, lace automatically generates entries in all three devcontainer port fields.

**Why all three:**

- **`appPort`** is required because the devcontainer CLI does not implement `forwardPorts` ([devcontainers/cli#22](https://github.com/devcontainers/cli/issues/22)). `appPort` creates Docker-level `-p` bindings. Without it, container ports are not accessible from the host.
- **`forwardPorts`** is included for VS Code / Codespaces. When VS Code attaches to a container, it recognizes `forwardPorts` entries as intentionally forwarded. The devcontainer CLI silently ignores this field. Cosmetic quirk: VS Code may show duplicate entries from both `appPort` detection and `forwardPorts` declaration.
- **`portsAttributes`** provides labeling (`label`) and safety (`requireLocalPort: true` to fail fast if the port is grabbed between allocation and container start). Only `label` and `requireLocalPort` are auto-generated. Other attributes (e.g., `onAutoForward`, `protocol`) can be added by the user in their own `portsAttributes` entries if needed.

**Override mechanism:** After template resolution, lace scans the resolved config for user-provided entries referencing allocated port numbers. For any port already covered by a user entry, lace skips auto-generating that field entry. This is a post-resolution scan on concrete values (e.g., checking if `appPort` contains `"22430:..."` for allocated port 22430), not provenance tracking.

## D7: Metadata fetching is required (with `--skip-metadata-validation` escape hatch)

**Decision:** `lace up` requires feature metadata by default. If metadata fetching fails (offline, private registry, CLI error), `lace up` aborts with a clear error. The `--skip-metadata-validation` flag is the only escape hatch.

**Why required, not best-effort:** Metadata is essential for auto-injection (see D12). Without metadata, lace cannot know which feature options should receive auto-injected `${lace.port()}` templates. If the build environment cannot fetch metadata, it likely cannot pull the feature layer either -- failing early gives a clearer error. The [feature metadata management proposal](../proposals/2026-02-06-lace-feature-metadata-management.md) details the error semantics.

**What degrades with `--skip-metadata-validation`:**
- Auto-injection does not occur -- the user must explicitly write `${lace.port()}` templates or provide static values for port options.
- Port attributes default to `"<featureId/optionName> (lace)"` for the label and `true` for `requireLocalPort` (instead of feature-declared values).
- Option name validation is skipped -- lace cannot verify that the option name in `${lace.port(featureId/optionName)}` actually exists in the feature's schema.

**The escape hatch exists for:** Offline development with an empty cache, emergency deployments when a registry is temporarily down, CI environments that pre-populate containers but do not need metadata validation.

## D8: Prebuild feature extraction happens before template resolution

**Decision:** In the `lace up` pipeline, prebuild features are extracted from the original devcontainer.json first, using their declared default option values. Template resolution then processes a separate copy of the config to produce the extended config for `devcontainer up`, replacing `${lace.port()}` expressions with concrete per-instance values.

**Why this ordering:** Prebuild features are baked into cached images with their default option values. Template resolution produces per-instance values (like dynamically allocated ports) that should not be baked into a shared image. The prebuild image should use the feature's default port (e.g., 2222); the runtime config overrides it with the lace-allocated port (e.g., 22430). If template resolution happened first, prebuild extraction would see instance-specific values, defeating the caching benefit.

**Clarification:** These are separate code paths operating on different copies of the config. The prebuild system works on the original declarations. Template resolution operates on its own copy to produce the extended config that goes to `devcontainer up`.

## D9: `${lace.port()}` as the sole template variable

**Decision:** The only supported template expression is `${lace.port(featureId/optionName)}`. No host-path variables (`lace.home`, `lace.workspaceFolder`), no container variables (`lace.containerUser`, `lace.containerHome`), and no metadata variables (`lace.projectId`) are provided.

**Alternatives considered:**

1. **Full variable set (lace.home, lace.containerUser, lace.containerHome, lace.containerWorkspaceFolder, lace.projectId, lace.workspaceFolder):** The v2 draft included these. Removed because: (a) no concrete use case requires them in the initial implementation; (b) `${localEnv:HOME}` already provides host home directory via the devcontainer spec; (c) container-side values are best handled by the feature's own `install.sh` using `_REMOTE_USER` and `_REMOTE_USER_HOME`; (d) adding variables is easy later, removing them is hard.

**Why single variable:** Port allocation is the one capability that genuinely requires lace involvement -- the devcontainer spec has no equivalent. Host paths and container metadata can be obtained through existing spec mechanisms. Starting with a minimal surface area reduces implementation complexity and avoids premature API commitments. Future variables can be added as concrete needs arise.

## D10: Port assignments persisted in `.lace/port-assignments.json`

**Decision:** Port label-to-number mappings are stored in a dedicated file, separate from `.lace/devcontainer.json`.

**Why separate:** The current implementation stores port assignments inside the generated config via `appPort`. Clearing or regenerating the config loses the port assignment, requiring a rescan and potentially assigning a different port. A dedicated file makes port stability independent of the config lifecycle. The file format is simple: `{ "assignments": { "wezterm-server/sshPort": { "label": "...", "port": 22430, "assignedAt": "..." } } }`.

## D11: Type coercion for `${lace.port()}`

**Decision:** `${lace.port(featureId/optionName)}` resolves to an integer when the template is the entire string value, and to a string when embedded in a larger expression.

**Examples:**
- `"sshPort": "${lace.port(wezterm-server/sshPort)}"` resolves to `"sshPort": 22430` (integer)
- `"forwardPorts": ["${lace.port(wezterm-server/sshPort)}"]` resolves to `"forwardPorts": [22430]` (integer, because the template is the entire array element string)
- `"appPort": ["${lace.port(wezterm-server/sshPort)}:2222"]` resolves to `"appPort": ["22430:2222"]` (string, because the template is embedded)

**Why:** `forwardPorts` expects integers. Feature options are typed as strings but often parsed as numbers. The coercion rule is simple and matches user intent: if you wrote only the template expression, you probably want the number; if you embedded it in a string, you want a string.

## D12: Auto-injection of `${lace.port()}` templates from feature metadata

**Decision:** When a feature declares port options in `customizations.lace.ports` in its `devcontainer-feature.json`, lace auto-injects `${lace.port(featureId/optionName)}` as the option value for each declared port option that the user has not explicitly set. Auto-injection happens after metadata fetch but before template resolution. The user's devcontainer.json only needs to declare the feature -- no explicit port template is required.

**Alternatives considered:**

1. **User explicitly writes `${lace.port()}` for every port option:** The pre-D12 design required this. Problems: (a) the user had to know which options are port options and write the template expression with the correct `featureId/optionName` label for each; (b) this is boilerplate that the feature's metadata already knows; (c) it looks self-referential and confusing (the option `sshPort` is set to a template referencing `wezterm-server/sshPort`); (d) every new port-aware feature requires the user to learn the template syntax.

2. **Feature metadata declares ports but user still writes templates:** A hybrid where metadata provides validation and attribute enrichment but does not trigger auto-injection. This reduces the metadata's value -- if lace knows which options are ports (from metadata), it should be able to fill in the templates automatically.

**Why auto-injection:** The feature's `customizations.lace.ports` metadata already identifies which options are lace-managed ports. Requiring the user to re-state this information as a template expression is redundant. Auto-injection makes the zero-config case work: declare the feature, get dynamic port allocation. Users who want a specific port can override with a static value. Users who want to be explicit can write the template manually (same effect). The override story is simple: any user-provided value (static or template) prevents auto-injection for that option.

**Dependency:** Auto-injection requires feature metadata. Without metadata (when `--skip-metadata-validation` is set), auto-injection does not occur. This is acceptable: the escape hatch is for degraded-mode operation where users are expected to be more explicit.
