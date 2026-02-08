---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T10:00:00-08:00
type: devlog
state: archived
status: done
tags: [features, architecture, port-management, refactor, templating]
---

# Feature Overhaul Workstream

## Seed Prompt

```
**generic lace feature customizations**
/propose genericizing the lace-specific features as customizations standard devcontainer features can specify.

The proposal will have to work out how to fetch all pre and runtime manifests for features for us to hook into. If we're lucky it can use a devcontainer cli feature, but otherwise we may need a new module.

Have a subagent research and /report on the options pros/cons (external binary dependence etc) and caching scheme we might use.

Have another subagent investigate and /report on whether we really need our own custom port provisioning, or if we could/should just use container labels / assess the runtime state using normal devcontainer idioms in https://containers.dev/implementors/json_reference/#port-attributes.

The final top-level proposal here should synthesize the proposals into a redesign & refactor proposal for lace feature awareness, and to refactor the port allocation logic.

If we keep our custom port management in lace, we should "invert control" and add some kind of `lace.port(label)` templating logic - think hard on this design iff we decide it is necessary

keep devlogs, use /triage and /review subagents liberally for iterative review, and seed your devlog with this file's contents at the top.
```

## Objective

Produce a comprehensive proposal for genericizing lace's feature customizations, covering: (1) how lace fetches and uses devcontainer feature manifests, (2) whether custom port provisioning is needed or replaceable by spec idioms, and (3) a redesign of `customizations.lace.features` with template variable resolution.

## Plan

### Phase 1: Parallel research
- **Report A**: Feature manifest fetching options (CLI, OCI registry API, oras, caching)
- **Report B**: Port provisioning assessment (spec idioms vs custom management)

### Phase 2: Review both reports
- /review each report, apply feedback

### Phase 3: Synthesize proposal
- Top-level /propose combining both research streams
- Feature awareness redesign + port allocation refactor

### Phase 4: Review and iterate
- /review the proposal, apply blocking feedback

## Progress Log

### 2026-02-06 10:00 -- Phase 1 started
- Created devlog
- Read all critical context files: plugin architecture analysis report, up.ts, port-manager.ts, devcontainer.ts
- Investigated devcontainer CLI: `devcontainer features info manifest` returns full `devcontainer-feature.json` as OCI annotation in JSON format -- no need for external tools
- `devcontainer features info verbose` also returns published tags
- `devcontainer features resolve-dependencies` resolves the full dependency graph from a workspace config
- `devcontainer read-configuration --include-features-configuration` can include resolved feature config
- Launching parallel research subagents for Report A and Report B

### 2026-02-06 10:15 -- Report A complete
- Written: `cdocs/reports/2026-02-06-feature-manifest-fetching-options.md`
- Key finding: `devcontainer features info manifest --output-format json` is the right tool -- zero new deps, handles auth, <1s per feature
- Recommends two-tier cache (in-memory + filesystem), best-effort fetching

### 2026-02-06 10:30 -- Report B complete
- Written: `cdocs/reports/2026-02-06-port-provisioning-assessment.md`
- Key finding: dynamic port assignment is a genuine gap -- no spec idiom can replace it
- Recommends `${lace.port(label)}` templating, keep `appPort` for direct TCP access, persist in `.lace/port-assignments.json`
- Evaluated four alternatives (static forwardPorts, requireLocalPort, ephemeral, post-start discovery) -- all rejected

### 2026-02-06 11:00 -- Proposal written (Phase 3)
- Written: `cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md`
- Synthesizes both reports into a 4-phase implementation plan
- Skipped report reviews to prioritize the synthesis -- reports are incorporated by reference
- Core design: `customizations.lace.features` with template variables, feature promotion pipeline, generic port allocation

### 2026-02-06 11:30 -- Review R1 (Phase 4)
- Written: `cdocs/reviews/2026-02-06-review-of-lace-feature-awareness-redesign.md`
- Verdict: Revise -- three blocking issues found:
  1. `${lace.port(label)}` missing containerPort dimension -- host port alone insufficient for appPort mapping
  2. appPort vs forwardPorts migration unresolved -- forwardPorts may not provide direct TCP access needed by SSH
  3. Removing unconditional port assignment is a breaking change without migration bridge

### 2026-02-06 12:00 -- Revisions applied (Phase 4 complete)
- All three blocking issues resolved:
  1. Changed to `${lace.port(label, containerPort)}` with explicit container port argument
  2. Decided to keep `appPort` for direct TCP access, add `portsAttributes` for labeling -- no forwardPorts migration
  3. Added backwards-compatibility bridge: legacy port assignments preserved when no `customizations.lace.features` declared
- Non-blocking improvements applied: containerUser acknowledged as best-effort, Open Questions section added, Phase 3 independence noted
- Proposal accepted at R2

## Deliverables

| Document | Path | Status |
|----------|------|--------|
| Devlog | `cdocs/devlogs/2026-02-06-feature-overhaul-workstream.md` | Complete |
| Report: Manifest Fetching | `cdocs/reports/2026-02-06-feature-manifest-fetching-options.md` | Review ready |
| Report: Port Provisioning | `cdocs/reports/2026-02-06-port-provisioning-assessment.md` | Review ready |
| Proposal: Feature Awareness Redesign | `cdocs/proposals/2026-02-06-lace-feature-awareness-redesign.md` | Accepted (R2) |
| Review: Proposal R1 | `cdocs/reviews/2026-02-06-review-of-lace-feature-awareness-redesign.md` | Done |
