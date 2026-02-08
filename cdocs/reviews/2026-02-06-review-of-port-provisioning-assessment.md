---
review_of: cdocs/reports/2026-02-06-port-provisioning-assessment.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T14:30:00-08:00
task_list: lace/feature-overhaul
type: review
state: archived
status: done
tags: [fresh_agent, devcontainer-spec, ports, spec-research, architecture]
round: 1
---

# Review: Port Provisioning Assessment

## Summary Assessment

The report's central claim -- that dynamic host-port assignment is a genuine gap in the devcontainer spec -- is correct. Independent research confirms that `forwardPorts` accepts only literal port numbers and `"host:port"` strings, not ranges. The feature request for range syntax (microsoft/vscode-remote-release#3898) was closed in 2020 without implementation. However, the report has three significant issues: (1) it conflates `portsAttributes` range matching (which exists for attribute application) with `forwardPorts` range resolution (which does not exist), creating a gap in the analysis that invited the user's incorrect premise; (2) it fails to mention that the devcontainer CLI does not implement `forwardPorts` at all, which materially changes the `appPort` vs `forwardPorts` recommendation; and (3) its recommendation to "migrate from `appPort` to `forwardPorts`" is actively wrong for lace's use case. Verdict: **Revise**.

## Challenging the User's Premise

The user's premise was: "forwardPorts can accept a range, which would be resolved at container runtime into a single port, and that many/all devcontainer features needing ports likely make use of this."

This premise conflates two distinct mechanisms in the devcontainer spec:

1. **`forwardPorts`** accepts only `integer` (0-65535) or `string` matching `^([a-z0-9-]+):(\d{1,5})$`. No range syntax. No "find available" semantic. The JSON schema at containers.dev/implementors/json_schema/ confirms this. A 2020 feature request for range notation (`[30000-65535]`, `[30000:]`, `[*]`) was closed without implementation due to insufficient community votes.

2. **`portsAttributes`** DOES accept range patterns via `patternProperties` matching `(^\d+(-\d+)?$)|(.+)` -- e.g., `"40000-55000": { "onAutoForward": "ignore" }`. But this applies display/behavior attributes to ports that are already forwarded or auto-detected. It does not allocate or forward ports.

3. **Features cannot declare port needs in their metadata.** The `devcontainer-feature.json` schema supports `containerEnv`, `mounts`, `capAdd`, `privileged`, `init`, lifecycle hooks, and `customizations` -- but NOT `forwardPorts`, `portsAttributes`, or any port-related fields. The official `sshd` feature (devcontainers/features) simply tells users to add `forwardPorts: [2222]` to their `devcontainer.json` manually. There is no automatic "port discovery" by features.

4. **VS Code auto-port-forwarding** detects processes listening on ports inside the container at runtime (controlled by `remote.autoForwardPortsSource`). This is runtime detection by the IDE, not a spec-level allocation mechanism, and it requires the container to already be running.

The user's premise is therefore incorrect: `forwardPorts` cannot accept ranges, features do not use a range-based port mechanism, and the spec provides no dynamic port allocation primitive. The report's finding on this point is sound.

## Section-by-Section Findings

### BLUF

**[blocking] The BLUF recommends migrating from `appPort` to `forwardPorts`, but this is wrong for lace's runtime.** The BLUF states lace should "migrate from deprecated `appPort` to `forwardPorts`." However, the devcontainer CLI (`devcontainer up`, which lace invokes) does NOT implement `forwardPorts`. This is confirmed by devcontainers/cli#22 (still open) and two independent third-party projects (devcontainer-cli-forward-ports, devcontainer-cli-port-forwarder) that exist solely to work around this gap using `socat`.

`forwardPorts` is a VS Code / Codespaces-level feature that creates tunnels through the tooling's internal communication channel. It does not create Docker-level port bindings. Since lace uses the devcontainer CLI (not VS Code), `forwardPorts` entries in the generated config are silently ignored. Only `appPort` creates the Docker-level `-p hostPort:containerPort` binding that makes ports accessible via direct TCP on the host.

This means the report's recommendation #3 ("Migrate from `appPort` to `forwardPorts`") would actually break port access for all lace users. The BLUF must be corrected to recommend keeping `appPort`.

### Key Findings

**[blocking] Finding #1 ("`forwardPorts` is static-only") is correct but incomplete.** The finding says `forwardPorts` has "no expression syntax, range notation, or 'find available' semantic." This is accurate. But it omits the more fundamental issue: `forwardPorts` is not implemented by the devcontainer CLI at all. For lace's use case, the question is not "can `forwardPorts` do dynamic assignment?" but "does `forwardPorts` do anything at all?" The answer is no.

**[non-blocking] Finding #3 (`requireLocalPort`) could note its runtime.** `requireLocalPort: true` is also a tooling-level property that depends on the implementing runtime. Its behavior with the devcontainer CLI vs VS Code may differ. Worth a parenthetical note.

**[non-blocking] Finding #5 (Docker ephemeral ports) is accurate and well-analyzed.**

**[non-blocking] Finding #6 (post-start discovery) is accurate.** The point about lace.wezterm needing the port before container start is correct and well-stated.

### Spec Alternatives Analysis

**[non-blocking] Alternative A analysis is accurate.** Static `forwardPorts` per project does require manual coordination.

**[non-blocking] Alternative B analysis is accurate** but should note that `requireLocalPort` may not function in the devcontainer CLI runtime.

**[non-blocking] Alternative C analysis is accurate.** Docker ephemeral ports are fundamentally incompatible with stable SSH domain registration.

**[non-blocking] Alternative D analysis is accurate.** Post-start discovery cannot satisfy the pre-start port knowledge requirement.

**[non-blocking] Missing Alternative E: VS Code auto-port-forwarding.** The report does not analyze the VS Code/IDE-level auto-port-detection mechanism (`onAutoForward`, `remote.autoForwardPortsSource`). While this is a tooling-level feature that does not apply to lace (which uses the devcontainer CLI), including it would have preempted the user's confusion about "runtime resolution." A brief note dismissing it for the same reason -- it is IDE-level, not CLI-level -- would strengthen the analysis.

### Current Implementation Critique

**[non-blocking] Point #2 ("Uses deprecated `appPort`") frames `appPort` as a problem, but it is actually the correct choice.** The critique says lace should migrate to `forwardPorts` for spec compliance. Given that `forwardPorts` is not implemented by the devcontainer CLI, `appPort` is the only mechanism that actually works. The critique should instead note that while `appPort` is spec-deprecated, it is the only option that provides Docker-level port binding, which the devcontainer CLI depends on. The deprecation is cosmetic -- the spec recommends `forwardPorts` because VS Code is the primary consumer, but the devcontainer CLI has not caught up.

### `lace.port(label)` Design Sketch

**[blocking] The design sketch's "Generated config output" section uses `forwardPorts`, which does not work with the devcontainer CLI.** The example at lines 150-162 shows:
```jsonc
{
  "forwardPorts": [22430, 22431],
  "portsAttributes": { ... }
}
```
This must be corrected to use `appPort` with `hostPort:containerPort` mapping. The `portsAttributes` section can remain (it is harmless even if unused by the CLI, and will be picked up if VS Code ever attaches to the same container).

**[non-blocking] The design sketch's label-based system is sound.** The `${lace.port(label)}` concept, persistence in `.lace/port-assignments.json`, and configurable range are all well-designed regardless of the `forwardPorts` vs `appPort` correction.

### Recommendations

**[blocking] Recommendation #3 is wrong.** "Migrate from `appPort` to `forwardPorts` + `portsAttributes`" should be "Keep `appPort` for Docker-level port binding, add `portsAttributes` for labeling." The `portsAttributes` addition is a good idea (it benefits VS Code users who attach to lace-managed containers), but `forwardPorts` must not replace `appPort`.

**[non-blocking] Recommendation #6 (`requireLocalPort: true` as safety net) is reasonable** but should note it depends on the implementing runtime honoring it. The devcontainer CLI may not enforce this property.

## Verdict

**Revise.** The report's central finding (dynamic port assignment is a spec gap) is correct, but three blocking issues must be addressed:

1. The report recommends migrating from `appPort` to `forwardPorts` without noting that the devcontainer CLI does not implement `forwardPorts`. This recommendation would break lace's port access.
2. The "Generated config output" section uses `forwardPorts` instead of `appPort`.
3. The analysis does not mention the devcontainer CLI's non-implementation of `forwardPorts`, which is critical context for understanding why `appPort` remains necessary.

## Action Items

1. [blocking] Correct recommendation #3: keep `appPort` for Docker-level port binding, add `portsAttributes` for labeling. Note that `forwardPorts` is not implemented by the devcontainer CLI.
2. [blocking] Update the "Generated config output" section to use `appPort: ["22430:2222", "22431:8080"]` instead of `forwardPorts`.
3. [blocking] Add a key finding about `forwardPorts` not being implemented by the devcontainer CLI (devcontainers/cli#22), and explain that `forwardPorts` is a VS Code/tooling-level tunnel, not a Docker-level port binding.
4. [non-blocking] Add a brief analysis of VS Code auto-port-forwarding (Alternative E) to preempt confusion about IDE-level "runtime port resolution."
5. [non-blocking] Reframe the `appPort` deprecation in the implementation critique: `appPort` is spec-deprecated but functionally necessary for devcontainer CLI users.
6. [non-blocking] Note that `requireLocalPort` and `portsAttributes` behavior may vary across implementing runtimes (VS Code vs devcontainer CLI).
