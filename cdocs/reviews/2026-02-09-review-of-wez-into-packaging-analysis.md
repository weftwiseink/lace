---
review_of: cdocs/reports/2026-02-09-wez-into-packaging-analysis.md
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-09T12:30:00-08:00
task_list: lace/wezterm-plugin
type: review
state: live
status: done
tags: [self, packaging, nushell, chezmoi, distribution, vendor_autoload, practical_feasibility]
---

# Review: Packaging Analysis -- `wez-into` as a Standalone Distributable Tool

## Summary Assessment

This report investigates packaging options for `wez-into` as a standalone distributable CLI tool, covering nushell's packaging ecosystem (nupm, vendor autoload, overlays, directory modules), chezmoi external mechanisms, hybrid bash/nushell distribution patterns, and tab completion distribution. The analysis is thorough, well-sourced, and clearly structured with per-option verdicts. The recommendation (Option 2: standalone git repo + chezmoi externals + vendor autoload) is well-justified and practically achievable with the existing infrastructure.

The most valuable insight is the vendor autoload mechanism for nushell, which cleanly solves the parse-time `source` problem that would otherwise make a fresh machine bootstrap fragile. The most important gap is the absence of analysis around what happens to the nushell `wez-into.nu` file semantics when loaded via `source` (vendor autoload) instead of `use` -- this affects whether `export` keywords are needed and how subcommand namespacing works.

**Verdict: Accept** with non-blocking suggestions.

## Section-by-Section Findings

### BLUF

The BLUF says "nushell directory module" but the body of the recommendation says "single `.nu` file." The BLUF should say "nushell module" (without "directory") to match the recommendation, since the Directory Modules subsection explicitly concludes that directory modules are overkill.

- **Category:** Non-blocking
- **Suggestion:** Change "nushell directory module" to "nushell module" in the BLUF.

### Research Findings: Vendor Autoload

The report correctly identifies vendor autoload as the best loading mechanism and notes that files are "sourced (not `use`d), so `export` is not required for top-level commands." This is a critical detail for the implementation.

However, the existing nushell code in the wez-into proposal uses `export def` for all public commands (e.g., `export def "wez-into discover"`) because the proposal assumed the module would be loaded via `use scripts/wez-into.nu *`. When loaded via vendor autoload (`source`), the `export` keyword is benign but unnecessary. More importantly, the subcommand pattern `def "wez-into discover"` creates a command literally named `wez-into discover` in the global scope. With `use`, the module namespace controls visibility. With `source`, everything goes into the global scope directly. The report should note this behavioral difference and confirm that it is acceptable.

Additionally, the report claims vendor autoload files are "silently skipped if absent." This is true for the directory -- nushell will not error if the autoload directory is empty. But if the symlink exists and points to a nonexistent target (dangling symlink), nushell's behavior is less clear. The `run_once` script only creates the symlink after the chezmoi external clones, so in practice this should not happen, but the ordering guarantee between chezmoi externals and `run_once` scripts deserves a sentence.

- **Category:** Non-blocking
- **Suggestion:** Add a note about `source` vs `use` implications for the nushell module's command definitions. Confirm that `def "wez-into"` and `def "wez-into list"` work correctly when sourced into the global scope. Also note that chezmoi processes externals before `run_once_after_` scripts, so the ordering is safe.

### Research Findings: Hybrid Bash + Nushell (Pattern B)

The report recommends Pattern B (independent implementations) and notes the logic is "thin enough that dual implementations are not burdensome." This is a reasonable judgment for the current scope, but the report could strengthen it by noting the concrete line counts: the bash implementation in the proposal is ~260 lines, and the nushell implementation is ~110 lines. These are small enough to maintain in parallel, especially since the core logic (call discover, match project, call wezterm connect) is identical.

- **Category:** Non-blocking
- **Suggestion:** Add concrete line counts to support the "thin enough" claim.

### Options Analysis: Option 1 (Embed in Dotfiles)

The report lists a con: "Nushell module requires a `source` line in `config.nu` (parse-time dependency)." This is accurate under the original proposal's design, but the vendor autoload mechanism discovered in this report could also be applied to Option 1. The dotfiles repo could place the `.nu` file directly in the vendor autoload directory (chezmoi source path: `dot_local/share/nushell/vendor/autoload/wez-into.nu`). This would eliminate the parse-time dependency concern for Option 1 as well.

This weakens one of the stated cons for Option 1 and strengthens the case that the choice between Option 1 and Option 2 is primarily about reusability and separation of concerns, not about nushell loading mechanics.

- **Category:** Non-blocking
- **Suggestion:** Note that vendor autoload can be used with Option 1 too, so the comparison is cleanly about reusability vs simplicity.

### Recommendation: run_once Script Ordering

The `run_once_after_50-link-wez-into.sh` script depends on the chezmoi external having already cloned the repo. Chezmoi's documented behavior is that externals are processed during `chezmoi apply` before `run_after_` scripts, which makes this safe. The report does not explicitly state this ordering guarantee.

- **Category:** Non-blocking
- **Suggestion:** Add a sentence confirming that chezmoi processes `.chezmoiexternal` entries before `run_once_after_` scripts, so the symlink script is guaranteed to find the cloned repo.

### Recommendation: lace-discover Symlink Fragility

The `run_once_after_51-link-lace-discover.sh` script searches for `lace-discover` at two hardcoded paths. The report correctly notes in Open Question 3 that `lace-discover` could be extracted if more tools depend on it. However, the `run_once` script is hash-based: it runs once per unique content. If the lace repo moves, the symlink breaks and the script does not re-run (because its content has not changed). A `run_onchange` approach or checking the symlink target on every apply would be more robust.

- **Category:** Non-blocking
- **Suggestion:** Consider using `run_after_` (runs every apply) instead of `run_once_after_` for the lace-discover symlink, since the target path may change. The overhead of re-symlinking on every `chezmoi apply` is negligible.

### Open Questions

The three open questions are well-chosen. Open Question 1 (full nushell vs extern-only) is the most impactful design decision and the report correctly recommends deferring it. Open Question 2 (GitHub organization) is a naming/organizational concern that does not affect the technical approach.

One additional open question worth surfacing: **What happens on a machine where the lace repo is not cloned?** The `wez-into` bash script has fallback paths for finding `lace-discover`, and the `run_once` symlink script silently skips if lace-discover is not found. But the nushell module calls `lace-discover` directly. If `lace-discover` is not on PATH, the nushell module will produce an error at runtime (not at load time, since vendor autoload just defines commands). This is acceptable behavior but worth documenting.

- **Category:** Non-blocking
- **Suggestion:** Add an open question or note about the behavior when `lace-discover` is unavailable: the bash script has fallback paths; the nushell module relies on PATH. Both fail gracefully at runtime with an error message, which is the correct behavior.

## Verdict

**Accept.** The report is thorough, practically grounded, and arrives at a well-reasoned recommendation. The vendor autoload discovery is the key contribution that makes Option 2 significantly cleaner than the original proposal's `source` approach. All suggestions above are non-blocking refinements.

## Action Items

1. [non-blocking] Fix BLUF: change "nushell directory module" to "nushell module" (the recommendation is a single file, not a directory module).
2. [non-blocking] Add a note in the vendor autoload section about `source` vs `use` implications for command definitions and confirm subcommand namespacing works correctly in global scope.
3. [non-blocking] Confirm chezmoi external-before-run_once_after ordering guarantee in the recommendation section.
4. [non-blocking] Note that Option 1 could also use vendor autoload, making the Option 1 vs Option 2 comparison cleanly about reusability.
5. [non-blocking] Consider `run_after_` instead of `run_once_after_` for the lace-discover symlink to handle repo path changes.
6. [non-blocking] Add concrete line counts (bash ~260, nushell ~110) to support the "thin enough for dual implementation" claim.
7. [non-blocking] Add a note or open question about behavior when `lace-discover` is not available on the machine.
