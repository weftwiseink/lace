---
review_of: cdocs/proposals/2026-01-30-scaffold-devcontainer-features-wezterm-server.md
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T17:00:00-08:00
task_list: lace/devcontainer-features
type: review
state: live
status: done
tags: [fresh_agent, cross_platform, install_script, sshd_dependency, test_plan, coordination, implementation_plan]
---

# Review (Round 3): Scaffold devcontainers/features/ with Wezterm Server Feature

## Summary Assessment

This proposal extracts wezterm-mux-server installation from the lace Dockerfile into a cross-platform devcontainer feature published at `ghcr.io/weftwiseink/devcontainer-features/wezterm-server`, with CI/CD workflows and a phased migration plan coordinated with a parallel feature-based-tooling workstream.
The revision since round 2 is substantial: cross-platform distro detection with three install paths, sshd dependency via `installsAfter`, SSH key management spun off as a separate RFP, Phase 4 cut, and a significantly expanded implementation plan with debug workflows.
The overall quality is high: the install.sh logic is sound across all three paths, the implementation plan is detailed enough for autonomous work, and the coordination with the parallel workstream is clear.
The most significant findings are: the RPM filename construction uses a hardcoded Fedora version (`fc39`) that will fail on other RPM-based distros without adequate fallback, the Alpine AppImage path has a glibc dependency that is not called out, and the sshd dependency semantics could be more precisely documented.

**Verdict: Revise** - two blocking issues around cross-platform correctness and one around test coverage need resolution.

## Prior Review History

This is round 3, reviewed by a fresh agent.
Rounds 1-2 were self-reviews by the authoring agent.
Round 1 identified three blocking issues (directory layout diagram, hardcoded UID in option description, GHCR namespace derivation).
Round 2 confirmed all blocking issues resolved and accepted the proposal.
The document has since been significantly revised with cross-platform support, sshd integration, and an expanded implementation plan.
This review focuses on the new material.

## Section-by-Section Findings

### BLUF

The BLUF is dense but accurate.
It covers the three package formats, the sshd dependency, the CI/CD publishing, and the three-phase plan with coordination.
The reference to `installsAfter` dependencies on "both `common-utils` and `sshd`" correctly reflects the feature metadata.

No issues.

### Background: Wezterm Release Availability

**Finding 1 (non-blocking): The release availability table is useful but incomplete for the RPM row.**
The table says `.rpm` covers "Fedora, CentOS Stream, openSUSE" but the install script only constructs a Fedora-specific filename (`fc39` suffix).
CentOS Stream and openSUSE use different RPM naming conventions.
The table creates an expectation of broader support than the install script delivers.
Either narrow the table to match the script, or expand the script's RPM fallback logic.

### Background: Related Workstreams

The cross-references to the feature-based-tooling proposal and the SSH key auto-management RFP are well-placed.
The gating relationship ("Phase 3 of that proposal is gated on this proposal's feature being published") is clear and bidirectional.

No issues.

### Proposed Solution: install.sh - Distro Detection

The `detect_distro_family` function is well-structured.
The `ID`/`ID_LIKE` fallback pattern is standard and handles derivatives correctly.
The separation of `suse` from `redhat` despite both using RPMs is appropriate since openSUSE RPM naming differs from Fedora.

**Finding 2 (blocking): The suse distro family routes to `install_from_rpm` but the RPM filename is Fedora-specific.**
The case statement routes `redhat|suse` to `install_from_rpm`, but `install_from_rpm` constructs `RPM_NAME="wezterm-${VERSION}-1.fc39.${RPM_ARCH}.rpm"`.
The `fc39` suffix is Fedora-specific.
On openSUSE, the RPM filename would be different (e.g., `wezterm-${VERSION}-1.suse155.${RPM_ARCH}.rpm` or similar).
The fallback (`wezterm-${VERSION}.${RPM_ARCH}.rpm`) may or may not exist in the wezterm releases.
This means the suse path will attempt a Fedora-specific URL, fail, then try a generic URL that may also not exist, and only then fail with a curl error.
The error message would be a curl 404, not a helpful "openSUSE is not directly supported" message.

Resolution options:
- A) Add distro-specific RPM name construction (pass the distro family into the function, construct different names for fedora vs suse).
- B) Route suse to the AppImage fallback instead of the RPM path, since AppImage is the universal fallback.
- C) Keep the current logic but add a clear warning before the fallback attempt: "Trying generic RPM name; if this fails, the AppImage fallback will be attempted."

Option B is simplest and most honest: unless the exact openSUSE RPM filename convention is verified, routing to AppImage is safer.

### Proposed Solution: install.sh - Deb Path

The deb extraction logic is a direct lift from the working Dockerfile.
The architecture handling (amd64 omits suffix, arm64 appends it) matches wezterm's release naming.
The `dpkg` availability check is a good guard.

No issues.

### Proposed Solution: install.sh - RPM Path

**Finding 3 (non-blocking): The `rpm2cpio` and `cpio` tool check is good, but the error message could suggest a package manager command.**
The current error says "Install it with your package manager" which is generic.
On Fedora, `dnf install rpm2cpio cpio` would be the command.
On a minimal image, this is actionable guidance.
Minor improvement, not blocking.

**Finding 4 (non-blocking): The `cd /tmp/wezterm-extract` in `install_from_rpm` changes the working directory.**
While the script is run during feature installation (not interactively), the `cd` without a subshell means subsequent commands run from `/tmp/wezterm-extract`.
This is harmless in this case since the next commands use absolute paths, but wrapping in a subshell `(cd /tmp/wezterm-extract && rpm2cpio ... | cpio ...)` would be more hygienic.

### Proposed Solution: install.sh - AppImage Path

**Finding 5 (blocking): AppImage extraction requires glibc, which Alpine does not have.**
The `detect_distro_family` function correctly identifies Alpine, which falls through to the `*) ... install_from_appimage` case.
However, the AppImage format is built against glibc.
The `--appimage-extract` flag invokes the embedded runtime, which requires glibc to execute the AppImage binary itself.
On Alpine (musl libc), `./wezterm.AppImage --appimage-extract` will fail with a dynamic linker error (e.g., `/lib/ld-linux-x86-64.so.2: not found`).

This means Alpine is effectively unsupported but the install script does not surface this clearly.
It will fail with a confusing dynamic linker error rather than a helpful message.

Resolution options:
- A) Add Alpine detection and exit with a clear "Alpine is not supported; wezterm does not publish musl-compatible binaries" message before attempting AppImage extraction.
- B) Attempt static binary extraction from the AppImage using `unsquashfs` (available via `apk add squashfs-tools`) instead of executing the AppImage. The AppImage is a squashfs filesystem appended to a stub; `unsquashfs` can extract it without executing the stub.
- C) Document Alpine as unsupported in the feature description and add an early exit.

Option A is the most appropriate for v1: clearly communicate the limitation rather than silently failing.
Option B is an interesting enhancement for later if Alpine support is desired.

### Proposed Solution: install.sh - Runtime Directory

The `_REMOTE_USER` resolution with fallback to `root` and `id -u` with fallback to `1000` is correct.
The `chown` uses `_REMOTE_USER:_REMOTE_USER` which works when the user exists.
The `2>/dev/null || echo "1000"` handles the case where the user does not exist yet.

No issues.

### Proposed Solution: devcontainer-feature.json

The `installsAfter` array listing both `common-utils` and `sshd` is correct.
The `installsAfter` semantic (ordering hint, not a hard dependency) is accurately described in the Edge Cases section.

**Finding 6 (non-blocking): The feature description mentions "SSH domains" which is wezterm-specific terminology.**
Users unfamiliar with wezterm may not understand what "SSH domains" means.
Consider expanding to "SSH domain connections (wezterm's remote multiplexing protocol)" or linking to wezterm docs.
Minor clarity improvement.

### Proposed Solution: test.sh

**Finding 7 (non-blocking): The test checks `test -d /run/user/$(id -u)` which dynamically resolves the UID.**
This is an improvement over the hardcoded `1000` from the round 1 review.
Good.

**Finding 8 (blocking): No test scenario covers the RPM or AppImage paths.**
The `scenarios.json` includes `debian_default`, `ubuntu_default`, `custom_version`, `no_runtime_dir`, and `fedora`.
The Fedora scenario tests the RPM path, which is good.
However, there is no scenario for the AppImage fallback path.
Since the AppImage path is the fallback for unknown distros and has the glibc caveat, having at least one test scenario for it would catch regressions.
An Arch Linux or other non-deb/non-rpm base image scenario would exercise this path.

Additionally, the Fedora scenario specifies `fedora:39` which matches the hardcoded `fc39` in the RPM filename.
A scenario with `fedora:40` or `fedora:41` would verify the fallback logic works when the exact `fc39` filename is not available.

Resolution: Add at least one scenario that exercises the AppImage path (e.g., `archlinux:latest`) and consider a newer Fedora scenario to test RPM fallback.

### Design Requirements

The terse "Design Requirements" section with a reference to the full decisions report works well.
Each numbered point accurately summarizes the corresponding decision.
The reference path is correct.

No issues.

### Edge Cases

**Finding 9 (non-blocking): The "Feature ordering with sshd" edge case is well-written.**
The explanation that `installsAfter` is a no-op when sshd is absent, and that the feature installs successfully without sshd, is precise.
The note that "SSH domain connectivity simply requires the user to provide their own sshd" correctly frames the soft dependency.

**Finding 10 (non-blocking): The "Wezterm release URL format varies by distro and architecture" edge case should mention the `fc39` hardcoding risk.**
The section says "each installation path constructs URLs according to the specific distro's naming convention" but the RPM path hardcodes `fc39`.
If wezterm stops publishing `fc39` RPMs (or the user runs Fedora 41), the primary URL will 404 and the fallback URL may also fail.
This risk should be documented in this section.

### Implementation Phases: Phase 1

The Phase 1 implementation plan is notably comprehensive.
The step-by-step structure (1.1 through 1.6) with shell commands, the debug workflow with five numbered troubleshooting paths, and the explicit success criteria make this actionable for an autonomous implementer.

**Finding 11 (non-blocking): The debug workflow is excellent.**
The five-step debug sequence (read output, test interactively, verify binary locations, test RPM path, test AppImage path) plus the ShellCheck guidance is thorough.
This is one of the strongest sections of the proposal.

**Finding 12 (non-blocking): Step 1.6 references `shellcheck install.sh` but does not specify a shellcheck version or installation method.**
The devcontainer features test environment (`ubuntu-latest` in CI) may not have shellcheck pre-installed.
This is a minor gap: the implementer will figure it out, but noting `apt-get install shellcheck` or `snap install shellcheck` would be complete.

### Implementation Phases: Phase 2

The CI/CD workflow definitions are concrete and usable.
The test workflow triggers on both PR and push for `devcontainers/features/**`.
The release workflow uses the `features-namespace` override correctly.

**Finding 13 (non-blocking): The release workflow uses `peter-evans/create-pull-request@v6` for generated docs.**
This is a reasonable automation choice.
The `contents: write` and `pull-requests: write` permissions are correctly specified.
No issues.

### Implementation Phases: Phase 3

The shared-phase coordination with the feature-based-tooling workstream is clearly stated: "This phase is shared with the feature-based-tooling migration...It should be implemented as part of that workstream's Phase 3."
The gating ("Once the feature is published to GHCR") is explicit.

**Finding 14 (non-blocking): Step 3.2 says to remove SSH directory setup because it is "handled by the `sshd` feature".**
The current Dockerfile (lines 116-118) creates `/home/${USERNAME}/.ssh` and sets permissions.
The `sshd` feature (`ghcr.io/devcontainers/features/sshd:1`) handles sshd daemon setup, but its handling of per-user `.ssh` directory creation should be verified.
If the sshd feature does not create the `.ssh` directory for the `_REMOTE_USER`, and the `authorized_keys` mount in `devcontainer.json` expects it to exist, the mount will fail.
This should be verified during Phase 3 implementation rather than assumed.

### Coordination with Parallel Workstream

The proposal clearly defines the coordination points:
1. The feature-based-tooling proposal's Phase 3 is gated on this feature being published.
2. Phase 3 of this proposal is shared with that workstream.
3. The SSH key management concern is spun off as a separate RFP.

This is well-factored and avoids both duplication and under-specification.

No issues.

## Verdict

**Revise.**

Three issues need resolution before implementation:

1. The RPM path hardcodes `fc39` in the filename, making it Fedora-39-specific while claiming to support openSUSE and other RPM distros. Either add distro-specific RPM name construction or route non-Fedora RPM distros to the AppImage fallback.
2. The AppImage fallback path will fail on Alpine (musl libc) with an unhelpful dynamic linker error. Add early detection and a clear error message for Alpine/musl systems.
3. The test scenarios do not cover the AppImage fallback path, and the sole Fedora scenario uses the exact version (`fedora:39`) that matches the hardcoded RPM filename, meaning the fallback logic is never exercised.

## Action Items

1. [blocking] Fix the RPM path to handle non-Fedora RPM distros. Simplest approach: route `suse` to AppImage fallback instead of `install_from_rpm`, and rename the case branch from `redhat|suse` to `redhat`. Alternatively, pass distro info into `install_from_rpm` and construct distro-appropriate filenames.
2. [blocking] Add Alpine/musl detection before the AppImage extraction attempt. Exit with a clear error message explaining that wezterm does not publish musl-compatible binaries. This can be as simple as checking for `/etc/alpine-release` or `command -v apk` at the top of `install_from_appimage`.
3. [blocking] Add test scenarios: (a) a non-deb/non-rpm image to exercise the AppImage path (e.g., `archlinux:latest` or a glibc-based generic image), and (b) a Fedora image with a version other than 39 (e.g., `fedora:41`) to verify the RPM fallback logic.
4. [non-blocking] Update the "Wezterm release URL format" edge case to document the `fc39` hardcoding and its implications for newer Fedora versions.
5. [non-blocking] Narrow the release availability table's RPM row to match what the script actually supports, or add a note that only Fedora is directly tested.
6. [non-blocking] Wrap the `cd /tmp/wezterm-extract` in `install_from_rpm` in a subshell to avoid changing the working directory of the parent process.
7. [non-blocking] Verify during Phase 3 that the `sshd` feature creates per-user `.ssh` directories before removing the Dockerfile's SSH directory setup lines.

## Questions for Author

The RPM path's Fedora-specific filename construction is the most significant design question. Which approach do you prefer?

A) Route openSUSE to AppImage fallback (simplest, honest about support matrix).
B) Add openSUSE-specific RPM filename construction (broader support, more code to maintain).
C) Accept that `suse` routes to `install_from_rpm`, which tries the Fedora filename then the generic fallback, and document this as "best effort" for openSUSE.

For Alpine:

A) Add an early exit with a clear error message (recommended for v1).
B) Implement `unsquashfs`-based extraction as an alternative to executing the AppImage (broader support, more complex).
C) Remove Alpine from the `detect_distro_family` output entirely and let it fall through to "unknown" with the same AppImage attempt (no improvement).
