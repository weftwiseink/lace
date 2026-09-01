---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T10:30:00-07:00
task_list: devcontainer/blesh-user-env
type: devlog
state: live
status: done
tags: [devcontainer, dotfiles, shell]
---

# Devlog: ble.sh `$USER` guard iterate loop

> BLUF(claude-opus-4-8/blesh-user-env): Implement-review loop for `cdocs/proposals/2026-09-01-fix-blesh-user-env.md` (accepted, `implementation_ready`).
> Scope: both phases. Phase 1 = dotfiles `dot_bashrc` `$USER` guard (primary, non-login path). Phase 2 = `lace-fundamentals` `/etc/profile.d` guard (systemic backstop).

## Brief (Turn 0)

**Proposal:** `cdocs/proposals/2026-09-01-fix-blesh-user-env.md` (A+B defense-in-depth, accepted R1).

**Scope:** full proposal, both phases.
- Phase 1 (dotfiles repo `/home/mjr/code/personal/dotfiles`): add `export USER="${USER:-$(id -un)}"` to `dot_bashrc` early-exports block (before line 110, where the fragments that source ble.sh are sourced).
- Phase 2 (lace repo, this worktree): add `devcontainers/features/src/lace-fundamentals/steps/user-env.sh` writing `/etc/profile.d/*.sh` with the same guard; source it from `install.sh`; bump feature `2.0.0` → `2.1.0`.

**Verification floor:** After Phase 1, a fresh non-login interactive shell with `USER` unset, reproducing the `podman exec` launch path via `env -u USER bash --rcfile <deployed ~/.bashrc> -i -c 'exit'`, prints NO `ble.sh: insane environment: $USER is empty` line on stderr, and `$USER` resolves non-empty after the bash config loads.
Failure picture: the warning still prints, or `$USER` is empty after the config sources ble.sh.
For Phase 2, the profile.d guard file passes `sh -n` and contains the exact guard; empirical container/login-shell verification is a `deferred-to-followup` (needs a live container rebuild).

## Iteration Log

| iteration | implementer | reviewer | review_verdict | review_proof | review_path | overseer_ctx_est | inline_work | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | impl-1 (general-purpose) | rev-1 (cdocs:reviewer) | accept | confirmed | cdocs/reviews/2026-09-01-review-of-blesh-user-env-impl.md | ~90K (light inline: devlog only) | no | Both phases first-pass accept. rev-1 independently reproduced before/after under a real pty; warning present guard-absent, gone guard-present, `$USER` non-empty. Phase 2 container build deferred-to-followup. |

## Judge Log

| judge_iteration | trigger | verdict | overseer_thinness | rationale | judge_path |
|---|---|---|---|---|---|

No judge invoked: the loop accepted on iteration 1, far short of `--judge-after` (3). Overseer stayed thin (dispatched propose/review/implement; only devlog bookkeeping inline).

## Dispatch/Return Events

| event | agent_handle | target_files | at | notes |
|---|---|---|---|---|
| dispatch | impl-1 (general-purpose) | dotfiles:`dot_bashrc`; lace:`devcontainers/features/src/lace-fundamentals/{steps/user-env.sh,install.sh,devcontainer-feature.json}` | 2026-09-01T10:35:00-07:00 | impl-1 owns both phases; two-repo write claim |
| return | impl-1 (general-purpose) | (as above) | 2026-09-01T10:41:00-07:00 | done. dotfiles `fc977bd`, lace `43e330f`. Empirical floor met via `script` pty repro (bash -i -c can't trip warning: ble.sh early-returns on BASH_EXECUTION_STRING). Phase 2 static-verified; container build deferred-to-followup. |
| dispatch | rev-1 (cdocs:reviewer) | (read-only; may write `cdocs/reviews/2026-09-01-review-of-blesh-user-env-impl.md`) | 2026-09-01T10:42:00-07:00 | fresh R1 reviewer; re-runs Phase 1 floor independently |
| return | rev-1 (cdocs:reviewer) | `cdocs/reviews/2026-09-01-review-of-blesh-user-env-impl.md` | 2026-09-01T10:49:00-07:00 | ACCEPT, no blockers. `review_proof: confirmed` (independent pty before/after). Review commit `7e01437`. 3 non-blocking nits (NB-1 proposal repro false-negative, NB-2 tmux placement info-only, NB-3 filename). |
| dispatch | reviser (resumed proposer) | `cdocs/proposals/2026-09-01-fix-blesh-user-env.md` | 2026-09-01T10:50:00-07:00 | clear accept-round NB-1/NB-3, flip status → implementation_accepted |
| return | reviser (resumed proposer) | `cdocs/proposals/2026-09-01-fix-blesh-user-env.md` | 2026-09-01T10:52:00-07:00 | done. Commit `ab960a0`. NB-1 repro corrected + NOTE; NB-3 filename annotated; status → implementation_accepted. |

## Overseer Synthesis

> BLUF(claude-opus-4-8/blesh-user-env): Fix accepted first-pass. Root cause was environmental, not a lace regression: non-login `podman exec` shells never set `$USER`, so ble.sh's sanity check fired. The bash-history feature was coincidental (touched `prompt_and_history.sh`, sets only `HISTFILE`).

**Shipped (branch `fix-blesh-user-env`, two repos):**
- Phase 1 (primary, dotfiles `fc977bd`): `export USER="${USER:-$(id -un)}"` in `dot_bashrc` early-exports, before the ble.sh source chain. Only path guaranteed to run before ble.sh in the non-login interactive case.
- Phase 2 (backstop, lace `43e330f`): `lace-fundamentals` writes `/etc/profile.d/05-lace-user-env.sh` with the same guard; feature `2.0.0`→`2.1.0`. Covers containers/users without these dotfiles (non-PAM login shells).

**Verification:** floor met and independently confirmed. Notable finding: the obvious `bash -i -c` reproduction is a false negative (ble.sh early-returns on `BASH_EXECUTION_STRING`); a real-pty (`script`) reproduction is required. Guard-absent → warning appears; guard-present → warning gone, `$USER` non-empty.

**Deferred to follow-up:** Phase 2 in-container/login-shell verification via a real feature build + container rebuild. Static correctness (`sh -n`, snippet content/mode, idempotency, install.sh wiring, version) confirmed; the empirical login-shell path is unverified until a rebuild.

## Handoff

**Completed:** Both phases implemented, reviewed (accept, no blockers), committed on `fix-blesh-user-env` in lace and dotfiles. Proposal `implementation_accepted`; two reviews and this devlog on the lace branch.

**Decisions Made:** A+B defense-in-depth (A alone fixes the reported non-login path; B is the no-dotfiles backstop). Guard scoped to `$USER` only (HOSTNAME/HOME self-heal silently, unreported). Phase 2 home = `lace-fundamentals` (general env hygiene, always installed) over the `blesh` feature (symptom co-location). profile.d named `05-lace-user-env.sh` for ordering.

**Open Todos:** (1) Merge/PR both branches (lace + dotfiles) — awaiting user. (2) Rebuild a lace container to empirically confirm Phase 2's login-shell path (the deferred-to-followup floor). (3) Republish the `lace-fundamentals` feature at `2.1.0` if features are published to GHCR.
