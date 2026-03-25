---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T12:00:00-07:00
task_list: lace/recommended-tools
type: proposal
state: live
status: request_for_proposal
tags: [lace, devcontainer_features, developer_tools]
---

# RFP: Lace Recommended Tools Feature

> BLUF: A lace devcontainer feature (or feature extension) for recommended optional developer CLI tools: git-delta, bat, fzf, and similar ergonomics utilities that are absent from major devcontainer feature registries. The key design decision is whether to bundle these as a single "lace-tools" feature, individual features, or chezmoi run_once scripts.

## Objective

Provide a consistent, low-friction way to install commonly desired CLI tools into lace-managed devcontainers.
These tools (git-delta, bat, fzf, eza, ripgrep, fd, etc.) are not available in the official devcontainer feature registry and must currently be installed ad-hoc.
A standardized approach ensures every lace container starts with a productive baseline.

## Scope

The full proposal should explore:

### Tool Selection

- Which tools belong in the recommended set?
- Criteria for inclusion: broad utility, low footprint, no conflicting system dependencies.
- Whether the set should be opinionated (curated list) or configurable (pick-and-choose).

### Packaging Strategy

- **Single "lace-tools" feature**: One feature installs the full curated set. Simpler to manage, but less granular.
- **Individual features**: Each tool is its own feature. More flexible, but higher maintenance burden.
- **Chezmoi run_once scripts**: Install tools via dotfiles rather than features. Avoids feature registry overhead, but couples tool installation to dotfiles presence.
- Hybrid approaches: a base feature with optional tool toggles via feature options.

### Architecture Detection

- Many tools publish binaries for amd64 and arm64 but use different archive naming conventions.
- How to handle architecture detection reliably across Debian, Ubuntu, and Alpine base images.
- Whether to use package managers (apt, apk) where available vs. direct binary downloads from GitHub releases.

### Version Management

- Whether to version-pin tools for reproducibility or use latest for simplicity.
- If pinning: how to update pins (renovate, manual, CI job).
- If latest: how to handle breaking changes in upstream tools.

### Integration with Existing Features

- Interaction with chezmoi-managed tool configs (bat themes, delta gitconfig, fzf shell integration).
- Whether the feature should also configure tools (e.g., set delta as git pager) or only install binaries.

## Open Questions

1. **Tool list**: Which tools make the cut? git-delta, bat, fzf, eza, ripgrep, and fd are strong candidates. What about less universal tools like zoxide, dust, or procs?

2. **Architecture detection**: Should the feature use `dpkg --print-architecture`, `uname -m`, or a combination? How to handle musl vs glibc variants?

3. **Version pinning vs latest**: Reproducibility favors pinning, but maintenance cost is real. Is there a middle ground (pin major versions, float patches)?

4. **Configuration scope**: Should the feature only install binaries, or also wire up git config (delta), shell integration (fzf), and aliases (bat -> cat)?

5. **Base image compatibility**: What is the minimum set of base images this must work on? Just Debian/Ubuntu, or also Alpine and RHEL-family?
