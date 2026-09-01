---
review_of: cdocs/proposals/2026-09-01-fix-blesh-user-env.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T15:10:00-07:00
task_list: devcontainer/blesh-user-env
type: review
state: live
status: done
tags: [fresh_agent, devcontainer, dotfiles, shell, runtime_validated]
---

# Review of "Fix ble.sh insane environment: $USER is empty in Lace Containers"

> BLUF: Accept. Every load-bearing claim in the proposal was verified against the live dotfiles and feature repos and holds: the Option A guard lands before ble.sh in the real source chain, the login/non-login timing argument is correct, and `${USER:-$(id -un)}` is the right form for both unset and empty.
> One non-blocking substance point: Option B's marginal coverage is narrower than the "covers ALL Lace containers and ALL users" framing implies, because the login shells where B fires are largely the same shells where `$USER` is already populated by PAM.
> Frontmatter and conventions are clean.

## Summary Assessment

The proposal diagnoses a cosmetic-but-persistent ble.sh warning (`insane environment: $USER is empty`) as a non-login shell-entry defect and fixes it with defense-in-depth: a correctly-timed dotfiles `dot_bashrc` guard (A, primary) plus a systemic `/etc/profile.d` guard emitted by `lace-fundamentals` (B, backstop).
The research quality is high. I independently confirmed the source-chain line numbers, the ble.sh sanity block, the feature structure, and the `bash-history` profile.d precedent. Nothing was taken on faith and nothing was found wrong on the critical path.
The one finding worth a reviewer's attention is that the prose oversells Option B's real-world coverage delta; this is non-blocking because A alone fully resolves the reported symptom and the proposal is elsewhere honest that B does not fire in the reproduction path.

Verdict: **Accept**, with the nits below to be cleared in this accepting round.

## Verification Log (claims checked against live repos)

1. **A lands before ble.sh (VERIFIED).** `dot_bashrc` non-interactive guard is lines 1-4, tmux launch 7-9, the early-exports block (`LANG` through `BLESH_DIR`) is lines 11-21, and `source "$BASHFILES_DIR/prompt_and_history.sh"` is exactly line 110. `prompt_and_history.sh:123` is exactly `source "$BLESH_DIR/ble.sh"`. A guard inserted after line 4 or at line 11 therefore runs before the ble.sh source. The proposal's line citations are accurate.
2. **Login vs non-login timing (SOUND).** Standard bash startup semantics: a non-login interactive shell (`bash -i`, the `podman exec` path) reads only `~/.bashrc` and does not read `/etc/profile` or `/etc/profile.d/*.sh`. The proposal's central reasoning that B cannot fire in the reproduction path, so A is required as primary, is correct.
3. **Option B home (VERIFIED).** `lace-fundamentals` has a real `steps/` structure (`staples.sh`, `chezmoi.sh`, `git-identity.sh`, `shell.sh`) sourced in order from `install.sh`; `devcontainer-feature.json` `version` is `2.0.0` as stated. `bash-history/install.sh` is the genuine in-repo precedent for the idempotent, root-owned, `0644` `/etc/profile.d/*.sh` + best-effort `chown "$_REMOTE_USER"` idiom the proposal mirrors. The proposed step wiring is faithful to the existing pattern.
4. **`${USER:-$(id -un)}` form (CORRECT).** `:-` expands on both unset and empty, matching `[[ ! ${USER-} ]]` (true when unset OR empty) and ble.sh's own self-heal. Scope is correctly held to `$USER`; `$HOME`/`$HOSTNAME` self-heal quietly and are excluded.
5. **Reproduction validity (VERIFIED).** ble.sh is installed at `~/.local/share/blesh/ble.sh`; the `$USER` sanity block is at lines 1008/1012 (`insane environment: $USER is empty` / `modified USER=`). `env -u USER bash -i -c ...` is a valid surfacing of the warning. The `blesh` install-path and chezmoi `run_once_before_20` short-circuit claims are both accurate.

## Section-by-Section Findings

### BLUF, Summary, Objective
Clear and accurate. The BLUF correctly separates the primary (A) from the systemic complement (B) and names the reproduction path. No issue.

### Background (root cause + bash-history exoneration)
Strong. The closed-loop dismissal of the bash-history feature is correct: `bash-history/install.sh` only writes `HISTFILE` env and a migration snippet, never touches `$USER`. The ble.sh sanity-block quote matches the installed source. Non-blocking nit: the block is cited as `ble.sh:1006-1014` and `$HOME` as `ble.sh:1027`; the installed file puts the `$USER` line at 1008 and the `$HOME` line at 1029. Trivial, and the cited USER range brackets the real location.

### Proposed Solution + Design Decisions
The A/B split, the rejection of Option C (`containerEnv.USER: node` hardcodes the user), and the `lace-fundamentals`-over-`blesh` choice are all well-argued. The `blesh`-alternative NOTE is a good decoupled-commentary example.

**Non-blocking (substance):** The claim that B "covers ALL Lace containers and ALL users" overstates B's marginal contribution to *actually-broken* shells. B fires only in login shells, but login shells reached through real `login`/PAM/sshd already have `$USER` set by that mechanism, which is exactly why they never trip the warning. B's genuine coverage delta is therefore the narrow set of *login shells launched outside PAM*, e.g. `podman exec -it <c> bash -l`. That is a real case, so B is not vacuous, but the honest scope is narrower than the prose implies. Recommend tempering the "ALL ... ALL" framing with a one-line NOTE stating B's real delta is exec-launched (non-PAM) login shells.

### Edge Cases
Thorough and honest, including the `id`-unavailable degradation ("no worse than status quo") and the tmux re-exec analysis. The tmux reasoning is correct: the outer shell blocks on `tmux` before reaching line 110, and each inner pane shell re-sources `dot_bashrc`, so a guard at line 11 covers the pane shells that actually emit the warning; placing it before the tmux launch additionally seeds the tmux server's environment.

### Test Plan / Verification Methodology
Meets the bar: concrete before/after failure pictures, a valid reproduction command, and an isolation test for B in a login shell. No issue.

### Implementation Phases
Independent, well-scoped, with explicit constraints (do not edit deployed `~/.bashrc`, do not touch `bash-history`/`blesh`, no `containerEnv.USER`). Two minor points below.

## Action Items

1. [non-blocking] Temper the Option B coverage framing: add a one-line NOTE that among login shells most already have `$USER` set by PAM, so B's real coverage delta is exec-launched (non-PAM) login shells, not "ALL users."
2. [non-blocking] Fix the ble.sh line citations to match the installed source (`$USER` at 1008, `$HOME` at 1029), or soften to "circa 1008."
3. [non-blocking] Phase 2 says to source the new step "after `steps/staples.sh`." Since the profile.d guard only writes a file at build time and executes at shell runtime, it has no build-time dependency on staples (`id` presence is a runtime concern); state that the ordering is cosmetic, or drop the rationale.
4. [non-blocking] Resolve the Open Question on the version bump now rather than deferring: adding a backwards-compatible step is a semver minor, so `2.0.0` to `2.1.0`. Confirm against the repo convention and state the target version in Phase 2.

## Questions for the Overseer / Author (decisions, not blockers)

Given A alone fully silences the reported warning on the failing path, and B's verified marginal coverage is the narrow "exec-launched login shell" case, how should Phase 2 proceed?

- **(a)** Ship A+B as written. B is cheap defense-in-depth and the class-of-problem framing justifies the small feature-surface cost. (Proposal's recommendation.)
- **(b)** Ship A now (Phase 1), and demote Phase 2 to a `future_work`-tagged follow-up to be picked up only if an exec-launched login shell actually surfaces an empty `$USER`. Avoids a feature version bump for a narrow case.
- **(c)** Keep A+B but move B into the `blesh` feature (symptom co-location) to avoid touching the baseline `lace-fundamentals` feature. Trades breadth for a smaller blast radius.

My recommendation: **(a)** is acceptable as-is given the low cost and honest framing; **(b)** is the more scope-disciplined choice if the overseer wants to avoid a feature bump for narrow marginal value. Either is defensible. This does not gate acceptance.
