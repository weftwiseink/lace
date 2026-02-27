---
review_of: cdocs/proposals/2026-02-26-portless-devcontainer-feature.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-26T14:00:00-06:00
last_edited:
  by: "@claude-opus-4-6"
  at: 2026-02-26T21:00:00-06:00
task_list: lace/portless
type: review
state: live
status: done
tags: [rereview_agent, architecture, test_plan, implementation_plan, handoff_readiness, round_4]
---

# Review (Round 4): Portless Devcontainer Feature for Worktree-Namespaced Local Domains

## Summary Assessment

This proposal packages portless as a prebuild devcontainer feature with lace-managed asymmetric port mapping, enabling worktree-namespaced `*.localhost` URLs for dev servers.
Round 4 resolves all blocking and non-blocking issues from round 3: the investigation report contradiction is fixed, `forwardPorts` is added to step 5 and Test 9, and Test 12 is sharpened with a concrete conflict simulation.
The newly expanded Implementation Plan (Phases 1-5 with detailed steps, pitfalls, and verification gates) transforms this from a design proposal into a handoff-ready implementation spec.
Verdict: **Accept.**

## Round 3 Resolution Verification

### Blocking Issue: Investigation Report Contradiction

**RESOLVED.**
The investigation report (`cdocs/reports/2026-02-26-lace-port-allocation-design-investigation.md`) has been rewritten.
The BLUF (lines 26-31) now correctly recommends the prebuild path with asymmetric injection.
An explicit correction note (lines 32-35) retracts the "architecturally wrong" conclusion and explains why the reasoning was flawed: wezterm-mux-server is also a runtime daemon using the prebuild path, so the build-time vs. runtime distinction was a false premise.
The "Portless as a Prebuild Feature with Asymmetric Mapping" section (lines 160-175) recommends the prebuild path.
The summary table (lines 212-223) shows both wezterm and portless using `customizations.lace.prebuildFeatures` with asymmetric injection.

Verified: the investigation report and proposal are now fully consistent.

### Non-Blocking Issue 1: `forwardPorts` in Step 5

**RESOLVED.**
Step 5 of "How Lace Wires It Up" (proposal line 205) now reads:
```
final `appPort: ["22435:1355"]` (asymmetric), `forwardPorts: [22435]`, `portsAttributes: { ... }`
```

This matches what `generatePortEntries()` at lines 810-814 of `template-resolver.ts` produces: `forwardPorts` is unconditionally generated for each allocation (unless the user already has a matching entry).

### Non-Blocking Issue 2: `forwardPorts` in Test 9

**RESOLVED.**
Test 9 (proposal lines 329-333) now verifies three outputs:
- `appPort` entry with asymmetric mapping
- `forwardPorts` entry for the host port
- `portsAttributes` with label "portless proxy (lace)"

This covers the full output of `generatePortEntries()` + `mergePortEntries()`.

### Non-Blocking Issue 3: Sharpen Test 12

**RESOLVED.**
Test 12 (proposal lines 343-348) now specifies a concrete scenario: allocate port N, simulate conflict by manually binding N on the host, run `lace up` again, verify new mapping `M:1355` in `.lace/devcontainer.json`, verify container works after restart with portless still on 1355 internally.
This is substantially more specific than round 3's vague "new asymmetric mapping without container rebuild."

## Section-by-Section Findings

### Implementation Plan (New in Round 4)

The Implementation Plan is the major addition in round 4, expanding from four brief phase descriptions into a detailed five-phase plan with step-by-step instructions, pitfalls, and verification gates.

**Phase 1: Feature Scaffold (lines 389-419)**

Well-structured.
Step 1 (copy from wezterm-server) is the right starting point; the diff between the two features is small enough that copy-and-adapt is efficient.
Step 3 (standalone verification without lace) is a good isolation gate.
Both pitfalls (npm unavailable, entrypoint blocking) are real and well-documented.
The verification gate (Tests 1-8) correctly covers install and entrypoint lifecycle.

**Phase 2: Lace Integration (lines 421-475)**

Four pitfalls, all verified against the codebase:

1. "Explicit option override skipping injection" (lines 456-459): Verified at `template-resolver.ts` lines 241-247. If the user provides `"proxyPort": "9999"`, the `if (optionName in featureOptions)` check causes the injection to be skipped. The pitfall correctly notes the user would need manual `appPort` entries. This is a real edge case worth documenting.

2. "Duplicate suppression" (lines 461-463): Verified at `template-resolver.ts` lines 802-808. `String("22435:1355").startsWith("22435:")` is `true`, so no duplicate symmetric entry is generated. Correct.

3. "Host DNS resolution" (lines 465-469): `*.localhost` resolves via nss-myhostname on systemd-based Linux and natively on macOS. The fallback via explicit Host header is correctly noted.

4. "Dotted service names" (lines 471-473): Practical verification step. Checking `~/.portless/routes.json` is the right approach to confirm route registration.

The verification gate (Tests 9-16) correctly covers integration and smoke tests.

**Phase 3: User-Facing Workflow Verification (lines 477-499)**

This is a strong addition.
The four scenarios (fresh setup, multi-worktree, service lifecycle, without lace) cover the most important user journeys.
The multi-worktree scenario (lines 483-491) is the core value proposition and is tested explicitly.
The service lifecycle test (lines 493-495) catches the important case where portless needs to de-register and re-register routes.
The "without lace" scenario (lines 497-499) verifies the feature works standalone, which is important for adoption outside the lace ecosystem.

**Phase 4: Documentation (lines 501-509)**

Reasonable scope.
The checklist covers the key topics (feature setup, naming, URL patterns, troubleshooting).

**Phase 5: GHCR Publish (lines 511-519)**

The caution about portless being new (created 2026-02-15) is well-placed.
The four-step process (pin version, test, publish, update examples) is sound.

**Non-blocking observation:** Phase 5 does not reference the existing wezterm-server publish devlog (`cdocs/devlogs/2026-02-10-publish-wezterm-server-feature-to-ghcr.md`), which documents the actual GHCR publish process and any gotchas encountered.
An implementor would benefit from a cross-reference here.

### Feature Specification

No changes from round 3; remains correct.
The `devcontainer-feature.json` mirrors the wezterm-server pattern with appropriate adaptations.
`install.sh` is clean: install via npm, generate entrypoint, no port plumbing.

### How Lace Wires It Up

The seven-step pipeline description is now complete and accurate with the `forwardPorts` addition.
Each step maps directly to a verifiable code path in `template-resolver.ts` and `up.ts`.

### Test Plan

18 tests across five categories.
All round 3 gaps are addressed.
Coverage is thorough for a feature of this scope.

**Non-blocking observation on Test 12:** The test specifies verifying that "the existing container still works after restart (portless still on 1355 internally; Docker remaps to M)."
The round 3 review suggested verifying via `docker port <container>`.
Including this specific command in the test description would make it more immediately actionable, but the current description is adequate for an implementor familiar with Docker.

### Known Limitations

No changes from round 3; all three limitations remain accurate.
The architectural pivot to asymmetric mapping means limitation 3 (host port changes) is now about bookmark stability rather than operational disruption (no rebuild needed).

## Consistency Check: Proposal vs. Investigation Report

Spot-checked five claims across both documents:

| Claim | Proposal | Investigation Report | Consistent? |
|-------|----------|---------------------|-------------|
| Injection path | prebuildFeatures, asymmetric | prebuildFeatures, asymmetric (line 162) | Yes |
| Container port | Always 1355 | Always 1355 (line 168, 218) | Yes |
| install.sh reads port option | No | No (line 167, 217) | Yes |
| Env var baking | None | None (line 168) | Yes |
| Port reassignment | Docker mapping only | Docker mapping only (line 221) | Yes |

No contradictions remain.

## Missing Pitfalls Assessment

The proposal's pitfall coverage is comprehensive for the implementation scope.
Two additional considerations that are not critical but may be useful:

1. **Container-internal port 1355 conflict:** If another process inside the container binds port 1355 before the entrypoint runs, portless proxy fails to start.
   The entrypoint handles this via `|| true`, which suppresses the error but also means the failure is silent.
   This is already partially covered by Test 8 ("Port already bound"), but that test focuses on graceful handling rather than detection.
   An implementor should consider whether a logged warning (instead of silent suppression) would be more appropriate.
   Non-blocking: the `|| true` pattern matches wezterm-server's behavior.

2. **Portless upstream stability:** The proposal correctly notes portless was created 2026-02-15 and recommends version pinning in Phase 5.
   If portless changes its default port, CLI interface, or route file location in a future release, the feature would break.
   Phase 5's version pinning mitigates this, but the install.sh has no version verification beyond `portless --version || true`.
   Non-blocking: this is standard practice for features depending on external tools.

## Verdict

**Accept.**

The proposal is implementation-ready.
All round 3 blocking and non-blocking issues are resolved.
The investigation report is consistent with the proposal.
The expanded Implementation Plan provides sufficient detail for handoff: step-by-step instructions, pitfalls with detection strategies, and verification gates mapping to specific test numbers.
The test plan covers install, entrypoint lifecycle, lace integration, smoke, and manual verification.
The architecture is verified against the source code (`template-resolver.ts` lines 224-267, 781-833).

Two non-blocking observations are noted for implementor consideration but do not gate acceptance.

## Action Items

1. [non-blocking] Consider adding a cross-reference to `cdocs/devlogs/2026-02-10-publish-wezterm-server-feature-to-ghcr.md` in Phase 5 so the implementor can reference the prior GHCR publish process and any gotchas.
2. [non-blocking] Consider adding `docker port <container>` as the specific verification command in Test 12 for immediate actionability.
