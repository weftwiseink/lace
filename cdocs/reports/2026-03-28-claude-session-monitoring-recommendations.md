---
first_authored:
  by: "@claude-opus-4-6-20250625"
  at: 2026-03-28T10:10:00-07:00
task_list: sprack/recon-evaluation
type: report
state: live
status: wip
tags: [architecture, sprack, tooling_evaluation, recommendations]
---

# Claude Session Monitoring: Strategic Recommendations

> BLUF: Sprack's architecture (three-crate Rust pipeline, SQLite-mediated IPC, container-aware session resolution) is the right long-term approach for lace's monitoring needs.
> However, sprack has accumulated significant complexity and several unresolved data-correctness bugs that make continued investment premature given competing priorities.
> The recommended path: backport two high-value techniques from recon (`capture-pane` status tiebreaking, `/clear` successor detection), use recon as the daily-driver monitor for host-local sessions, and park sprack in a documented, resumable state.
> A recon fork is not worth carrying: the maintenance cost exceeds the benefit, and the `podman exec recon json` aggregation pattern covers the container gap cheaply.

## The Landscape

Three independent investigations inform this report:

1. **Recon state inspection comparison** ([details](2026-03-28-recon-state-inspection-techniques.md)): head-to-head analysis of recon's `capture-pane` + PID-session-file approach vs sprack-claude's JSONL parsing + `/proc` walking. Each covers blind spots the other misses.
2. **Claude Code internals research** ([details](2026-03-08-gemini-claude-internals-research-report.md)): comprehensive survey of Claude's local file formats, community tooling (agentnotch, cclog/ccrecall, claude-code-ui), and state derivation patterns. Confirms that the JSONL + encoded-CWD + sessions-index approach is the canonical data model.
3. **Recon/lace feasibility and fork analysis** ([details](2026-03-28-recon-lace-podman-feasibility.md), [fork analysis](2026-03-28-recon-minimal-podman-pr.md)): recon works out of the box for host-local sessions; cross-container monitoring requires modifications that the maintainer will not accept as PRs.

## Why Sprack's Architecture Is Right

Sprack addresses real requirements that recon and community tools do not:

- **Container-aware session resolution.** Claude instances inside devcontainers write to a different `~/.claude` root with container-local PIDs and container-encoded paths. Sprack's four-tier resolver (hook event, session-ID lookup, CWD scan, JSONL listing) handles this. Recon's discovery pipeline is hardcoded to a single `~/.claude` root.
- **Structured data persistence.** The SQLite cache enables turn counts, tool usage frequency, context trend tracking, and cross-session analytics. Recon rebuilds state from scratch every 2 seconds with no persistence.
- **Hook event bridge.** Sprack's hook integration provides session-ID-based resolution and task lifecycle events that JSONL parsing alone cannot surface. This is the correct architectural direction for reducing coupling to Claude's file layout.
- **Decoupled three-crate design.** `sprack-poll` (tmux), `sprack-claude` (Claude integration), and `sprack` (TUI) enforce clean boundaries. 126 tests pass across the crates.

The community tooling survey confirms sprack's positioning: agentnotch is macOS-only and display-focused, cclog/ccrecall is retrospective analytics, claude-code-ui targets web dashboards.
None of these address the "monitor multiple Claude instances across containers from a tmux sidecar" use case.

## Why Sprack Should Be Parked

Despite sound architecture, sprack has practical problems that make continued investment costly relative to the payoff:

1. **Data correctness bugs undermine trust.** The turn count inflation bug (824 displayed vs actual), wrong session names for container panes, and task UI rendering errors mean the most visible metrics are wrong. The robustness assessment ([sprack workstream assessment](2026-03-25-sprack-workstream-robustness-assessment.md)) classifies data correctness risk as High.

2. **Container awareness is fragile.** Hard dependency on `@lace_workspace` being set correctly by `lace-into`, silent `None` returns on missing metadata, and four coupling points to Claude Code internals (project directory encoding, JSONL format, bind mount paths, `sessions-index.json` schema). Any Claude Code update can break this silently.

3. **Proposal sprawl.** Over 20 sprack proposals, 15 reviews, and 10 reports in one week of development. The design surface has outgrown the implementation maturity. Continued work will generate more design documents without converging on a stable product.

4. **Opportunity cost.** The lace project has competing priorities (podman exec migration, devcontainer feature stabilization, worktree support) that deliver more user value per engineering hour.

## Recommendations

### 1. Backport Two Techniques from Recon Before Parking

These are the highest-value, lowest-effort improvements identified in the [state inspection comparison](2026-03-28-recon-state-inspection-techniques.md):

**a. `capture-pane` as secondary status signal (Medium effort, High impact).**
When sprack-claude's JSONL shows `stop_reason: null` (thinking) for 2+ consecutive poll cycles but `tmux capture-pane` shows an idle prompt, override the state to Idle.
This eliminates the stale-thinking false positive: the most common and most visible status error.
The implementation is ~30 lines in `status.rs`: call `tmux capture-pane -t <target> -p`, scan the last 10 lines for spinner characters.

**b. `/clear` successor detection (Low effort, High impact).**
When Claude's user runs `/clear`, a new JSONL file is created but the PID-to-session mapping still points to the old file.
Sprack-claude has no mechanism to detect this.
The fix: after resolving a session file, check the project directory for newer JSONL files whose first 5 lines contain `<command-name>/clear</command-name>`.
If found, switch to the newer file.
This is ~20 lines in the resolver.

> NOTE(opus/sprack/recon-evaluation): These two backports address the most impactful operational gaps without requiring architectural changes.
> They improve sprack's correctness for the parking period, making it more useful if resumed later.

### 2. Do Not Carry a Recon Fork

The [fork analysis](2026-03-28-recon-minimal-podman-pr.md) shows that enabling container monitoring in recon requires ~100 lines across 2 files.
The technical change is clean.
The problems are operational:

- **CONTRIBUTING.md rejects PRs.** The maintainer will not merge external code. The viable path is an Issue + reference fork, but the maintainer may never reimplement.
- **Recon is actively developed** (frequent commits to `session.rs`). Rebasing the fork will be a recurring cost.
- **The benefit is marginal.** For container sessions, `podman exec <container> recon json` aggregated by a shell script provides machine-readable status without any fork. The TUI experience is lost, but the data is available.

The recommended approach: use upstream recon for host-local sessions, `podman exec recon json` for container sessions if needed, and file an Issue describing the multi-root use case for the maintainer's consideration.

### 3. Use Recon as the Daily Driver

Recon is usable today with zero setup.
It provides token counts, model info, session status, and a clean TUI for all Claude instances running in tmux.
For the host-local monitoring use case (which is the common case), it is strictly better than a partially-broken sprack.

Limitations to accept:
- No container session visibility in the TUI.
- No persistent analytics (turn counts, tool usage trends).
- No hook event integration.
- Fragile to Claude Code TUI changes (spinner characters, prompt text).

### 4. Park Sprack with a Clear Resumption Plan

**State to leave it in:**

- Apply the two backports (capture-pane, /clear detection).
- Fix the turn count inflation bug (wire `ingestion_state` byte offset tracking into the ingest loop). This is Priority 1 in the robustness assessment and prevents the parked codebase from accumulating corrupt data.
- Ensure `cargo test` passes across all crates and `cargo clippy` is clean.
- Write a `PARKING.md` or equivalent note in the sprack package documenting: what works, what doesn't, what to do first when resuming.

**What is deferred:**

- Container awareness stabilization (lace_workspace dependency, session name resolution, host-side path display). These are the hardest problems and the ones most likely to be obviated by upstream Claude Code changes.
- Inline summaries redesign. The detail-pane-to-inline migration is a UX project, not a correctness fix.
- SQLite mirror proposal. Interesting but premature without a stable base.
- All open RFPs (20+ proposals). Mark as `deferred` in frontmatter.

**What triggers resumption:**

- Lace's podman exec migration stabilizes and container awareness becomes the primary interaction model (at that point, recon's host-only limitation becomes a real blocker).
- Claude Code ships breaking changes to the JSONL format or session file layout that invalidate recon's assumptions (sprack's hook bridge would be more resilient).
- A need arises for persistent analytics (session cost tracking, tool usage patterns) that recon's stateless model cannot serve.

## Summary

| Decision | Rationale |
|----------|-----------|
| Sprack architecture is sound | Three-crate design, container awareness, hook bridge are the right long-term approach |
| Backport capture-pane + /clear detection | Highest-value recon techniques, directly fix sprack's most visible status bugs |
| Fix turn count inflation before parking | Prevents corrupt data from accumulating in the parked codebase |
| Do not fork recon | Maintenance cost exceeds benefit; `podman exec recon json` covers the gap |
| Use recon as daily driver | Zero-setup, correct for host-local sessions, sufficient for current workflow |
| Park sprack, defer 20+ open proposals | Resume when container-first workflow or persistent analytics become blocking needs |

> TODO(opus/sprack/recon-evaluation): The three pre-parking tasks (two backports + turn count fix) are estimated at 2-4 hours of implementation.
> If time is too constrained even for these, the minimum viable parking action is: ensure tests pass, mark proposals as deferred, and document the resumption triggers.
