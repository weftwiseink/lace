---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-25T12:00:00-07:00
task_list: lace/hostname-defaults
type: proposal
state: live
status: request_for_proposal
tags: [lace, devcontainer, hostname, portless]
---

# RFP: Lace Container Hostname Defaults

> BLUF: Lace containers inherit Docker's random hostnames (e.g., `a1b2c3d4e5f6`), which provides no useful context. Setting a meaningful hostname (e.g., `lace-<project>`) enables hostname-conditioned shell history, better prompt display, and log identification. This proposal also explores integration with portless, where a human-readable hostname could double as a proxy endpoint name.

## Objective

Give lace-managed containers predictable, human-readable hostnames derived from the project name.
A meaningful hostname improves the developer experience in several ways:

1. Shell prompts display useful context instead of random hex.
2. Nushell history can be conditioned on hostname, enabling per-project history filtering.
3. Logs and process listings are immediately identifiable.
4. Portless proxy endpoints can use the same name for URL stability.

## Scope

The full proposal should explore:

### Hostname Format

- What format? Options: `lace-<project>`, `<project>`, `<project>.lace`, `<project>-dev`.
- How to derive `<project>` from the workspace: directory name, git remote, user-configured name.
- Length and character constraints: hostnames are limited to 63 characters, alphanumeric plus hyphens.
- Uniqueness: what happens when two containers for the same project run simultaneously?

### Implementation Mechanism

- **`runArgs --hostname`**: The most straightforward approach. Lace already generates `runArgs` in devcontainer.json.
- **`containerEnv` + shell config**: Set `HOSTNAME` via environment, let the shell read it. Does not affect the actual kernel hostname.
- **`postCreateCommand`**: Set hostname after container creation. Requires privileges.
- The proposal should evaluate which mechanism is most reliable and least intrusive.

### Portless Integration

- Portless provides proxy-based access to devcontainer services (e.g., `project.localhost` instead of `localhost:3000`).
- A human-readable hostname could serve as the portless endpoint name, providing URL stability across rebuilds.
- **Pros**: discoverability, memorable URLs, consistent naming across hostname and proxy.
- **Cons**: coupling between hostname and network proxy, complexity if the user wants different names for each, portless may not be present in all setups.
- The proposal should evaluate whether this coupling is desirable or if hostname and portless naming should remain independent.

### Interaction with Other Features

- **Nushell history conditioning**: If history persistence (see nushell-history RFP) is implemented, hostname-based filtering becomes a natural extension. The hostname format directly affects the usefulness of history queries like `history | where hostname == "lace-myproject"`.
- **Shell prompt**: Most prompt frameworks (starship, oh-my-posh) display hostname. A meaningful value improves the experience without additional configuration.
- **SSH config**: `wez-into` and SSH-based access may reference the hostname. Changes must not break existing SSH workflows.

## Open Questions

1. **Hostname format**: What is the right default? `lace-<project>` is descriptive but verbose. `<project>` alone may collide with the host's own hostname expectations.

2. **Portless coupling**: Should the hostname and portless endpoint name be the same by default, independently configurable, or completely decoupled?

3. **Project name derivation**: How to get a clean, hostname-safe project name? Git remote basename, workspace folder name, or explicit `lace.json` config?

4. **Collision handling**: If two containers share a project name, should lace append a suffix, error, or ignore the conflict?

5. **User override**: Should users be able to set a custom hostname in `lace.json` or `devcontainer.json` customizations? What takes precedence?

6. **Nushell history interaction**: Does nushell record hostname in its history sqlite schema, or would a wrapper be needed to tag history entries with the container hostname?
