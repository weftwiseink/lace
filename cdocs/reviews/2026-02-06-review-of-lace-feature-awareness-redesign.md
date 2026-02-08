---
review_of: cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T11:30:00-08:00
task_list: lace/feature-overhaul
type: review
state: archived
status: done
tags: [rereview_agent, architecture, symmetric-ports, template-scope, override-semantics, spec-compliance]
rounds:
  - round: 1
    at: 2026-02-06T11:30:00-08:00
    by: "@claude-opus-4-6"
    verdict: revise
    summary: "Three blocking issues: missing containerPort dimension, unresolved appPort vs forwardPorts, breaking change from removing unconditional port assignment"
  - round: 2
    at: 2026-02-06T12:00:00-08:00
    by: "@claude-opus-4-6"
    verdict: accept
    summary: "All three blocking issues resolved: lace.port(label, containerPort) with explicit container port, appPort kept with portsAttributes for labeling, backwards-compatibility bridge added"
  - round: 3
    at: 2026-02-06T18:30:00-08:00
    by: "@claude-opus-4-6"
    verdict: revise
    summary: "Major rewrite reviewed. Symmetric port model is a significant simplification. One blocking issue: appPort suppression detection mechanism unspecified. Non-blocking suggestions on resolution ordering, type coercion, and edge case clarification. All issues resolved in post-review revision."
---

# Review: Lace Feature Awareness Redesign (Round 3)

## Summary Assessment

This is a substantial rewrite of the proposal driven by a design evolution toward symmetric ports and global template resolution. The symmetric port model (`${lace.port(label)}` as a pure allocator, same port on both sides) is a meaningful simplification over the previous `${lace.port(label, containerPort)}` design -- it eliminates a dimension of complexity and makes the override story cleaner. The widened template resolution scope (entire devcontainer.json) is well-justified and consistent with how `${localEnv:}` works in the spec. The proposal is thorough, with clear examples, a well-structured override story, comprehensive edge cases, and a detailed test plan. One blocking issue requires clarification: the mechanism for detecting user-provided `appPort` entries that should suppress auto-generation. Verdict: **Revise** (minor -- single blocking item is a clarification, not a redesign).

## Prior Review Status

All three R1 blocking issues have been resolved by this rewrite (not just addressed -- the design has evolved past them):

1. **containerPort dimension** -- eliminated entirely by the symmetric port model. No longer needed.
2. **appPort vs forwardPorts** -- decisively resolved. `appPort` is the primary mechanism; `forwardPorts` is included as a harmless supplement for VS Code. The three-field auto-generation is well-reasoned.
3. **Backwards-compatibility bridge** -- still present, unchanged from R2. Correctly handles the transition.

All R1/R2 non-blocking items (containerUser best-effort, `${lace.env()}` future extension, Phase 3 independence, legacy migration test) are addressed in this rewrite.

## Section-by-Section Findings

### BLUF

The BLUF is comprehensive and accurately reflects the new design. It covers the two pillars (template resolver + lace features), the symmetric port model, the feature-level `customizations.lace.ports`, and the user override story. It is long (one paragraph, ~7 lines) but the density is justified given the scope of the redesign.

No issues.

### Symmetric Port Model

The new dedicated section (lines 158-169) is the core design contribution. The reasoning is sound: lace's range (22425-22499) does not collide with standard services, so symmetric mapping is safe. The walkthrough (allocate 22430, feature listens on 22430, Docker maps 22430:22430, host connects to localhost:22430) is clear.

**[non-blocking] The claim "no container service defaults to ports in this range" deserves a brief caveat.** While true for standard images, custom or enterprise images could theoretically bind to ports in this range. The proposal should note that `portRange` customization is the escape hatch for such environments, and that port availability is checked via TCP scan before allocation (the allocator will skip ports that are already in use). This is already implicit in the port allocator design but worth stating explicitly for the symmetric model's safety argument.

### Feature-level `customizations.lace.ports`

The separation is clean: features declare port preferences in their own `devcontainer-feature.json`, users never see this in their config. The example (lines 111-133) showing the wezterm-server feature's `devcontainer-feature.json` with both `options.port` and `customizations.lace.ports.ssh` is helpful.

**[non-blocking] The relationship between the label in `customizations.lace.ports` and the label in `${lace.port(label)}` is implicit.** The proposal shows `customizations.lace.ports.ssh` and `${lace.port(ssh)}` using the same label `ssh`, but does not explicitly state that lace matches them by label identity. This is clear from context but could be made explicit in one sentence.

### Template Resolution Scope

The widened scope is well-justified (lines 156, 273-275). The consistency argument with `${localEnv:}` is strong. The proposal correctly notes that unknown `${lace.*}` expressions still error.

**[non-blocking] Consider the ordering implications of whole-config resolution.** Template resolution happens before feature extraction (line 175: "resolve templates (entire config) -> extract lace features"). This means `${lace.*}` in `customizations.lace.features` option values are resolved before those features are extracted and promoted. This is correct and desirable. But it also means `${lace.*}` in the user's top-level `appPort` or `portsAttributes` is resolved in the same pass, before auto-generated port entries are merged. The proposal should confirm that the resolution pass and the auto-generation pass are separate steps (resolve first, then generate port entries), so that user entries with resolved `${lace.port()}` values can be compared against auto-generated entries for suppression.

### Override Story

The override table (lines 230-235) and the asymmetric mapping example (lines 237-255) are clear and practical. The design principle -- users override via standard devcontainer.json fields -- keeps lace's surface minimal.

**[blocking] The mechanism for detecting user-provided `appPort` entries that suppress auto-generation needs clarification.** The proposal states (line 339): "When a user writes `"appPort": ["${lace.port(ssh)}:2222"]`, lace detects that the user has provided their own `appPort` entry for this port and does not auto-generate a symmetric one." But how does lace detect this?

After template resolution, `"${lace.port(ssh)}:2222"` becomes `"22430:2222"`. The auto-generator sees port label `ssh` was allocated to `22430` and would normally generate `"22430:22430"`. It needs to check whether the resolved config already contains an `appPort` entry with `22430` on the host side. This is a string-parsing operation on `appPort` entries (splitting on `:` to extract the host port).

The proposal should specify this detection mechanism. The simplest approach: after resolution, scan the config's existing `appPort` entries for any that reference an allocated port number on the host side. If found, skip auto-generating `appPort` for that label. Same logic for `forwardPorts` and `portsAttributes`. This is implementable but the proposal should state it explicitly, because the alternative interpretation -- that lace tracks which config locations contained `${lace.port()}` and uses provenance to decide -- is different and more complex.

### Auto-generated Port Output

The three-field generation (`appPort`, `forwardPorts`, `portsAttributes`) is well-reasoned. The rationale for each field (lines 216-223) is clear.

**[non-blocking] The `forwardPorts` auto-generation may cause a minor UX issue.** If VS Code attaches and sees `forwardPorts: [22430]`, it will recognize the port as intentionally forwarded. But it will also see `appPort: ["22430:22430"]`, which means the port is already published at the Docker level. VS Code may show duplicate port entries in its port forwarding UI (one from `appPort` detection, one from `forwardPorts` declaration). This is cosmetic and non-blocking, but worth noting as a known UX quirk.

### Edge Cases

Comprehensive. The new edge cases (port outside `customizations.lace.features`, same label in multiple locations, user-provided `portsAttributes`) are well-covered.

**[non-blocking] Missing edge case: `${lace.port(label)}` in a JSON key position.** The template resolver walks the entire config. JSON keys are strings too. If someone writes `"portsAttributes": { "${lace.port(ssh)}": { "label": "test" } }`, should lace resolve the key? This is an unusual pattern but the "anywhere in devcontainer.json" scope technically includes it. The resolver should either support it or document that resolution applies to string values only, not object keys. Most JSON walkers naturally skip keys, so the practical answer is probably "values only," but it should be stated.

### Test Plan

Thorough. Covers the key scenarios for each module. The integration tests correctly test the symmetric generation, asymmetric suppression, backwards compatibility, and metadata fallback.

**[non-blocking] Add a test for `${lace.port(label)}` appearing in a non-string context.** The template-resolver tests include "skips non-string values (booleans, numbers) without error," but do not test `${lace.port(ssh)}` appearing in an array of integers (e.g., `"forwardPorts": ["${lace.port(ssh)}"]` -- note: this is a string in an array, which should work, vs `"forwardPorts": [${lace.port(ssh)}]` which is invalid JSON). Since the config is parsed JSON, all template expressions will be inside strings, so this may be moot. But `forwardPorts` expects integers, not strings. The proposal should clarify whether `"forwardPorts": ["${lace.port(ssh)}"]` resolves to `[22430]` (integer) or `["22430"]` (string), and how the type coercion works.

### Implementation Phases

Well-structured. Phase dependencies are clear. The "Do NOT modify" list in Phase 1 is valuable.

**[non-blocking] Phase 2's metadata fetch timing.** Phase 2 adds metadata fetching "after template resolution" (line 455). But `customizations.lace.ports` from feature metadata is used to enrich `portsAttributes`, which is part of auto-generation. The proposal should clarify that Phase 1 auto-generates `portsAttributes` with default attributes, and Phase 2 enriches those defaults with feature-declared attributes. This is implied but not stated.

## Verdict

**Revise.** One blocking issue:

1. The `appPort` suppression detection mechanism must be specified. The proposal describes the behavior (user-provided entries suppress auto-generation) but not the implementation strategy (post-resolution scan of existing entries for allocated port numbers).

The remaining findings are non-blocking clarifications that would strengthen the proposal but do not affect correctness.

## Action Items

1. [blocking] Specify the mechanism for detecting user-provided `appPort`/`forwardPorts`/`portsAttributes` entries that suppress auto-generation. Recommendation: after template resolution, scan the resolved config's `appPort` entries for host-side port numbers matching allocated labels; skip auto-generation for any matched ports. State this in the "Auto-generated port output" or "Override story" section.
2. [non-blocking] Add a caveat to the symmetric port safety argument noting that `portRange` customization is the escape hatch for environments where the default range conflicts, and that port availability is checked before allocation.
3. [non-blocking] State explicitly that lace matches `customizations.lace.ports` entries to `${lace.port()}` calls by label identity.
4. [non-blocking] Confirm that template resolution and auto-generation are separate sequential steps, so user-provided entries can be compared against generated entries.
5. [non-blocking] Note the minor VS Code UX quirk of potentially duplicate port entries from both `appPort` detection and `forwardPorts` declaration.
6. [non-blocking] Clarify whether template resolution applies to JSON object keys or values only.
7. [non-blocking] Clarify the type coercion behavior when `${lace.port()}` resolves inside a string that should be an integer (e.g., `forwardPorts` entries).
8. [non-blocking] Clarify that Phase 1 generates default `portsAttributes` and Phase 2 enriches them with feature-declared attributes.
