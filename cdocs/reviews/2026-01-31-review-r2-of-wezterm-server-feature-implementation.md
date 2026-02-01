---
review_of: cdocs/devlogs/2026-01-31-scaffold-devcontainer-features-wezterm-server.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T23:55:00-08:00
task_list: lace/devcontainer-features
type: review
state: archived
status: done
tags: [rereview_agent, implementation_review, install_script, test_coverage, ci_cd, devcontainer_features]
---

# Review R2: Wezterm Server Feature Implementation

## Summary Assessment

This is round 2 of the implementation review for the wezterm-server devcontainer feature (Phase 1a and Phase 2).
All four findings from round 1 have been addressed: the blocking `no_runtime_dir.sh` scenario test was created, `common-utils` was added to the bare Debian scenario for curl availability, `detect_arch` now reports the unsupported architecture to stderr, and the test workflow declares explicit read permissions.
The implementation is clean, POSIX-correct, well-tested, and aligned with the proposal.

**Verdict: Accept.**

## Round 1 Findings Resolution

| # | Severity | Finding | Resolution | Status |
|---|----------|---------|------------|--------|
| 1 | blocking | No `no_runtime_dir.sh` scenario test; shared `test.sh` would fail | Created `no_runtime_dir.sh` with inverted runtime dir assertion (`! test -d`) | Resolved |
| 2 | non-blocking | Bare `debian:bookworm` may lack curl | Added `ghcr.io/devcontainers/features/common-utils:2` to `no_runtime_dir` scenario | Resolved |
| 3 | non-blocking | `detect_arch` silent exit on unsupported architecture | Error message with architecture name now printed to stderr before `return 1` | Resolved |
| 4 | non-blocking | Test workflow missing explicit `permissions` block | Added `permissions: contents: read` | Resolved |

## Changed Files Review

### install.sh: detect_arch stderr output

Line 18 now reads:

```sh
*)       echo "Error: unsupported architecture $(uname -m). Only x86_64 and aarch64 are supported." >&2; return 1 ;;
```

This is correct. The error goes to stderr (`>&2`), so it does not contaminate the `ARCH=$(detect_arch)` capture on stdout. The message includes the actual `uname -m` value, which is useful for debugging. The `return 1` combined with `set -e` halts the script immediately after the user-visible error.

No issues.

### no_runtime_dir.sh: Scenario-specific test

```bash
#!/bin/bash
set -e

source dev-container-features-test-lib

check "wezterm-mux-server installed" command -v wezterm-mux-server
check "wezterm cli installed" command -v wezterm
check "wezterm-mux-server version" wezterm-mux-server --version
check "runtime dir does not exist" bash -c '! test -d /run/user/$(id -u)'

reportResults
```

The test correctly duplicates the three binary/version checks from the shared `test.sh` and replaces the "runtime dir exists" assertion with "runtime dir does not exist" using `! test -d`. This is the standard approach for scenario-specific tests in the devcontainer features framework.

No issues.

### scenarios.json: common-utils addition

The `no_runtime_dir` scenario now includes `"ghcr.io/devcontainers/features/common-utils:2": {}` in its features list. This ensures curl, ca-certificates, and other standard utilities are available on the bare `debian:bookworm` image before the wezterm-server feature's `install.sh` runs. The `common-utils` feature is already listed in `devcontainer-feature.json`'s `installsAfter`, so ordering is handled correctly by the framework.

No issues.

### devcontainer-features-test.yaml: permissions block

```yaml
permissions:
  contents: read
```

Added at the workflow level, matching the explicit permissions pattern used by the release workflow. This follows the principle of least privilege and is consistent across both workflows.

No issues.

## Unchanged Files Review

### devcontainer-feature.json

Unchanged from round 1. Metadata, options schema, `installsAfter` dependencies, and documentation URLs are all correct and aligned with the proposal.

### test.sh

Unchanged from round 1. The four checks (two binary presence, version output, runtime dir existence) cover the default happy path. The `no_runtime_dir` scenario now has its own test script, so the unconditional runtime dir assertion in this shared test is no longer a problem.

### devcontainer-features-release.yaml

Unchanged from round 1. Permissions, `devcontainers/action@v1` configuration, namespace override, and `peter-evans/create-pull-request` step are all correct.

## Proposal Alignment

The implementation continues to match Phase 1a and Phase 2 specifications with high fidelity.
The only deviation from the proposal is the addition of `common-utils` to the `no_runtime_dir` scenario, which was not in the proposal's `scenarios.json` but is a necessary correction since the bare `debian:bookworm` image lacks curl.
This is a constructive deviation: the proposal had a latent bug in its test scenario design.

## Verdict

**Accept.**

All blocking and non-blocking findings from round 1 have been resolved.
The implementation is complete for Phase 1a (Debian-only feature) and Phase 2 (CI/CD workflows).
No new issues found.

The devlog should move to `done` status once local container testing is verified by the human operator (or once CI passes on the first PR touching `devcontainers/features/**`).

## Action Items

No blocking or non-blocking action items remain.
