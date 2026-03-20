---
review_of: cdocs/devlogs/2026-03-20-weftwise-devcontainer-migration-implementation.md
first_authored:
  by: "@claude-sonnet-4-6"
  at: 2026-03-20T18:00:00-07:00
task_list: devcontainer/weftwise-migration
type: review
state: archived
status: done
tags: [rereview_agent, implementation_review, devcontainer, migration, mount_conflict]
---

# Review: Weftwise Devcontainer Migration Implementation (R2)

> BLUF: Both R1 blocking items are resolved.
> The session symlink path in `migrate_devcontainer_volumes.sh` is corrected to `-workspaces-weftwise`, and `devcontainer.json` now carries a NOTE documenting the mount overlap with correct behavioral explanation.
> The devlog's R1 revision section provides adequate verification evidence.
> Verdict: Accept.

## Summary Assessment

The R2 revision addresses both blocking items from R1 with specificity and evidence.
The script fix is exact and correct.
The devcontainer.json NOTE explains both the overlap mechanism (Docker preserves the more-specific file mount) and the distinct source paths on the host, which was the core ambiguity R1 raised.
No new issues were introduced in the revisions.

## R1 Blocking Items: Verification

### Blocking 1: `migrate_devcontainer_volumes.sh` stale `-workspace` references

R1 found that lines 72 and 76 of the migration script still used `-workspace` (the old path-encoded session directory name).

Current state of those lines:
- Line 72: `if [ -d "$PROJECTS_DIR/-workspaces-weftwise" ]`
- Line 76: `ln -sf -- -workspaces-weftwise "$PROJECTS_DIR/$LOCAL_PROJECT_NAME"`

Both references are correctly updated to `-workspaces-weftwise`.
The echo message on line 75 also reflects the new name.
**Resolved.**

### Blocking 2: Mount overlap between `claude-config-json` and `claude-code/config`

R1 required explicit documentation confirming Docker mount ordering and intended behavior.

The NOTE added at `devcontainer.json` lines 69-72 covers:
- That the file mount overlaps with the directory mount (both target `/home/node/.claude`).
- Docker's behavior: the more-specific file mount is preserved even when the directory mount covers the parent.
- That the two host source files are distinct: `~/.claude.json` (home root, onboarding state) vs. `~/.claude/.claude.json` (inside the dir mount, different content).

The devlog R1 revision section (lines 195-205) provides corroborating evidence: the container reads `"numStartups": 154` from `~/.claude.json` (file mount source), while `~/.claude/.claude.json` contains `"cachedGrowthBookFeatures"` - confirming the two files are distinct and the file mount is not redundant.
**Resolved.**

## Remaining Non-Blocking Items

### Action item 3 (non-blocking): Clauthier `readlink` output not added

The R1 review noted the devlog does not show `readlink /mnt/lace/repos/clauthier` output from the proposal's verification methodology.
This was non-blocking in R1 and remains unaddressed.
It is acceptable: the content listing (`CLAUDE.md LICENSE README.md build cdocs`) is stronger practical evidence than a symlink readback.
No action required for acceptance.

### Action item 4 (non-blocking): Worktree operations TODO

The WARN and TODO callouts for the worktree operations verification gap are present and correctly placed (lines 182-185 of the devlog).
This gap is properly tracked and disclosed.
No action required for acceptance.

## Verdict

**Accept.**
Both R1 blocking items are resolved with correct fixes and corroborating evidence.
The non-blocking items are either acceptable as-is or properly tracked.
The implementation devlog is complete and accurate.

## Action Items

1. [non-blocking] Close the worktree operations verification gap (existing TODO in devlog) when a worktree is next created inside the weftwise container - no document change required now.
