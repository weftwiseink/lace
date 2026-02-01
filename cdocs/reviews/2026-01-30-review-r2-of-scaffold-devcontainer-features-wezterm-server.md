---
review_of: cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-30T19:00:00-08:00
task_list: lace/devcontainer-features
type: review
state: archived
status: done
tags: [rereview_agent, architecture, devcontainer-features, oci-namespace]
---

# Review (Round 2): Scaffold devcontainers/features/ with Wezterm Server Feature

## Summary Assessment

This is a round 2 review following revision of three blocking issues from round 1.
All three blocking issues have been resolved: the directory layout now correctly shows workflows at the repo root, the `createRuntimeDir` description uses dynamic `<uid>` instead of hardcoded `1000`, and the GHCR namespace section now documents the `features-namespace` action input for publishing to the preferred `ghcr.io/weftwiseink/devcontainer-features/*` address from the monorepo.
The BLUF and Decision 1 were also updated to reflect the `features-namespace` discovery.
Several non-blocking items from round 1 were also addressed (dead code removal, curl/dpkg checks, version rationale, phase split).
The proposal is ready for implementation.

**Verdict: Accept** with minor non-blocking suggestions.

## Prior Action Items Resolution

| # | Status | Item |
|---|--------|------|
| 1 | Resolved | Directory layout diagram now shows `.github/workflows/` at repo root with `devcontainer-features-*` prefixed filenames. Consistent with Decision 5. |
| 2 | Resolved | `createRuntimeDir` description changed to `"Create /run/user/<uid> runtime directory for wezterm-mux-server (UID resolved from _REMOTE_USER)"`. |
| 3 | Resolved | Publishing namespace section now documents the `features-namespace` action input, explains the default `ghcr.io/weftwiseink/lace/*` vs. overridden `ghcr.io/weftwiseink/devcontainer-features/*` namespace, and includes the workflow YAML snippet. Decision 1 also updated. |
| 4 | Resolved | `_REMOTE_USER_HOME` removed from install.sh. |
| 5 | Resolved | curl and dpkg availability checks added at the top of install.sh with clear error messages. |
| 6 | Resolved | Version rationale added: `"the latest stable release as of the Dockerfile's authoring and is the proven-working version in the lace devcontainer"`. |
| 7 | Not addressed | Feature still does not include `containerEnv` for `XDG_RUNTIME_DIR`. Acceptable: this is a consumer responsibility. |
| 8 | Resolved | Phase 3 split into Phase 3 (Dockerfile migration) and Phase 4 (additional features). BLUF updated to reference four phases. |

## Section-by-Section Findings

### BLUF

Updated to reflect four phases and the `features-namespace` input.
Accurate and complete.
No issues.

### Publishing Namespace

The new section clearly explains the default namespace derivation (`ghcr.io/weftwiseink/lace/*`), the override mechanism (`features-namespace: "weftwiseink/devcontainer-features"`), and includes a concrete workflow YAML snippet.
This resolves the most significant concern from round 1.

**Finding 1 (non-blocking): The `features-namespace` value format.**
The proposal uses `features-namespace: "weftwiseink/devcontainer-features"`.
This should be verified during Phase 2 implementation to confirm the action interprets this as the full namespace prefix (producing `ghcr.io/weftwiseink/devcontainer-features/wezterm-server`) rather than appending it to the owner (which would produce `ghcr.io/weftwiseink/devcontainer-features/wezterm-server` in either case, so this is likely correct but worth a smoke test).

### install.sh

The curl/dpkg checks are a good addition.
The `_REMOTE_USER_HOME` dead code is removed.

**Finding 2 (non-blocking): The dpkg check produces a clear error but does not suggest an alternative.**
The error message says `"This feature only supports Debian/Ubuntu-based images"`.
A follow-up improvement could suggest using the AppImage or tarball approach for non-Debian images, but this is out of scope for the initial feature.

### Implementation Phases

The four-phase structure is cleaner.
Phase 3 (migration) and Phase 4 (additional features) have separate success criteria and explicit dependency chains.

### Edge Cases: Feature ordering

**Finding 3 (non-blocking): The Edge Cases section still says "the install script could check for curl" as a mitigation.**
The install script now does check for curl (added in the revision).
This sentence in the Edge Cases section is stale and should be updated to reflect that the check is now implemented.

## Verdict

**Accept.**

All blocking issues from round 1 are resolved.
The proposal is internally consistent, well-researched, and implementation-ready.
The `features-namespace` discovery strengthens the monorepo decision by removing the namespace concern that was its primary risk.

## Action Items

1. [non-blocking] Update the "Feature ordering and installsAfter" edge case to note that curl/dpkg checks are now implemented in install.sh (the mitigation text is stale).
2. [non-blocking] During Phase 2 implementation, smoke-test the `features-namespace` value format to confirm the OCI address resolves correctly.
