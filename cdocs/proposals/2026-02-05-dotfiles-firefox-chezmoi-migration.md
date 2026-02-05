---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-02-05T13:00:00-08:00
task_list: lace/dotfiles-migration
type: proposal
state: live
status: review_ready
tags: [dotfiles, chezmoi, firefox, userchrome, migration, flatpak]
last_reviewed:
  status: revision_requested
  by: "@claude-opus-4-6"
  at: 2026-02-05T13:30:00-08:00
  round: 1
---

# Dotfiles Firefox Chezmoi Migration

> BLUF: Manage Firefox's `userChrome.css`, `userContent.css`, and Breeze SVG assets through chezmoi at a predictable intermediate path (`~/.config/firefox-chrome/`), with a `run_onchange_` script that auto-detects the active profile from `profiles.ini` and symlinks `<profile>/chrome/` to that path. This sidesteps the fundamental mismatch between chezmoi's deterministic targets and Firefox's randomly-named profile directories, replacing the current manual symlink from the old `setup.sh`.

## Objective

Bring the Firefox custom chrome configuration (16KB `userChrome.css`, `userContent.css`, `linux_assets/` with 27 SVG/image files) under chezmoi management in the dotfiles repository, completing a gap left by Phase 4 of the dotfiles migration (which explicitly excluded the `firefox/` directory in `.chezmoiignore`).

## Background

### Current State on This System

**Firefox Installation:** Flatpak (`org.mozilla.firefox` 147.0.3, system install) on Fedora. Despite being a Flatpak, the profile lives at the standard native path `~/.mozilla/firefox/` (not `~/.var/app/org.mozilla.Firefox/.mozilla/firefox/`), likely due to Fedora's Flatpak Firefox having broad filesystem permissions.

**Profile Structure:**
```
~/.mozilla/firefox/
  profiles.ini                    # Profile registry
  installs.ini                    # Install-to-profile mapping
  10xxj5e7.default/               # Older default profile (unused)
  h4hh8m1f.default-release/      # Active profile
    chrome/ -> /var/home/mjr/code/personal/dotfiles/firefox   # SYMLINK
```

**Existing Symlink:** The `chrome/` directory inside the active profile is already a symlink pointing to the dotfiles repo's `firefox/` directory. This was created by the old `setup.sh` via `setup_symlink firefox "$FIREFOX_PROFILE_DIR/chrome"`, where `FIREFOX_PROFILE_DIR` was hardcoded in `blackbox/blackbox.sh`:
```bash
export FIREFOX_PROFILE_DIR="$HOME/.mozilla/firefox/h4hh8m1f.default-release/"
# export FIREFOX_PROFILE_DIR="$HOME/.var/app/org.mozilla.firefox/.mozilla/firefox/sip7urf0.default-release"
```

**What the Chrome Directory Contains:**
- `userChrome.css` (16KB) -- extensive Sidebery-based tab sidebar customization, compact navbar, KDE Breeze window controls, Linux CSD support
- `userContent.css` (197 bytes) -- dark mode PDF inversion in the built-in viewer
- `linux_assets/firefox_logo.svg` -- used by `userChrome.css` via relative `url('./linux_assets/...')` paths
- `linux_assets/breeze/` -- 26 SVG files for KDE Breeze window button states (minimize, maximize, close, with normal/hover/active/backdrop variants)

**Chezmoi State:** The `firefox/` directory is currently listed in `.chezmoiignore`, meaning chezmoi does not manage it at all.

### The Firefox Profile Path Problem

Firefox assigns profile directories random 8-character alphanumeric prefixes (e.g., `h4hh8m1f.default-release`). This creates a fundamental mismatch with chezmoi's model, which assumes deterministic paths under `$HOME`. The path varies by:

1. **Profile creation:** Each new profile gets a fresh random prefix
2. **Platform:** `~/.mozilla/firefox/` (Linux native), `~/Library/Application Support/Firefox/Profiles/` (macOS), `~/.var/app/org.mozilla.Firefox/.mozilla/firefox/` (Flatpak on some distros)
3. **Install method:** The install ID in `profiles.ini` (e.g., `CF146F38BCAB2D21`) is a CityHash derived from the Firefox binary path, which differs between native, Flatpak, and Snap installs

### Community Approaches (chezmoi issue #1226)

The [chezmoi issue #1226](https://github.com/twpayne/chezmoi/issues/1226) discussion surfaced several strategies:

1. **`profiles.ini` Templating:** Manage `profiles.ini` itself as a chezmoi template, setting custom profile paths and computing install IDs via CityHash. This eliminates the randomness at the source by forcing Firefox to use a predictable path.

2. **Run Scripts with Dynamic Detection:** Use `run_before_`/`run_after_` scripts to parse `profiles.ini`, discover the active profile, and copy files into place.

3. **Intermediate Directory + Symlink:** Place files at a predictable chezmoi-managed path and symlink from the Firefox profile to that path.

4. **Symlink Replacement:** Replace the entire profile directory with a symlink to a chezmoi-managed directory.

## Proposed Solution

### Approach: Predictable Intermediate Path with Scripted Symlink

Chezmoi manages files at `~/.config/firefox-chrome/` (a deterministic path). A `run_onchange_` script parses `profiles.ini` to find the active profile and creates a symlink from `<profile>/chrome/` to the chezmoi-managed directory.

**Source tree additions in `dotfiles/`:**

```
dot_config/
  firefox-chrome/
    userChrome.css
    userContent.css
    linux_assets/
      firefox_logo.svg
      breeze/
        close-active.svg
        close-backdrop-active.svg
        ... (26 SVG files)
```

```bash
# run_onchange_after_firefox-chrome-link.sh.tmpl
#!/bin/bash
# Link Firefox profile chrome/ directory to chezmoi-managed config.
# Triggered when profiles.ini changes (hash check).
# profiles.ini hash: {{ include (joinPath .chezmoi.homeDir ".mozilla/firefox/profiles.ini") | sha256sum }}
set -euo pipefail

FIREFOX_DIR="{{ .chezmoi.homeDir }}/.mozilla/firefox"
CHROME_SOURCE="{{ .chezmoi.homeDir }}/.config/firefox-chrome"
PROFILES_INI="$FIREFOX_DIR/profiles.ini"

if [ ! -f "$PROFILES_INI" ]; then
    echo "firefox: profiles.ini not found, skipping chrome link"
    exit 0
fi

# Find the default-release profile path (the one used by installs.ini Default=)
# Parse installs.ini to find which profile is the active default
INSTALLS_INI="$FIREFOX_DIR/installs.ini"
if [ -f "$INSTALLS_INI" ]; then
    PROFILE_REL=$(grep -m1 '^Default=' "$INSTALLS_INI" | cut -d= -f2)
else
    # Fallback: find the first profile with "default-release" in its path
    PROFILE_REL=$(grep '^Path=.*default-release' "$PROFILES_INI" | head -1 | cut -d= -f2)
fi

if [ -z "${PROFILE_REL:-}" ]; then
    echo "firefox: could not determine active profile, skipping"
    exit 0
fi

# Handle both relative and absolute paths in profiles.ini
if [[ "$PROFILE_REL" = /* ]]; then
    PROFILE_DIR="$PROFILE_REL"
else
    PROFILE_DIR="$FIREFOX_DIR/$PROFILE_REL"
fi

CHROME_TARGET="$PROFILE_DIR/chrome"

# If chrome/ already points to the right place, nothing to do
if [ -L "$CHROME_TARGET" ]; then
    EXISTING=$(readlink -f "$CHROME_TARGET" 2>/dev/null || true)
    EXPECTED=$(readlink -f "$CHROME_SOURCE" 2>/dev/null || true)
    if [ "$EXISTING" = "$EXPECTED" ]; then
        echo "firefox: chrome symlink already correct"
        exit 0
    fi
fi

# Back up existing chrome/ directory if it's a real directory (not a symlink)
if [ -d "$CHROME_TARGET" ] && [ ! -L "$CHROME_TARGET" ]; then
    BACKUP="$CHROME_TARGET.bak.$(date +%Y%m%d%H%M%S)"
    echo "firefox: backing up existing chrome/ to $BACKUP"
    mv "$CHROME_TARGET" "$BACKUP"
fi

# Remove existing symlink if pointing elsewhere (e.g., old dotfiles path)
if [ -L "$CHROME_TARGET" ]; then
    echo "firefox: removing stale chrome symlink (was: $(readlink "$CHROME_TARGET"))"
    rm "$CHROME_TARGET"
fi

# Create the symlink
ln -s "$CHROME_SOURCE" "$CHROME_TARGET"
echo "firefox: linked $CHROME_TARGET -> $CHROME_SOURCE"
```

**Removal from `.chezmoiignore`:** The `firefox/` entry stays in `.chezmoiignore` (it excludes the legacy directory). The new `dot_config/firefox-chrome/` path is not ignored.

### Why Not profiles.ini Templating?

The `profiles.ini` templating approach from issue #1226 is the most elegant solution in theory -- it eliminates the randomness problem at its source by forcing Firefox to use predictable profile paths. However, it was rejected for this system because:

1. **Risk of profile data loss.** Overwriting `profiles.ini` with a template could cause Firefox to not recognize the existing profile (`h4hh8m1f.default-release` with years of data, session state, extensions, passwords). If the install ID hash is wrong or the path mapping is off, Firefox creates a new empty profile.

2. **Install ID fragility.** The `CF146F38BCAB2D21` install ID is a CityHash of the Firefox binary path. On this system, Firefox is a Flatpak, meaning the binary path goes through Flatpak's runtime indirection. Computing the correct hash for the Flatpak case is non-trivial and could break on Flatpak updates that change the runtime path.

3. **The problem is already mostly solved.** A `chrome/` symlink has worked reliably on this system since 2022. The proposal merely needs to bring this pattern under chezmoi management rather than reinvent the profile path model.

4. **Multiple machines with different profiles.** The user has both Linux (Flatpak) and macOS configurations (commented-out in `blackbox.sh`). Templating `profiles.ini` on each machine requires per-machine profile path configuration, which the intermediate path approach handles more naturally.

## Important Design Decisions

### Decision 1: `~/.config/firefox-chrome/` as the Intermediate Path

**Decision:** Use `~/.config/firefox-chrome/` as the chezmoi-managed target rather than placing files directly in the Firefox profile.

**Why:**
- Follows XDG conventions for user configuration
- Completely deterministic and predictable for chezmoi
- The directory name `firefox-chrome` is self-documenting (it is the `chrome/` directory content for Firefox)
- Avoids any interaction with Firefox's profile naming
- A single chezmoi target works regardless of which Firefox profile is active

### Decision 2: `run_onchange_` Instead of `run_once_`

**Decision:** Use `run_onchange_after_` triggered by `profiles.ini` content hash, not `run_once_`.

**Why:**
- `run_once_` only runs once per machine, ever. If the user creates a new Firefox profile or reinstalls Firefox (getting a new profile directory), the symlink would not be recreated.
- `run_onchange_` re-triggers whenever `profiles.ini` changes, which is exactly when the profile path might change.
- The script is idempotent -- if the symlink already points to the correct target, it exits immediately with no side effects.

### Decision 3: Rejecting profiles.ini Templating

**Decision:** Do not manage `profiles.ini` through chezmoi templates.

**Why:** See detailed analysis in Proposed Solution section. The risk/reward ratio is unfavorable: high risk of data loss from incorrect install IDs or path mismatches, low reward since the intermediate path approach is simpler and already proven. The profiles.ini approach is better suited for fresh-install automation rather than managing an existing, lived-in Firefox profile.

### Decision 4: Preserving Relative Asset Paths

**Decision:** Keep `linux_assets/` as a subdirectory within the chezmoi-managed `firefox-chrome/` directory rather than referencing assets from a separate location.

**Why:**
- `userChrome.css` references assets via relative paths like `url('./linux_assets/breeze/minimize-normal.svg')`. These relative paths resolve from the `chrome/` directory.
- Because `chrome/` is a symlink to `~/.config/firefox-chrome/`, the relative paths resolve correctly within the chezmoi-managed directory.
- Moving assets elsewhere would require rewriting all the `url()` references in `userChrome.css`, which is unnecessary complexity.

### Decision 5: Script Runs After Apply (not Before)

**Decision:** The symlink script is an `after` script, not a `before` script.

**Why:**
- Chezmoi needs to write the files to `~/.config/firefox-chrome/` first, then the symlink is created pointing to that directory. Running the symlink script before the files exist would create a symlink to a potentially empty or stale directory.
- The `after` ordering ensures the files are in place before Firefox could read them through the symlink.

## Stories

### Story 1: Fresh Machine Setup

User clones their dotfiles on a new Fedora machine, runs `chezmoi apply`. Firefox has been opened once (creating `profiles.ini` with a random profile). The `run_onchange_` script parses `profiles.ini`, finds the `default-release` profile, and creates the `chrome/` symlink. Firefox is restarted and picks up the custom CSS.

### Story 2: Firefox Profile Migration

User creates a new Firefox profile or switches to a different one. The `default-release` path in `profiles.ini`/`installs.ini` updates. On next `chezmoi apply`, the `run_onchange_` detects the `profiles.ini` hash has changed, finds the new profile path, removes the old symlink, and creates a new one pointing to the same `~/.config/firefox-chrome/`.

### Story 3: Cross-Platform Use

On macOS, `profiles.ini` lives at `~/Library/Application Support/Firefox/Profiles/` and profile names differ. The script template can be extended with platform detection (`.chezmoi.os`) to handle the different base path. The chezmoi-managed files at `~/.config/firefox-chrome/` are the same regardless of platform; only the symlink target differs.

## Edge Cases / Challenging Scenarios

### Profile Does Not Exist Yet

If Firefox has never been run, `profiles.ini` does not exist. The script checks for this and exits cleanly with a message. The files are still placed at `~/.config/firefox-chrome/` by chezmoi. When Firefox is first launched and creates a profile, the user runs `chezmoi apply` again and the symlink is created.

**Mitigation:** Document in dotfiles README that `chezmoi apply` should be run after Firefox first launch.

### Multiple Profiles

The script targets the profile designated as `Default=` in `installs.ini`. If a user has multiple profiles, only the default one gets the symlink. This is the correct behavior -- custom chrome CSS is typically wanted on the primary profile.

**Mitigation:** If a user wants chrome CSS on additional profiles, they can manually symlink those profiles' `chrome/` directories to `~/.config/firefox-chrome/`. A future enhancement could iterate over all profiles.

### Profile Path Changes (New Install or Flatpak Update)

If Firefox is reinstalled or the Flatpak runtime changes, a new profile might be created (new random prefix). The old profile may still exist. Because `run_onchange_` is keyed on the `profiles.ini` hash, it re-runs and creates a symlink in the new profile.

**Caveat:** If the old profile is no longer referenced in `profiles.ini`, its `chrome/` symlink becomes orphaned but harmless.

### Flatpak vs Native Firefox Path Divergence

On this system, Flatpak Firefox uses `~/.mozilla/firefox/` (standard path). Some distributions or Flatpak configurations use `~/.var/app/org.mozilla.Firefox/.mozilla/firefox/` instead.

**Mitigation:** The script template can be extended to check both locations:

```bash
{{- if eq .chezmoi.os "linux" }}
# Check Flatpak path first, fall back to native
if [ -f "$HOME/.var/app/org.mozilla.Firefox/.mozilla/firefox/profiles.ini" ]; then
    FIREFOX_DIR="$HOME/.var/app/org.mozilla.Firefox/.mozilla/firefox"
elif [ -f "$HOME/.mozilla/firefox/profiles.ini" ]; then
    FIREFOX_DIR="$HOME/.mozilla/firefox"
fi
{{- end }}
```

For now, the initial implementation targets the known path on this system. The Flatpak alternative path is commented in the script as a known extension point.

### Existing chrome/ Is a Real Directory (Not a Symlink)

If someone copies files directly into `chrome/` rather than symlinking, the script backs up the directory with a timestamped suffix before creating the symlink. No data is lost.

### Stale Symlink from Old Dotfiles Setup

The current system has `chrome/ -> /var/home/mjr/code/personal/dotfiles/firefox`. After migration, the symlink should point to `~/.config/firefox-chrome/` instead. The script detects that the existing symlink points to the wrong target, removes it, and creates the correct one.

### SVG Assets and Content Security

Firefox's `userChrome.css` loads SVGs via `url()` references. These must be loaded from within the `chrome/` directory tree (Firefox does not allow arbitrary filesystem access from chrome CSS). Because the symlink makes `~/.config/firefox-chrome/` appear as the `chrome/` directory to Firefox, the relative `url()` paths resolve correctly.

### macOS Considerations

The macOS Firefox profile path (`~/Library/Application Support/Firefox/Profiles/`) and the commented-out profile in `macos/macos.sh` (`lwo34esx.dev-edition-default` -- note: this is Developer Edition, not standard Firefox) indicate the user also uses Firefox on macOS. The script template should be made platform-aware in a future phase, but the core approach (intermediate directory + symlink) works identically on macOS.

## Test Plan

### Pre-Migration Verification

1. Confirm the existing symlink works: open Firefox, verify Sidebery tab sidebar and Breeze window controls render correctly.
2. Record the current symlink target: `readlink ~/.mozilla/firefox/h4hh8m1f.default-release/chrome`.

### Migration Steps Testing

1. **File placement:** After `chezmoi apply`, verify all files exist at `~/.config/firefox-chrome/`:
   - `userChrome.css` (16764 bytes, matching source)
   - `userContent.css` (197 bytes, matching source)
   - `linux_assets/firefox_logo.svg`
   - `linux_assets/breeze/*.svg` (26 files)

2. **Symlink creation:** After `chezmoi apply`, verify:
   - `~/.mozilla/firefox/h4hh8m1f.default-release/chrome` is a symlink
   - Symlink target is `~/.config/firefox-chrome/` (not the old dotfiles path)

3. **Firefox rendering:** Open Firefox and verify:
   - Tab bar is hidden (Sidebery integration)
   - Compact navbar renders correctly
   - KDE Breeze window controls (minimize/maximize/close) display
   - PDF viewer dark mode inversion works (open any PDF)

4. **Idempotency:** Run `chezmoi apply` again. Verify the script reports "chrome symlink already correct" and makes no changes.

5. **Diff correctness:** Run `chezmoi diff` and verify no unexpected differences.

## Implementation Phases

### Phase 1: Add Firefox Chrome Files to Chezmoi Source

**Tasks:**
- Create `dot_config/firefox-chrome/` directory in the dotfiles repo
- Copy `userChrome.css`, `userContent.css` from `firefox/` to `dot_config/firefox-chrome/`
- Copy `linux_assets/` tree (firefox_logo.svg + breeze/) to `dot_config/firefox-chrome/linux_assets/`
- Verify file contents match originals exactly (byte-for-byte)

**Success Criteria:**
- `chezmoi status` shows the new files as additions
- `chezmoi diff` shows the expected new files at `~/.config/firefox-chrome/`

**Constraints:**
- Do not modify the original `firefox/` directory yet
- Do not remove `firefox/` from `.chezmoiignore` (it should stay ignored; the new path is `dot_config/firefox-chrome/`)

### Phase 2: Create the Symlink Script

**Tasks:**
- Create `run_onchange_after_firefox-chrome-link.sh.tmpl` in the dotfiles source root
- Implement profile detection logic (parse `installs.ini` and `profiles.ini`)
- Implement symlink creation with backup and idempotency
- Include the `profiles.ini` hash trigger comment

**Success Criteria:**
- `chezmoi apply -nv` shows the script would run
- Running `chezmoi apply` creates the symlink from `<profile>/chrome/` to `~/.config/firefox-chrome/`
- The old symlink (pointing to `dotfiles/firefox/`) is replaced
- Running `chezmoi apply` a second time reports "already correct"

**Constraints:**
- The script must not fail if Firefox has not been installed or run
- The script must back up (not delete) any existing `chrome/` real directory

### Phase 3: Verification and Cleanup

**Tasks:**
- Run full test plan (file placement, symlink, Firefox rendering, idempotency)
- Remove the legacy `firefox/` directory from the dotfiles repo (or move it to `archive/firefox/`)
- Verify the Breeze SVGs and Firefox logo load correctly through the new symlink chain
- Update dotfiles README if applicable

**Success Criteria:**
- Firefox renders all custom CSS correctly
- No references to the old `dotfiles/firefox/` path remain in active use
- `chezmoi managed` includes all `firefox-chrome/` files
- `chezmoi apply` on a theoretical fresh machine with Firefox installed would work

**Constraints:**
- Do not remove `firefox/` from the repo until Phase 2 is verified working
- Keep the old `blackbox.sh` `FIREFOX_PROFILE_DIR` export as documentation (it is already in the archived setup.sh path)

## Open Questions

1. **macOS support timing:** Should the `run_onchange_` script handle macOS from the start (via `.chezmoi.os` template conditionals), or defer macOS support to when the user next sets up a Mac? Deferring is simpler; the script can initially be Linux-only with a clear extension point.

2. **Multiple profile support:** Should the script iterate over all profiles in `profiles.ini` and symlink `chrome/` in each, or only the default? The current proposal targets only the default profile. Multi-profile support could be added if needed.

3. **`toolkit.legacyUserProfileCustomizations.stylesheets` pref:** Firefox requires this `about:config` preference set to `true` for `userChrome.css` to take effect. Should the chezmoi setup also manage a `user.js` file that enables this preference? Currently, it is assumed to be set manually. A `user.js` with this single preference could be added to `firefox-chrome/` and symlinked alongside, but `user.js` lives directly in the profile directory (not `chrome/`), which would require a separate management approach.
