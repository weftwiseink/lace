---
review_of: cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T18:00:00-08:00
task_list: lace/devcontainer-features
type: review
state: archived
status: done
tags: [rereview_agent, cross_platform, install_script, test_plan, blocking_resolution]
---

# Review (Round 4): Scaffold devcontainers/features/ with Wezterm Server Feature

## Summary Assessment

This is a focused re-review to confirm the three blocking issues from round 3 have been resolved.
All three blocking issues are resolved: the RPM path no longer routes suse to `install_from_rpm`, Alpine/musl detection is present with clear error messaging, and the test scenarios now include `fedora:41` (RPM fallback) and `archlinux:latest` (AppImage path).
The non-blocking suggestions from round 3 (fc39 fragility documentation, release table narrowing, RPM `cd` subshell, Phase 3 SSH verification note) have also been addressed.
The design decisions report is updated to reflect the changes.

**Verdict: Accept.**

## Prior Review History

Round 3 identified three blocking issues:
1. RPM path hardcoded `fc39` and routed `suse` to `install_from_rpm` where the Fedora-specific filename would fail.
2. AppImage fallback on Alpine/musl would produce a confusing dynamic linker error instead of a clear message.
3. Test scenarios lacked coverage for the AppImage path and the RPM fallback logic.

This round verifies those issues are resolved and checks the non-blocking items.

## Blocking Issue Resolution

### Issue 1: RPM path / suse routing

**Resolved.** The case statement (proposal line 290-298) now routes only `redhat` to `install_from_rpm`. The `suse` family falls through to `*` and routes to AppImage. The `detect_distro_family` function still correctly identifies `opensuse*|sles` as `suse` (line 205), which then falls through to the AppImage fallback path with the message "No native package for suse; falling back to AppImage extraction...".

The `fc39` hardcoding remains in `install_from_rpm` (line 252) but this is now appropriate: the RPM path is Fedora-only, with a fallback to a generic RPM filename pattern. The edge cases section (line 442) explicitly documents this as "a known fragility."

### Issue 2: Alpine/musl detection

**Resolved.** The `install_from_appimage` function (lines 268-274) checks for Alpine via `/etc/alpine-release` and for musl via `ldd --version` output before attempting extraction. The error message is clear and actionable: it names the limitation (no musl-compatible binaries), identifies the affected distros (Alpine and other musl-based), and suggests a resolution (use a glibc-based image).

The edge cases section (lines 455-458) documents Alpine as unsupported with the early detection noted. The release availability table (line 107) adds an explicit note that Alpine is unsupported.

### Issue 3: Test scenarios

**Resolved.** The `scenarios.json` now includes seven scenarios (up from five):

| Scenario | Image | Path exercised |
|---|---|---|
| `debian_default` | `mcr.microsoft.com/devcontainers/base:debian` | deb |
| `ubuntu_default` | `mcr.microsoft.com/devcontainers/base:ubuntu` | deb |
| `custom_version` | ubuntu base | deb (explicit version) |
| `no_runtime_dir` | `debian:bookworm` | deb (option variant) |
| `fedora_39` | `fedora:39` | RPM (exact fc39 match) |
| `fedora_41_rpm_fallback` | `fedora:41` | RPM (fallback path) |
| `archlinux_appimage` | `archlinux:latest` | AppImage |

This covers all three install paths, the RPM fallback logic, and an option variant. The success criteria (line 602) explicitly lists "Fedora 39, Fedora 41 (RPM fallback), and Arch Linux (AppImage)."

## Non-Blocking Items from Round 3

| Item | Status |
|---|---|
| Document fc39 fragility in edge cases | Done (line 442) |
| Narrow release availability table | Done (line 101: "Fedora (directly tested; other RPM distros via Copr)") |
| Wrap RPM `cd` in subshell | Done (line 261: parenthesized subshell) |
| Phase 3 SSH directory verification | Done (line 738: "Verify first that the `sshd` feature creates per-user `.ssh` directories...") |
| Design decisions report updated | Done (lines 37-38, 54, 57-58 of the report) |

## Minor Observations

These are not blocking and do not require action. Noted for completeness.

1. The `install_from_appimage` function uses `cd /tmp` (line 283) outside a subshell, unlike the RPM path which correctly uses a subshell. This is harmless since the script ends shortly after, but for consistency the same subshell pattern could be applied. Not worth a revision cycle.

2. The `fedora_41_rpm_fallback` scenario depends on wezterm not publishing an `fc41`-suffixed RPM. If wezterm later publishes `fc41` RPMs, this scenario would exercise the primary path rather than the fallback. This is an inherent test fragility that is difficult to avoid without mocking the download URL, and is acceptable for an integration test.

3. The Arch Linux scenario depends on `archlinux:latest` being a glibc-based image without `dpkg` or `rpm2cpio`, which is the current state. The scenario comment names itself `archlinux_appimage` which makes the intent clear.

## Verdict

**Accept.**

All three blocking issues from round 3 are resolved cleanly. The non-blocking suggestions have been addressed. The install script correctly routes suse to AppImage, detects Alpine/musl early with a clear error, and the test matrix covers all three install paths including the RPM fallback. The design decisions report is consistent with the proposal. The proposal is ready for implementation.

## Action Items

No blocking items. The proposal is accepted as-is.
