---
review_of: cdocs/proposals/2026-09-01-fix-blesh-user-env.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-01T14:33:00-07:00
task_list: devcontainer/blesh-user-env
type: review
state: live
status: done
tags: [fresh_agent, devcontainer, dotfiles, shell, runtime_validated, implementation_review]
---

# Review: ble.sh `$USER` guard implementation (A+B)

> BLUF: Accept.
> Both phases implement the accepted A+B design faithfully and correctly.
> I independently reproduced the verification floor under a real pty: guard-absent trips `ble.sh: insane environment: $USER is empty`, guard-present (deployed `~/.bashrc`) is silent with `$USER` non-empty.
> I also empirically confirmed impl-1's methodology warning: `bash -i -c` is a false-negative repro (no warning even with the guard absent), which means the proposal's own Test Plan repro is invalid - the only non-blocking substantive finding.

## Summary Assessment

The work fixes the cosmetic-but-persistent `ble.sh: insane environment: $USER is empty` warning that fires on every interactive prompt in Lace containers entered via non-login `podman exec`.
Phase 1 (dotfiles) adds `export USER="${USER:-$(id -un)}"` to `dot_bashrc` before the ble.sh source chain; Phase 2 (lace-fundamentals feature) emits an idempotent `/etc/profile.d/05-lace-user-env.sh` as a systemic backstop.
Quality is high: both commits are targeted, static checks are clean, idempotency holds, and the runtime floor is empirically satisfied.
Verdict: **Accept**. No blocking findings.

## Verification Floor (independently re-run)

Reproduced on this host, whose `~/.bashrc` is the deployed Phase 1 artifact and whose `~/.local/share/blesh/ble.sh` carries the identical sanity-check block (`ble.sh:1008`).
The mechanism (non-login shell, `$USER` unset, dotfiles chain sources ble.sh) is identical to the container; only `id -un` differs (`mjr` here vs `node` in-container).
tmux auto-launch was suppressed with `TERM=screen` to isolate the ble.sh path (see Finding NB-2 for why this is faithful).

**Methodology check - `bash -i -c` is a FALSE NEGATIVE (confirms impl-1's claim):**
```
$ env -u USER bash --rcfile <guard-absent-rcfile> -i -c 'echo "USER=[$USER]"'
USER=[]
```
No warning, `$USER` empty. ble.sh early-returns on `BASH_EXECUTION_STRING`, so it never reaches `check-environment`. Any repro using `bash -i -c` proves nothing.

**BEFORE (guard-absent rcfile, real pty):**
```
$ printf 'echo "MARK:USER=[$USER]"; exit\n' > cmds.txt
$ env -u USER TERM=screen script -qec "bash --rcfile ./bashrc_noguard -i" /dev/null < cmds.txt
ble.sh: insane environment: $USER is empty.  Please consider checking the
ble.sh: modified USER=mjr
...
MARK:USER=[mjr]
```
(`bashrc_noguard` is the deployed `~/.bashrc` with the single guard line removed via `grep -vF`.)

**AFTER (deployed `~/.bashrc` with guard, real pty):**
```
$ env -u USER TERM=screen script -qec "bash --rcfile $HOME/.bashrc -i" /dev/null < cmds.txt
...
MARK:USER=[mjr]
```
No `insane environment` line on stderr; `$USER` resolves non-empty. Floor satisfied.

## Section-by-Section Findings

### Phase 1: dotfiles guard (`dot_bashrc` -> `~/.bashrc:15`)

Correct and deployed.
Guard at line 15 precedes the ble.sh source chain (`~/.bashrc:116` -> `prompt_and_history.sh:123`): confirmed by line-number inspection of the deployed file.
`${USER:-$(id -un)}` uses the colon form, so it triggers on BOTH unset and empty `$USER` (verified empirically: sourcing with `USER=''` still resolves to `id -un`).
Commit `fc977bd` touches only `dot_bashrc` (6 insertions, guard + explanatory comment). No stray changes.

### Phase 2: lace-fundamentals feature (commit `43e330f`)

Statically correct.
- `sh -n` clean on both `install.sh` and `steps/user-env.sh`.
- `install.sh` sources the new step (`. "$SCRIPT_DIR/steps/user-env.sh"`, line 15).
- Written snippet content is exactly `export USER="${USER:-$(id -un)}"`, mode `0644`.
- The heredoc delimiter is single-quoted (`<<'PROFILE_EOF'`), so the guard is written literally and NOT expanded at build time. This is essential: an unquoted heredoc would bake in the build-time user (root). Correct.
- Idempotency verified: sourcing with `USER=preset` leaves `preset` intact; unset/empty resolve to `id -un`.
- Version bumped `2.0.0` -> `2.1.0` (MINOR, backwards-compatible step add). Diff is the version line only.
- README step list updated four -> five with an accurate description.
- `chown` is `_REMOTE_USER`-gated and best-effort (`2>/dev/null || true`); runs under `install.sh`'s `set -eu` without unbound-variable risk (`_REMOTE_USER` defaults to `root`).

Full container build is legitimately deferred to follow-up; static correctness is sufficient for accept, and the profile.d snippet's runtime behavior was confirmed by direct sourcing.

### Scope and regressions

Scope is held to `$USER` only, as the proposal constrains.
No regression surface: the guard is a no-op when `$USER` is already set (login/PAM/sshd shells, or a deliberately-set value), correct for root (`id -un` = `root`), and no worse than status quo if `id` were absent (empty stays empty). Option C (`containerEnv.USER`) was correctly not used.

## Non-Blocking Findings

- **NB-1 (proposal doc defect, not implementation):** The proposal's Test Plan and Verification Methodology both prescribe `env -u USER bash -i -c '...'` as the repro. I proved this is a false negative: it does not surface the warning even with the guard absent. The implementation is unaffected (impl-1 used the valid pty repro), but the proposal doc will mislead future readers. Recommend correcting the proposal's Verification Methodology to the pty form, or adding a `NOTE()` callout. This does not block acceptance of the implementation.
- **NB-2 (placement vs tmux):** The Phase 1 guard landed at `dot_bashrc:15`, AFTER the tmux auto-launch (lines 7-9) - the proposal's "acceptable alternative", not its "preferred" placement (before tmux, so the tmux server inherits `$USER`). This is functionally sufficient to silence the warning: if tmux launches, the outer shell never reaches the ble.sh source (line 116) while tmux runs, and each inner pane shell re-runs `dot_bashrc`, skips the tmux block (`TERM=~screen/tmux`), and hits the guard before ble.sh. The only unrealized benefit is a populated `$USER` in the tmux server's own environment. Consistent with the proposal's tmux edge-case note; flagging only so the tradeoff is on record.
- **NB-3 (filename divergence, an improvement):** The proposal names the snippet `/etc/profile.d/lace-user-env.sh`; the implementation uses `05-lace-user-env.sh`. The numeric prefix gives deterministic sourcing order among profile.d scripts and is the better choice. The step file documents itself, but the proposal was not annotated with the rename. Cosmetic.

## Verdict

**Accept.**
The A+B design is implemented faithfully, statically correct, idempotent, and empirically verified against the runtime floor. Findings NB-1..NB-3 are non-blocking.

## Action Items

1. [non-blocking] Correct the proposal's Test Plan / Verification Methodology: replace the false-negative `bash -i -c` repro with the pty-driven form, or add a `NOTE()` documenting that `bash -i -c` does not trip the warning (ble.sh early-returns on `BASH_EXECUTION_STRING`).
2. [non-blocking] Optionally move the `dot_bashrc` guard above the tmux launch (lines 7-9) so the tmux server itself inherits a populated `$USER`; not required to silence the warning.
3. [non-blocking] When the Phase 2 container build is run in follow-up, confirm end-to-end that a freshly built `lace-fundamentals` container emits `/etc/profile.d/05-lace-user-env.sh` at mode `0644` and populates `$USER` in a login shell.

## Question for the overseer

The one substantive finding (NB-1) is against the already-accepted proposal doc, not the implementation. How should it be routed?

- (a) Accept the implementation as-is now; open a trivial follow-up to correct the proposal's Verification Methodology.
- (b) Accept the implementation and correct the proposal's methodology inline in this same loop before closing.
- (c) Treat it as out of scope for this implementation loop and leave the proposal doc as historical record.

Recommendation: (a) or (b). The implementation is sound regardless.
