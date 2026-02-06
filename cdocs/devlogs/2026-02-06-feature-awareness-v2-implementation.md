---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-06T13:45:00-08:00
type: devlog
state: live
status: in_progress
tags: [features, ports, templating, refactor]
implements: cdocs/proposals/2026-02-06-lace-feature-awareness-v2.md
---

# Devlog: Feature Awareness v2 Implementation

## Overview

Implementing the feature awareness v2 proposal which replaces lace's hardcoded
wezterm port assignment with a metadata-driven port system. Features declare port
options in `customizations.lace.ports`; lace auto-injects `${lace.port()}`
template expressions and resolves them to concrete port numbers.

Builds on the existing feature-metadata.ts module (commits 570df53, dedf382,
ec35e2f) which provides OCI manifest fetching, two-tier caching, validation,
and `extractLaceCustomizations()`.

## Phase 1: Template resolver + port allocator

**Status:** in_progress

### Plan

1. Create `port-allocator.ts` -- label-based port allocation with persistence
2. Create `template-resolver.ts` -- auto-injection + template resolution + port entry generation
3. Update `up.ts` -- replace hardcoded port assignment with the new pipeline
4. Update integration tests
5. Maintain backwards compatibility with existing port-manager.ts during transition

### What was built

(will be filled as implementation proceeds)
