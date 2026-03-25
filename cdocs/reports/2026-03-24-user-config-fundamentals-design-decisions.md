---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-24T21:00:00-07:00
task_list: lace/user-config-and-fundamentals
type: report
state: live
status: review_ready
tags: [lace, architecture, design_decisions, security]
---

# User Config and Fundamentals Feature: Design Decisions

> BLUF(opus/user-config-and-fundamentals): This report captures the design rationale behind key decisions in the user-level config proposal and fundamentals feature proposal, following revision to address project owner feedback.
> The most significant design evolutions: mount security moved from a hardcoded denylist to a user-configurable policy file with secure defaults, git identity became a two-layer system (user default + project override via `GIT_CONFIG_*`), and the fundamentals feature now declares dotfiles and screenshots as requested mounts rather than relying on external systems.
> These decisions prioritize security-by-default with escape hatches, git's native configuration mechanisms, and lace's existing feature mount request pattern.

## Context / Background

Two proposals define the user-level configuration and baseline container environment for lace:

1. **User-level config** (`cdocs/proposals/2026-03-24-lace-user-level-config.md`): introduces `~/.config/lace/user.json` for declaring universal mounts, features, git identity, and preferences.
2. **Fundamentals feature** (`cdocs/proposals/2026-03-24-lace-fundamentals-feature.md`): introduces a single devcontainer feature that consolidates SSH hardening, git identity, dotfiles, shell config, and core utilities.

Both proposals were reviewed and accepted, with the project owner leaving targeted REVIEW_NOTEs requesting design changes.
This report documents the rationale behind each design decision, the tradeoffs involved, and the reasoning for the chosen approaches.

## Key Findings

- The configurable mount policy is strictly more capable than the hardcoded denylist while maintaining equivalent default security.
- Git's `GIT_CONFIG_*` environment variable mechanism (available since git 2.31) provides a clean project-override path that requires no file manipulation.
- Lace features already have a well-established mount request pattern (`customizations.lace.mounts` with `recommendedSource`, `hint`, `sourceMustBe`); the fundamentals feature should use it consistently.
- The fundamentals feature's install script benefits from decomposition into per-component step scripts for readability and independent testability.
- Core utility ("staples") installation should be minimal: `curl`, `jq`, `less`. Build tools and editor-adjacent tooling are out of scope.

## Design Decision 1: Separate `user.json` from `settings.json`

**Decision:** introduce a new file (`~/.config/lace/user.json`) rather than extending the existing `settings.json`.

**Rationale:** these files answer different questions with different lifecycles.
`settings.json` answers "where on this machine are the sources for project-declared mounts?" and is machine-specific (different paths on laptop vs. workstation).
`user.json` answers "what mounts, features, and preferences do I always want?" and is portable across machines (same features, same identity, same preferences).

Mixing them creates ambiguity: is a mount entry an override for a project-declared mount, or a new mount to inject into every container?
The separate file makes intent unambiguous and allows `user.json` to be managed by chezmoi (portable) while `settings.json` remains machine-local.

**Tradeoff:** users now have two config files.
The risk is configuration sprawl.
This is mitigated by clear documentation and distinct file purposes.

## Design Decision 2: Configurable Mount Policy

**Decision:** replace the hardcoded denylist with a user-configurable mount policy file (`~/.config/lace/mount-policy`) using a line-oriented format with `!`-prefix exceptions.

**Rationale:** the project owner identified that users need control over what paths are blocked and allowed.
A hardcoded denylist forces users to use project-level mounts as a workaround when they have a legitimate need to mount a subdirectory of a denied path (e.g., `~/.npmrc` for read-only registry config without tokens).

The policy file format uses `.gitignore`-style semantics (familiar to developers) with last-match-wins evaluation.
Default rules ship with lace and protect credential stores.
User rules are appended after defaults, so user rules take precedence.

**Security tradeoff:** users can punch holes in the default denylist.
This is acceptable because:
1. The user is making an explicit, documented choice.
2. The default policy still protects users who do not customize.
3. The `!`-prefix syntax requires intentional action (you cannot accidentally allow a dangerous path).
4. User mounts are still read-only, limiting damage from a compromised container.

**Alternative considered:** a JSON array of denied paths in `user.json`.
Rejected because policy rules benefit from comments, and embedding them in JSON would be syntactically awkward.
The separate file also allows independent version control.

## Design Decision 3: Read-Only Mounts as Initial Default

**Decision:** all user mounts are read-only with no `writable` option in the initial implementation.
A future iteration may introduce `writable: true` opt-in.

**Rationale:** user mounts are injected into every container without project-level review.
Starting from maximum restriction is the correct security posture.
Loosening a constraint is easier to justify and less disruptive than tightening one after adoption.

**Tradeoff:** users who need a writable shared directory (e.g., build cache) must use project-level mounts with `settings.json` overrides.
This is a known friction point that can be addressed later.

## Design Decision 4: Two-Layer Git Identity (User Default + Project Override)

**Decision:** `user.json` provides the default git identity, written to `~/.gitconfig` by the fundamentals init script.
Projects override via git's native `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` environment variables in their `containerEnv`.

**Rationale:** the original proposal treated git identity as personal and non-overridable.
The project owner pointed out that developers often have multiple identities (personal email for open source, work email for employer projects).
Git natively supports this via `GIT_CONFIG_*` env vars (since git 2.31) and `includeIf` directives.

The `GIT_CONFIG_*` approach is preferred because:
1. It uses git's own mechanism, requiring no custom code.
2. It works at runtime without modifying files.
3. `containerEnv` is the natural place for project-specific configuration in devcontainers.
4. It takes precedence over `~/.gitconfig` in git's resolution order.

**Alternative considered:** git's `includeIf.gitdir` directive.
This requires writing files inside the container, is harder to debug, and adds complexity to the init script.
`GIT_CONFIG_*` env vars achieve the same result more simply.

**Alternative considered:** a dedicated `lace-git-identity` feature.
The project-aware identity mechanism is lightweight (fewer than 20 lines in the init script) and does not warrant a separate feature lifecycle.
If multi-repo workspaces with per-repo identity requirements emerge, extraction would be warranted.

## Design Decision 5: No `.gitconfig` Host Mount

**Decision:** git identity is configured via environment variables and a clean in-container `~/.gitconfig`, never by mounting the host's `~/.gitconfig`.

**Rationale:** host `~/.gitconfig` commonly contains dangerous entries:
- `credential.helper` entries that grant push access to all configured remotes.
- `url.*.insteadOf` rewrites that redirect to authenticated endpoints.
- `gpg.program` and `user.signingkey` references.
- `sendemail.*` SMTP credentials.

Stripping dangerous config from `.gitconfig` is fragile due to `includeIf` directives, multiple `[credential]` sections, and tool-specific extensions.
The env var approach provides identity without any credential exposure.

## Design Decision 6: Feature Mount Requests for Dotfiles and Screenshots

**Decision:** the fundamentals feature declares `dotfiles` and `screenshots` as requested mounts in `customizations.lace.mounts`, using the same pattern as `claude-code` (config mount) and `neovim` (plugins mount).

**Rationale:** the project owner identified that lace features can request mounts as dependencies.
This is the established pattern: features declare what they need, lace prompts the user when a source is not configured, and the user decides how to provide it.

For dotfiles, this means the user chooses whether to point to a local checkout or configure a `repoMount` for automatic git cloning.
For screenshots, `user.json` provides the source via its mounts section, and the feature's mount declaration ensures lace validates the configuration.

**Previous approach:** dotfiles came from `repoMounts` only, screenshots from `user.json` mounts only, and the feature consumed them at runtime without declaring them.
This was fragile because lace had no way to prompt the user for missing configuration.

## Design Decision 7: Hardcoded Chezmoi

**Decision:** chezmoi is the only supported dotfiles manager in the fundamentals feature.

**Rationale:** chezmoi is the most widely adopted declarative dotfiles tool and the only one used by the team.
Supporting alternative managers (GNU Stow, yadm, dotbot) would add option complexity, conditional install logic, and test matrix expansion for no current demand.

**Future path:** a `dotfilesManager` option with `chezmoi` (default), `stow`, `yadm` values could be added if demand emerges.
The decomposed step script structure (`steps/chezmoi.sh`) makes this straightforward: add `steps/stow.sh`, `steps/yadm.sh`, and conditionally source the right one.

## Design Decision 8: Decomposed Install Script

**Decision:** the fundamentals feature's `install.sh` is a thin orchestrator that sources per-component step scripts from a `steps/` directory.

**Rationale:** a monolithic install script spanning SSH hardening, chezmoi installation, git identity, shell configuration, and core utilities becomes difficult to read, test, and modify.
Per-component scripts:
- Are independently readable (each file is one concern).
- Can be tested in isolation (source a step script in a test harness).
- Make it clear which step failed when debugging build errors.
- Simplify future additions (add a new step file, source it in the orchestrator).

**Tradeoff:** slightly more complex directory structure.
This is negligible given the benefits.

## Design Decision 9: Minimal Staples List

**Decision:** the fundamentals feature installs `curl`, `jq`, and `less` as core utilities.

**Rationale:** these three tools are commonly assumed by developer workflows and scripts, and some minimal base images omit them.
- `curl`: needed for chezmoi installation and general API work.
- `jq`: ubiquitous for JSON processing in shell scripts.
- `less`: standard pager (some minimal images only have `more`).

**Excluded:**
- `coreutils`: assumed present in all supported base images (Debian, Ubuntu, Alpine).
- `git-delta`, `lazygit`: git ergonomics are user preferences, not fundamentals. Belong in `user.json` features.
- `gcc`, `make`, build tools: project-specific, belong in project features or base images.
- `sudo`: typically included in devcontainer base images already.

**Tradeoff:** the staples list may be too minimal for some workflows.
Users can add tools via `user.json` features or project-level feature declarations.
The fundamentals feature should not become a "kitchen sink."

## Design Decision 10: Paths Outside $HOME Allowed

**Decision:** user mount sources can be any valid path on the host, not restricted to `$HOME`.

**Rationale:** the project owner identified legitimate use cases for mounting paths outside the home directory (e.g., `/tmp/shared_data`, `/opt/datasets`).
The mount policy protects dangerous paths regardless of location.
The default policy already blocks `/var/run/docker.sock` and `/run/docker.sock` as examples of dangerous non-home paths.

**Tradeoff:** wider attack surface in theory, but the mount policy provides equivalent protection.
The home directory constraint was defense-in-depth without a clear security benefit over the policy.

## Qualitative Assessment

The overall approach is sound: two complementary systems (user config for preferences, fundamentals feature for container-side consumption) with clear separation of concerns.

**Strengths:**
- Security-by-default with user-controlled escape hatches (mount policy, writable opt-in later).
- Git's native mechanisms (`GIT_CONFIG_*`, `~/.gitconfig`) rather than custom abstractions.
- Consistent use of lace's feature mount request pattern.
- Decomposed install script for maintainability.
- Graceful degradation when `user.json` is absent.

**Risks:**
- The mount policy file format is yet another config file to learn. Mitigation: familiar `.gitignore` semantics.
- `GIT_CONFIG_*` env vars require git 2.31+. Mitigation: the fundamentals feature depends on the latest git feature.
- The two-layer git identity may confuse users who expect a single source of truth. Mitigation: clear documentation of precedence chain.
- Chezmoi lock-in. Mitigation: documented as a deliberate choice with a clear extension path.

**Not addressed in these proposals:**
- `lace status` surfacing of user config (open question).
- `lace user init` command for onboarding (follow-up feature).
- Migration of the current lace developer setup to `user.json` (separate follow-up task).
- `postCreateCommand` auto-injection for `lace-fundamentals-init` (follow-up concern).
