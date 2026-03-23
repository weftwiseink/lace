---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-23T00:30:00-07:00
task_list: lace/git-credential-support
type: proposal
state: live
status: request_for_proposal
tags: [lace, devcontainer, git, security]
---

# Lace Git Credential Support

> BLUF(opus/lace-git-credential-support): Lace devcontainers cannot create git commits because no layer in the stack configures git identity.
> The fix must provide commit-time identity (user.name, user.email) while explicitly preventing push permissions: no SSH keys, no credential helpers, no agent forwarding into the container.
>
> - **Motivated By:** [cdocs/reports/2026-03-23-devcontainer-git-identity-gaps.md](../reports/2026-03-23-devcontainer-git-identity-gaps.md)

## Objective

Enable `git commit` inside lace devcontainers without granting the container any ability to push to remotes.

Containers are disposable, may run untrusted code (AI-generated tool calls, npm postinstall scripts, arbitrary build steps), and must not hold credentials that could modify upstream repositories.
The security boundary is: **read the repo, commit locally, but never push**.

Pushing is an explicit host-side operation performed after reviewing the container's work.

## Scope

The full proposal should explore:

- Mounting a minimal `.gitconfig` containing only `user.name` and `user.email` (no credential helpers, no signing keys, no push-related config).
- Whether this should be a lace mount declaration (like `claude-config`) or a dedicated devcontainer feature (`lace-git-identity`).
- How to strip dangerous config from a host `.gitconfig` that may contain credential helpers, push URLs, or signing key references.
- Whether `containerEnv` with `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` is sufficient, or whether a `.gitconfig` file is needed for broader tool compatibility.
- How this interacts with the existing `safe.directory = *` setting in `postCreateCommand`.
- Whether `git push` should be actively blocked (e.g., a credential helper that always fails) or passively absent (no credentials configured, push just times out or gets auth errors).
- How `gh` CLI auth fits: should `gh` be installed but unconfigured, or omitted entirely?

## Known Requirements

- Containers MUST NOT receive SSH private keys or agent socket forwarding.
- Containers MUST NOT receive credential helpers or tokens that enable `git push`.
- Containers MUST be able to `git commit` with the correct author identity.
- The solution should work for all lace devcontainers, not just this repo.
- Identity should come from the host user's configuration, not be hardcoded in tracked files.

## Open Questions

- Should the feature generate a minimal gitconfig at container creation time (extracting only `user.name`/`user.email` from the host), or mount a user-curated file?
- Is there value in an explicit "push blocker" credential helper (`credential.helper = !echo "push not permitted" && exit 1`) vs. simply not configuring push credentials?
- How does this interact with worktrees? If the container has multiple worktrees, do they all inherit the same identity?
- Should `git config --global user.signingkey` be included for containers that need to create signed commits, or is signing always a host-side concern?
- What is the UX for a user who tries to `git push` from inside the container? Should they get a clear error message explaining the security boundary?

## Prior Art

- The existing `claude-config` mount in lace's devcontainer.json demonstrates the pattern of host-to-container file mounting.
- VS Code Remote Containers handles this transparently via `GIT_ASKPASS` injection, but that couples to VS Code and grants push permissions.
- GitHub Codespaces uses a similar VS Code-based forwarding mechanism with full push access.
