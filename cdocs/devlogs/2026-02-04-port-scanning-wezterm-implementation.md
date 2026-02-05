---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T17:00:00-08:00
type: devlog
state: live
status: in_progress
tags: [wezterm, port-scanning, discovery, multi-project, devcontainer, implementation]
implements:
  - cdocs/proposals/2026-02-04-port-scanning-wezterm-discovery.md
---

# Port-Scanning WezTerm Discovery Implementation

## Objective

Implement the port-scanning WezTerm discovery system as specified in the accepted proposal. This replaces the registry-based multi-project system with decoupled port-scanning discovery via Docker CLI.

Key features:
1. Port range 22425-22499 for wezterm SSH servers
2. `lace up` assigns and persists ports in `.lace/devcontainer.json`
3. WezTerm plugin discovers projects via Docker CLI when picker is invoked
4. `wez-lace-into` CLI uses Docker discovery
5. No central registry required

## Implementation Plan

Per the proposal, implementation proceeds in 5 phases:

1. **Phase 1**: Port Assignment in `lace up`
2. **Phase 2**: Docker Discovery Function (standalone script)
3. **Phase 3**: WezTerm Plugin with Docker Discovery
4. **Phase 4**: CLI Update (`wez-lace-into`)
5. **Phase 5**: End-to-End Integration Testing

---

## Phase 1: Port Assignment in `lace up`

### Plan

- Create `packages/lace/src/lib/port-manager.ts`
- Implement `isPortAvailable()` using TCP connect
- Implement `assignPort()` to find/persist port
- Update `lace up` to call port assignment before generating config

### Implementation Notes

Starting with the port-manager module...

