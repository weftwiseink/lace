---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T15:00:00-08:00
task_list: lace/dotfiles-migration
type: report
subtype: investigation
state: archived
status: done
tags: [firefox, chezmoi, template, investigation]
---

# Firefox profiles.ini Template Investigation

> BLUF: The `profiles.ini` missing-file issue flagged in the R1 review is real but not a practical problem on this system -- the file exists at `~/.mozilla/firefox/profiles.ini` with active profile data. However, it would break `chezmoi apply` on any fresh machine before Firefox is first launched. The fix is straightforward: wrap the `include` call in a `stat` guard using chezmoi's built-in `stat` template function, which returns a falsy value for missing files. This preserves the `run_onchange_` hash-trigger behavior on systems where Firefox is installed while gracefully degrading to a no-op on systems where it is not.

## Context / Background

The [Firefox chezmoi migration proposal](/var/home/mjr/code/weft/lace/cdocs/proposals/2026-02-05-dotfiles-firefox-chezmoi-migration.md) includes a `run_onchange_after_` script template with this line:

```
# profiles.ini hash: {{ include (joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini") | sha256sum }}
```

The R1 review flagged this as a blocking issue: chezmoi's `include` function errors on missing files, which would cause `chezmoi apply` to fail entirely if `profiles.ini` does not exist. This investigation determines whether the issue is practical on this system and proposes a fix.

---

## Key Findings

### 1. File Existence on This System

- **Native path (`~/.mozilla/firefox/profiles.ini`):** Exists. Contains two profiles: `10xxj5e7.default` (older, unused) and `h4hh8m1f.default-release` (active). The install ID is `CF146F38BCAB2D21`, confirming Flatpak Firefox uses the native path on this Fedora system.
- **Flatpak path (`~/.var/app/org.mozilla.Firefox/.mozilla/firefox/profiles.ini`):** Does not exist. This confirms the proposal's note that Fedora's Flatpak Firefox uses the standard native path due to broad filesystem permissions.
- **Practical impact on this system:** None. The template would render correctly today because the file exists.

### 2. Chezmoi Template Capabilities for Missing Files

Chezmoi provides the `stat` template function, which wraps Go's `os.Stat`:

- **When the file exists:** Returns a struct with `name`, `size`, `mode`, `perm`, `modTime`, `isDir`, `type` fields -- which is truthy in a template conditional.
- **When the file does not exist:** Returns a falsy value (not an error), making it safe for `{{ if stat ... }}` guards.
- **On other OS errors:** Raises a template error.

This is documented at [chezmoi.io/reference/templates/functions/stat/](https://www.chezmoi.io/reference/templates/functions/stat/).

Critically, chezmoi's `include` function has no built-in fallback for missing files -- it will error, causing the entire `chezmoi apply` to fail. There is no `includeOrDefault` or similar function.

### 3. `run_onchange_` Behavior with Empty/Whitespace Templates

Chezmoi has a useful property: if a `run_onchange_` script template resolves to only whitespace or an empty string, the script is not executed. This means a conditional template that produces no output when Firefox is absent will simply be skipped -- it will not produce an error and will not leave a stale hash in chezmoi's state database.

### 4. Scenarios Where the File Would Be Missing

| Scenario | Likelihood | Impact |
|----------|-----------|--------|
| Fresh machine, Firefox not yet installed | Medium (new machine setup) | `chezmoi apply` fails entirely |
| Fresh machine, Firefox installed but never launched | Medium | `chezmoi apply` fails (Firefox creates `profiles.ini` on first launch) |
| macOS with different Firefox path | High (if dotfiles are cross-platform) | `chezmoi apply` fails (macOS path is `~/Library/Application Support/Firefox/profiles.ini`) |
| Server/headless system without Firefox | Low (unlikely to apply full dotfiles) | `chezmoi apply` fails |

---

## Recommended Fix

Replace the current hash line:

```
# profiles.ini hash: {{ include (joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini") | sha256sum }}
```

With a `stat`-guarded conditional:

```
{{ $profilesIni := joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini" -}}
{{ if stat $profilesIni -}}
#!/bin/bash
# Link Firefox profile chrome/ directory to chezmoi-managed config.
# Triggered when profiles.ini changes (hash check).
# profiles.ini hash: {{ include $profilesIni | sha256sum }}
set -euo pipefail

# ... rest of script ...

{{ else -}}
#!/bin/bash
# Firefox profiles.ini not found; skipping chrome link setup.
echo "firefox: profiles.ini not found at {{ $profilesIni }}, skipping"
{{ end -}}
```

**How this works:**

1. `stat` checks whether `profiles.ini` exists before `include` is called.
2. When the file exists: the full script is rendered, including the hash comment. The `run_onchange_` mechanism works as designed -- the script re-runs whenever `profiles.ini` content changes.
3. When the file is missing: a minimal no-op script is rendered. Because the output is not empty (it contains a shebang and an echo), chezmoi will "run" it once and record the hash. When `profiles.ini` later appears and the user runs `chezmoi apply`, the template output changes (now includes the real script + hash), triggering a re-run.

**Alternative (simpler but with a tradeoff):** If the entire template body is wrapped such that it produces only whitespace when Firefox is absent, chezmoi skips execution entirely and records no hash. This means the script will be evaluated fresh on every `chezmoi apply` until Firefox is installed. This is acceptable since the `stat` check is cheap, but it means slightly more template processing on each apply.

### Why Not Use a Fixed Sentinel Hash?

One might consider using a fixed placeholder hash (e.g., `sha256sum` of an empty string) when the file is missing. This would work but is fragile: if chezmoi caches the script hash from a run where the file was absent, it might not re-trigger when the file appears, depending on whether other script content also changed. The `stat`-guarded conditional is more explicit and reliable.

---

## Additional Observations

1. **The script body already handles missing `profiles.ini`** at runtime with `if [ ! -f "$PROFILES_INI" ]; then ... exit 0; fi`. The template-level fix complements this by preventing the template rendering failure that would occur before the script ever gets a chance to run.

2. **Cross-platform extension:** The same `stat` pattern naturally extends to macOS. A future version could check multiple paths:
   ```
   {{ $profilesIni := "" }}
   {{ if stat (joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini") }}
   {{   $profilesIni = joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini" }}
   {{ else if stat (joinPath .chezmoi.homeDir "Library/Application Support/Firefox/profiles.ini") }}
   {{   $profilesIni = joinPath .chezmoi.homeDir "Library/Application Support/Firefox/profiles.ini" }}
   {{ end }}
   ```

3. **The `stat` function is documented as "not hermetic"** -- its return depends on filesystem state at template execution time. This is acceptable here because the entire purpose of the hash trigger is to react to filesystem state changes.

## Sources

- [chezmoi `stat` function documentation](https://www.chezmoi.io/reference/templates/functions/stat/)
- [chezmoi `include` function documentation](https://www.chezmoi.io/reference/templates/functions/include/)
- [chezmoi scripting documentation](https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/)
- [chezmoi issue #1226 (Firefox profile management)](https://github.com/twpayne/chezmoi/issues/1226)
