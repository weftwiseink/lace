---
review_of: cdocs/proposals/2026-02-05-dotfiles-firefox-chezmoi-migration.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T13:30:00-08:00
task_list: lace/dotfiles-migration
type: review
state: live
status: done
tags: [self, chezmoi, firefox, template-correctness, edge-case-validation]
---

# Review: Dotfiles Firefox Chezmoi Migration

## Summary Assessment

The proposal presents a well-reasoned approach to managing Firefox's custom chrome CSS through chezmoi, choosing a symlink-indirection strategy over the more aggressive `profiles.ini` templating approach. The Background section is thorough and the design decisions are well-justified with clear rationale. However, the `run_onchange_` script has a critical template rendering bug: the `{{ include ... }}` directive for `profiles.ini` will cause chezmoi to fail entirely on systems where Firefox has not been run yet, defeating the script's own guard clause. Additionally, there are minor factual inaccuracies in asset counts. Verdict: **Revise** -- the template rendering issue must be addressed before this is implementable.

## Section-by-Section Findings

### BLUF

The BLUF is clear, specific, and accurately represents the proposal's approach. It correctly describes the intermediate path strategy, references the chezmoi issue, and sets appropriate expectations. The phrase "one-time symlink" is slightly misleading since the script uses `run_onchange_` (which can run multiple times), but the semantic intent is correct -- the symlink is established once and maintained.

**Non-blocking.** Consider rewording "one-time symlink" to "scripted symlink" for precision.

### Background

Thorough and well-grounded in actual system investigation. The profile structure, existing symlink chain, and file inventory are documented from observed state rather than assumptions. The comparison of community approaches from issue #1226 is concise and covers the relevant strategies.

One factual inaccuracy: the Objective says "27 SVG/image files" and the Background says "26 SVG files for KDE Breeze window button states." The actual count is 24 Breeze SVGs plus 1 `firefox_logo.svg` for 25 total.

**Non-blocking.** Correct the file counts (24 Breeze SVGs, 25 total assets).

### Proposed Solution

The approach is sound and pragmatic. The "Why Not profiles.ini Templating?" section provides strong justification for rejecting the theoretically cleaner but practically riskier alternative.

**Critical issue with the `run_onchange_` template.** The script contains:

```
# profiles.ini hash: {{ include (joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini") | sha256sum }}
```

This `include` directive executes during chezmoi's template rendering phase, before the shell script body runs. If `profiles.ini` does not exist (Firefox never launched, fresh machine, or the file is at an unexpected path), chezmoi will fail with a template error and abort the entire apply operation -- not just this script, but all subsequent scripts and file operations too.

The script's bash guard (`if [ ! -f "$PROFILES_INI" ]; then exit 0; fi`) never executes because the template fails to render in the first place.

Verified: `chezmoi execute-template '{{ include ... "NONEXISTENT" ... }}'` produces a hard error.

**Fix:** Use chezmoi's `stat` function to check file existence before including, or use a conditional template:

```
{{- $profilesIni := joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini" -}}
{{- if stat $profilesIni -}}
# profiles.ini hash: {{ include $profilesIni | sha256sum }}
{{- else -}}
# profiles.ini hash: MISSING
{{- end }}
```

This way, when `profiles.ini` is missing, the hash line renders as `MISSING` (a stable string), and the script runs with its bash-level guard handling the absent file gracefully. When `profiles.ini` changes, the hash changes and `run_onchange_` re-triggers.

**Blocking.** The template must handle missing `profiles.ini` without failing chezmoi.

### Design Decisions

All five decisions are well-reasoned. Decision 2 (`run_onchange_` vs `run_once_`) is particularly good -- the re-trigger on `profiles.ini` changes is the correct primitive. Decision 5 (after, not before) correctly identifies the ordering dependency.

One subtle interaction worth noting: Decision 2 says the script re-triggers when `profiles.ini` changes. But with the template fix above (rendering `MISSING` when the file is absent), the script will also re-trigger when `profiles.ini` is first created (transitioning from `MISSING` to a real hash). This is actually desirable behavior for the "fresh machine" story and should be called out as a benefit.

**Non-blocking.** Consider noting the `MISSING` -> real hash transition as a positive side effect in Decision 2.

### Stories

The three stories cover the primary use cases well. Story 2 (Firefox Profile Migration) correctly identifies that `run_onchange_` handles profile changes automatically via the hash trigger.

Story 3 (Cross-Platform Use) states the script template "can be extended" for macOS but does not provide the actual template conditional. Given that the user has documented macOS Firefox use (in `macos/macos.sh`), this is a known gap. The proposal appropriately defers it to Open Questions, which is acceptable for a Linux-focused initial implementation.

**Non-blocking.**

### Edge Cases

The edge case analysis is comprehensive. The "Profile Does Not Exist Yet" section correctly identifies the problem but its mitigation (documenting that `chezmoi apply` should run after Firefox first launch) is now superseded by the template fix above -- with the `stat`-based conditional, chezmoi apply works before Firefox is installed and automatically picks up the profile on re-apply.

The "Flatpak vs Native" mitigation code snippet uses hardcoded `$HOME` in the bash portion but also uses chezmoi template syntax (`{{ if eq .chezmoi.os "linux" }}`), which is correct since the script is a `.tmpl` file.

**Non-blocking.** Update the "Profile Does Not Exist Yet" section to note that the template conditional (once the blocking fix is applied) handles this case automatically rather than requiring documentation workarounds.

### Test Plan

The test plan is practical and covers the right verification points. It correctly tests idempotency and diff correctness. One gap: it does not test the "profiles.ini missing" scenario (fresh machine), which is directly related to the blocking template issue.

**Non-blocking.** Add a test step for the absent `profiles.ini` case: verify `chezmoi apply` succeeds cleanly and the script outputs the skip message.

### Implementation Phases

Three phases is appropriate for this scope. The constraints are well-specified (do not remove old `firefox/` until Phase 2 is verified). Phase dependencies are implicit but clear.

One concern: Phase 1 says to "verify file contents match originals exactly (byte-for-byte)." This is good practice, but chezmoi's own diffing (`chezmoi diff`) handles this naturally. The phrasing could be tightened to use chezmoi's built-in verification rather than implying a separate manual comparison.

**Non-blocking.**

### Open Questions

All three questions are genuine and well-framed. Open Question 3 (`toolkit.legacyUserProfileCustomizations.stylesheets`) is particularly valuable -- this preference is required for userChrome.css to work at all, and managing it via `user.js` would indeed require a different approach since `user.js` lives in the profile directory, not `chrome/`. This could be addressed by adding a second symlink target or by using the same `run_onchange_` script to write/append the `user.js` entry directly.

**Non-blocking.** Consider whether Open Question 3 should be promoted to a design decision rather than left open. The `user.js` management is orthogonal to the chrome directory approach and could be deferred cleanly, but acknowledging the decision to defer is better than leaving it as a question.

## Verdict

**Revise.** The proposal is well-constructed and the approach is sound, but the `run_onchange_` template will break chezmoi on systems without an existing Firefox profile. This is a single, well-defined fix. After addressing the blocking issue, the proposal should be ready for acceptance.

## Action Items

1. [blocking] Fix the `run_onchange_` template to use `stat` (or equivalent) to conditionally include `profiles.ini`, rendering a stable fallback string when the file is absent. The proposed fix using `{{- if stat $profilesIni -}}` is provided in the findings above.
2. [non-blocking] Correct asset file counts: 24 Breeze SVGs (not 26), 25 total assets (not 27).
3. [non-blocking] Update the "Profile Does Not Exist Yet" edge case to reference the template conditional as the primary mitigation rather than documentation.
4. [non-blocking] Add a test step for `chezmoi apply` with no `profiles.ini` present.
5. [non-blocking] Consider rewording "one-time symlink" in the BLUF to "scripted symlink" or "auto-maintained symlink."
