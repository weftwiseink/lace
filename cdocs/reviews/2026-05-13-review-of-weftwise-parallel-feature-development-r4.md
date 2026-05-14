---
review_of: cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T19:30:00-07:00
task_list: weftwise/parallel-feature-development/review
type: review
state: live
status: done
tags: [rereview_agent, round-4, architecture, portless, host-lifecycle, sysctl, reversibility, security, test_plan]
---

# Review of "Streamlined Parallel Feature Development for Weftwise" (Round 4)

> BLUF(opus/weftwise-parallel-dev/review): Round 4 cleanly absorbs all seven of the user's redesign asks: the BLUF is now three sentences, decisions are extracted to a supplemental report (D1-D12) without orphaning references, lace bundles portless via package.json, lace owns the host portless lifecycle at runtime, the only durable host state is one auto-reversible sysctl drop-in, the new Phase 0 preflight is a four-status state machine wired to `lace up`, and Phase 4 has concrete schemas plus integration code.
> The proposal is now implementable end-to-end without further design clarification, with the single load-bearing external uncertainty (`--wildcard` suffix-match semantics) carried over from round 3 and acknowledged.
> One blocking issue: the `extractLaceCustomizations` extractor at `feature-metadata.ts:660-673` strips unknown port-declaration fields during runtime narrowing, so `hostAlias` would be silently dropped unless the Phase 4 file list explicitly adds it to the extractor as well as the interface.
> Verdict: **Revise** (one blocking; otherwise tightening notes).

## Summary Assessment

This round responds to a structured user pivot rather than another agent review.
The seven asks are addressed directly:

1. BLUF concision: trimmed from a five-bullet overview to three sentences. Accurate, scannable.
2. pnpm bundling: lace now lists `portless` as a runtime dependency (D9) and resolves it at runtime via `require.resolve`. No user-facing `npm install -g`.
3. Auto-reversible config + port-80 security: D10 specifies the single sysctl drop-in (one file, one line, removable with `rm + sysctl --system`). D12 promotes the HTTPS RFP to a HIGH-PRIORITY follow-up with named threat model (local impostor, cookie/origin leakage).
4. Host-availability prompt at `lace up`: Phase 0's `hostPortlessPreflight()` runs before `runDevcontainerUp`, prompts for sysctl apply, exits cleanly if declined.
5. Phase 4 detail: now has the `hostAlias: boolean | string` schema, the feature-manifest snippet, the type widening, the allocation loop integration, and four test cases.
6. Decisions moved out: `cdocs/reports/2026-05-13-weftwise-parallel-dev-decisions.md` holds D1-D12. The proposal no longer renders the rationale inline; it cites the report at three locations (BLUF, Background, References).
7. Implementation/testing focus: each phase has Files / Behaviour / Tests / Acceptance subsections; Phase 5 is an 11-step e2e matrix with explicit success criteria.

The redesign genuinely earns its objectives.
The remaining issues are an implementation-completeness gap in Phase 4 (the metadata extractor's silent narrowing) and a handful of inconsistencies between the BLUF, Phase 0, and Phase 5.

## Verification of Source Claims

### Lace source citations

| Citation | Status |
|---|---|
| `packages/lace/src/lib/feature-metadata.ts` (Phase 4 target for widening) | **Verified**: `LacePortDeclaration` interface exists at lines 47-57; the current fields are `label`, `onAutoForward`, `requireLocalPort`, `protocol`. Adding `hostAlias?: boolean \| string` is structurally consistent. **However, see Blocking Issue 1.** |
| `packages/lace/src/lib/project-name.ts:13-28` (`deriveProjectName`) | **Verified**: `deriveProjectName` returns `basename(classification.bareRepoRoot)` for `worktree` and `bare-root`, exactly as the proposal assumes. |
| `packages/lace/src/lib/port-allocator.ts:96-193` | **Verified**: `class PortAllocator` is exactly at lines 96-193 (closing brace on 193). `getAllocations(): PortAllocation[]` exists at line 190 — this is the iteration source for Phase 4's allocation loop. |
| `packages/lace/src/lib/up.ts` insertion site for preflight + alias | **Verified**: `runDevcontainerUp` invocation at line 1031; "Post-container verification" block at line 1064 is the natural Phase 4 insertion. Preflight insertion can sit before line 1030 (still inside `runUp`). |
| `packages/lace/src/commands/validate.ts` (Phase 0 candidate) | **Verified**: `validate.ts` exists and is small; adding a `--portless` mode or creating a sibling `doctor.ts` is straightforward. No `doctor.ts` exists today. |
| Existing portless feature manifest | **Verified**: `devcontainers/features/src/portless/devcontainer-feature.json` declares `customizations.lace.ports.proxyPort` with `label`/`onAutoForward`/`requireLocalPort`. Adding `hostAlias: true` is a one-line change. |
| `packages/lace/package.json` (add `portless` dep) | **Verified**: the current `dependencies` block is small (`citty`, `dockerfile-ast`, `jsonc-parser`). Adding `portless` is straightforward; the proposal correctly leaves the version pin to implementation time. |

All lace-side citations check out.

### `--wildcard` semantics (carried over from round 3)

The proposal still cites `packages/portless/src/proxy.ts:87-96` (Background fact 2) as evidence that `--wildcard` enables suffix matching.
A `Grep` of the lace tree for `wildcard|findRoute` finds **no portless source** in this repo — confirming round 3's same observation.
The fresh-eyes report (`2026-05-13-clean-portless-urls-fresh-eyes.md`) still describes `--wildcard` as "fallback for unregistered subdomains," which is operationally different from suffix matching.

The Background fact 2 now adds "verified via upstream-source probe," but does not specify when that probe ran nor surface its output to this repo's reviewers.
This is identical to the round-3 finding: non-blocking because the per-branch fallback exists, but should be empirically confirmed in Phase 5 before the e2e matrix runs.
Phase 5 step 6 (three concurrent worktrees, three URLs serving HTTP 200) is the implicit verification, but a synthetic-backend probe earlier in the matrix would surface a failure faster.

### Decisions report cross-references

Cross-references from proposal → decisions report:

| Proposal location | Reference | Target exists |
|---|---|---|
| BLUF line 21 | "supplemental report" | Yes |
| Background line 48 | "D1-D12" | Yes |
| `NOT being built` line 75 (D9) | D9 in report | Yes |
| `NOT being built` line 76 (D8) | D8 in report | Yes |
| `NOT being built` line 77 (D12) | D12 in report | Yes |
| Edge case E1 line 497 | D12 | Yes |
| Open questions Q5 line 555 | D12 | Yes |
| Open question on bundled portless | D9 | Yes (in Phase 3 narrative) |
| Phase 3 module spec | "see D8" not explicit but implicit | Acceptable |

Cross-references from decisions report → proposal:

| Report location | Reference | Target exists |
|---|---|---|
| BLUF line 14 | proposal path | Yes |
| References line 146 | proposal path | Yes |
| D2 line 31 | superseded host-proxy proposal | Yes (verified `state: archived, status: evolved` in round 3) |
| D6 line 63 | HTTPS RFP | Yes |
| D8 line 82 | "`lace clean --portless` (new subcommand, or `lace doctor --reset`)" | **Inconsistent with proposal**: Phase 3 Acceptance mentions `lace doctor --reset` but no `lace clean --portless` subcommand is introduced anywhere in the proposal. |
| D10 line 109 | `lace setup --reverse` or `lace doctor --uninstall` | **Inconsistent with proposal**: proposal Phase 0 "Reversibility doc" line 168 says "(or `lace doctor --uninstall`)" but Open Questions Q4 line 551 refers to `lace setup --reverse`. Naming is unsettled across three places. |
| D11 line 115 | `hostAlias: boolean \| string` | Consistent with proposal Phase 4 |
| D12 line 141 | HTTPS RFP scheduling | Consistent |

The decisions report is internally consistent. The proposal-side naming of the reversal/reset subcommand drifts across Phase 0, Phase 3 Acceptance, Open Questions, and D8/D10. Recommend pinning one name (see Action Item 4).

### Round-3 action items

| R3 action | Round 4 status |
|---|---|
| 1. Rephrase "no host-side daemon to maintain" | Resolved. New BLUF does not make this claim; D8 in the report explicitly states lace spawns and tracks the host process. |
| 2. Empirically probe `--wildcard` first in Phase 5 | **Not addressed**. Phase 5's 11-step matrix does not explicitly run a synthetic-backend probe first; it relies on the real worktree URLs at steps 4-6 to surface the issue. |
| 3. Pin host-setup docs to `docs/host-setup.md` in lace | **Indirectly resolved**: docs are now mostly absorbed into the `lace doctor --portless` UX rather than a static doc. Phase 0 "Reversibility doc" line 167 still says "document the manual reversal in lace's README" without specifying the file. |
| 4. Add sentence to D4/D7 on per-project dev-script convention | Resolved in D4 (line 50: "Self-imposed limitation; document the dev script as canonical."). |
| 5. Argue generic-vs-portless-specific `hostAlias` in D7 | Resolved in D11 ("Generic over portless-specific reasoning" paragraph at line 120). |
| 6. NOTE on legacy-builder sequencing | **Not addressed**. The proposal assumes top-level `features` (Phase 2 diff) without noting the legacy-builder migration precondition. The repo has `M cdocs/proposals/2026-05-12-migrate-to-legacy-builder-cache.md` in flight. |
| 7. Clarify alias-state persistence in v1 | Resolved: the persistence is now scoped to `~/.config/lace/portless-runtime.json` for the host portless lifecycle. The per-project alias state is no longer being persisted (alias is fire-and-forget). The cleanup RFP becomes the canonical mechanism for stale-alias accounting. |
| 8. WARN callout on two state files | Resolved by 7: only one state file (the runtime JSON), not two. |
| 9. Verify `pnpm install` corepack routing | **Partially**: E8 carries forward the claim but Phase 5 does not explicitly verify it. |
| 10. "Interactive panes per worktree" note | **Not addressed**. Phase 1's `cmd_dev` `exec`s `portless ... pnpm dev`, which works fine in interactive panes; explicit acknowledgement still useful. |

Five of ten resolved cleanly. Five remain as carryover notes for round 4 cleanup; none of them are blocking by themselves.

## Section-by-Section Findings

### BLUF and Frontmatter

- **Non-blocking:** The BLUF is now three sentences and accurate. It states the mechanism (`hostAlias` + runtime host-portless), the durable state (one sysctl drop-in), and the pointer to the supplemental report. This is a substantial improvement over round 3's six-line BLUF.
- **Non-blocking:** "bundled via pnpm" in the BLUF is slightly imprecise — lace declares the `portless` dependency in `packages/lace/package.json`. Whether the lace install path uses pnpm, npm, or yarn is downstream of that declaration. Suggested rewording: "bundled as a runtime dependency."
- **Non-blocking:** Frontmatter `status: review_ready` is correct. `last_reviewed` shows round 3 with `@mjr`; this review supersedes it to round 4 `@claude-opus-4-7` on completion.

### Overview

- **Non-blocking:** The Overview's three-thing summary is well-factored. Compared to round 3's "four parts," this round explicitly subsumes the dev script into weftwise, container portless into a feature-adoption step, and the lace surface into a single bullet. This is cleaner.
- **Non-blocking:** "Lace gains a generic `hostAlias` port-metadata flag, a bundled portless dependency, a runtime host-portless manager, and a preflight check that prompts the user once for the unavoidable sysctl" — this enumerates four moving pieces in a single sentence. Consider splitting after "and a preflight check…" to align with the Proposed Solution's "four moving pieces" framing.

### Objective

- **Non-blocking:** Item 4 ("Minimal durable host state") is now a first-class objective. This is the correct elevation given the user's ask #3.
- **Non-blocking:** Item 4's phrasing "Only an auto-reversible sysctl drop-in. No global package installs, no systemd units the user must manage, no manual setup beyond the first sudo prompt." should also mention that lace bundles portless (item 4 is about durable state, but a reader looking for "no global installs" finds it in item 4 rather than tied to D9). Acceptable as is.

### Background

- **Non-blocking:** "Five load-bearing facts" is good framing; the fifth fact ("`.devcontainer/devcontainer.json` is already on top-level `features`") implicitly closes the round-3 action item #6 on legacy-builder sequencing — though it does so by asserting the migration has landed. Verify by checking weftwise's devcontainer.json before Phase 2; if false, Phase 2 needs to do the migration in the same PR.
- **Non-blocking:** Reference to `cdocs/reports/2026-05-13-worktree-portless-parallel-dev-prior-work.md` — verify this file exists. (Git status shows it as untracked; assume present.)

### Proposed Solution

- **Non-blocking:** The Mermaid diagram is clear. The `H_LACE` node correctly shows "spawned by lace up" and the "writes" arrow into `H_REG` (`~/.config/lace/portless-runtime.json`) is the new D8 state file. This matches Phase 3.
- **Non-blocking:** The diagram does not show the alias-shellout step (lace → portless CLI). A second arrow `H_LACE -- alias --> H_P` would close the loop visually.

### Phase 0: `lace doctor --portless` and host preflight

- **Non-blocking:** Four-status state machine is well-designed:
  - `ready` → proceed.
  - `needs-sysctl` → prompt + apply.
  - `needs-portless` → guarded as "should not occur."
  - `blocked` → abort with PID.
  Edge cases are handled: PID-reuse detection delegated to Phase 3's `getHostPortlessState`. Port-80 probe semantics are explicit.
- **Non-blocking:** The `needs-sysctl` branch's sudo command uses `sudo tee` + `sudo sysctl --system`. The `--yes` flag flow is reasonable. Recommend specifying:
  - Non-interactive default (i.e., when stdout is not a TTY): abort with the snippet printed, do not silently run sudo.
  - Interactive default: y/N prompt with no as the default (least surprise for users invoking `lace up` for the first time).
- **Non-blocking:** "exits 0 with status 1" (line 162) is a typo — pick exit code 0 or 1, not both.
- **Non-blocking:** Port-80 probe: `Attempt a TCP listen on 127.0.0.1:80 (in a child probe; close immediately).` This needs a subprocess because the lace parent has not yet `seteuid`-ed. Good. But: the child probe itself needs to bind on `0.0.0.0` (not `127.0.0.1`) if portless will bind there — verify upstream's default bind address. If portless binds only on `127.0.0.1`, the probe's `127.0.0.1` is correct; otherwise the probe may pass while portless fails.
- **Non-blocking:** The `needs-portless` branch says "should not occur (portless is a bundled dep); if it does, advise reinstalling lace." If the lace install is genuinely corrupt, the user is unlikely to have a working `lace doctor` to read this. Acceptable as a defensive belt-and-braces note.
- **Non-blocking:** Reversibility doc is documented as a manual two-command snippet plus an "out of scope" `lace setup --reverse`. Adequate for v1, with the caveat that the subcommand name drifts (see Verification of Source Claims above).

### Phase 1: Weftwise `scripts/worktree.sh dev`

- **Non-blocking:** `cmd_dev` is concrete and matches the existing script's idioms. The shape is implementable as written.
- **Non-blocking:** No `pnpm` PATH guard (round-1 action item carried). The `pnpm install` line will fail loudly if pnpm is missing; the failure message is `pnpm: command not found` rather than a script-level diagnostic, which is acceptable.
- **Non-blocking:** Carryover from round 3 N3: per-project dev scripts as convention. D4 acknowledges this; no further change needed at this level.

### Phase 2: Adopt portless in the weftwise container

- **Non-blocking:** One-line `devcontainer.json` change. The proposal does not address the round-3 action item #6 directly (legacy-builder precondition) but the Background fact 5 effectively asserts it as done. Verify before merging.
- **Non-blocking:** The path-based reference for local development (`"./devcontainers/features/src/portless": {}`) requires the consumer (weftwise) to have lace's source available at a relative path. Acceptable for development; production uses the registry reference.

### Phase 3: Lace host-portless runtime

- **Non-blocking:** Module API is clean. Three exported functions cover the lifecycle: `ensureHostPortlessRunning`, `getHostPortlessState`, `stopHostPortless`. State file shape includes `pid`, `startedAt`, `port`, `wildcard`, `portlessBinary`.
- **Non-blocking:** `ensureHostPortlessRunning()` reuse-vs-respawn logic is implementable. `/proc/<pid>/cmdline` check is the right PID-reuse defence; this is Linux-only but lace is already a Linux-only tool (devcontainer / rootless podman context).
- **Non-blocking:** Spawn pattern is correct: `spawn(process.execPath, [<cli.js>, ...], { detached: true, stdio: "ignore" })` + `child.unref()` is the textbook Node.js detached-child pattern. The `stdio: "ignore"` means logs are not captured; if portless crashes silently, lace has no visibility. For v1 acceptable; the runtime registry file is the primary observability.
  Recommend a brief follow-up note: if observability becomes important, switch to `stdio: ["ignore", fd, fd]` with log files at `~/.config/lace/host-portless.log`.
- **Non-blocking:** `--no-tls` flag in the spawn args is appropriate for HTTP-only initial scope (D6/D12). When HTTPS lands, this flag is the conditional path.
- **Non-blocking:** `PORTLESS_WILDCARD=1` is set in the env even though `--wildcard` is in the argv. Belt-and-braces, fine.
- **Non-blocking:** Polling for port 80 (100ms × 30 retries = 3s budget) is reasonable. If portless takes longer than 3s to bind, the user gets a spurious failure; bump to 60 retries (6s) for safety on slow systems, or expose a debug env var.
- **Non-blocking:** `stopHostPortless` uses SIGTERM → 2s wait → SIGKILL. Standard pattern. Good.

### Phase 4: `hostAlias` metadata + alias shellout

- **Blocking:** The `LacePortDeclaration` interface widening (one new line: `hostAlias?: boolean | string`) is necessary but not sufficient. The runtime extractor at `feature-metadata.ts:660-673` actively re-narrows port declarations by enumerating known fields:

  ```ts
  validatedPorts[key] = {
    label: typeof entry.label === "string" ? entry.label : undefined,
    onAutoForward: isValidAutoForward(entry.onAutoForward) ? entry.onAutoForward : undefined,
    requireLocalPort: typeof entry.requireLocalPort === "boolean" ? entry.requireLocalPort : undefined,
    protocol: isValidProtocol(entry.protocol) ? entry.protocol : undefined,
  };
  ```

  An incoming `hostAlias: true` from the feature manifest will be silently dropped at this extraction point, so the Phase 4 allocation loop (lines 404-413) will see `portDecl.hostAlias === undefined` for every port and skip every alias.
  Phase 4's "Files" list mentions only the interface widening, not the extractor. An implementer following the proposal verbatim will land the change, run the integration test, and observe zero shellouts because the extractor silently swallows the new field.

  **Required fix in Phase 4's Files section:** explicitly add the extractor branch:

  ```ts
  hostAlias: typeof entry.hostAlias === "boolean" || typeof entry.hostAlias === "string"
    ? entry.hostAlias as boolean | string
    : undefined,
  ```

  Also add a unit test for the extractor's `hostAlias` round-trip (parallel to the interface validation test).
  This is the only blocking issue in this round.

- **Non-blocking:** `hostAlias: boolean | string` schema is reasonable. The `true` (auto-derive) vs `"<string>"` (explicit) split is the right shape; rejecting `42` is the validation rule. D11 in the supplemental argues the generic-vs-portless-specific tradeoff correctly.
- **Non-blocking:** The Phase 4 allocation loop assumes `allocations` is iterable from somewhere in `up.ts`. The loop is right, but its placement in the file is not specified. From `up.ts:1064+` (the "Post-container verification" block), the extended config is already read; combining this with `PortAllocator.getAllocations()` requires lifting the allocator into scope. Implementer should be aware that the allocator is constructed earlier in `runUp` and may need to be passed through.
- **Non-blocking:** `lookupPortDeclaration(allocation.label, metadataMap)` — function name implies a helper that does not yet exist. Either it lives in `feature-metadata.ts` already or the proposal should name it as a new helper to write. Recommend a one-line clarification.
- **Non-blocking:** `registerHostAlias(aliasName, containerPortlessHostPort)` shells out via `node <portless-cli> alias <aliasName> <port>`. This assumes portless's `alias` subcommand exists with exactly this signature. Verify against upstream during Phase 0 (when bundled portless is added).

### Phase 5: End-to-end empirical validation

- **Non-blocking:** 11-step matrix is concrete and reproducible. Steps 1-3 verify the preflight + runtime, steps 4-6 cover the parallel-worktree path, step 7-8 cover the round-3 E3 "new worktree mid-session," step 9 covers multi-project, step 10 covers reboot recovery, step 11 covers the reversibility ask.
- **Non-blocking:** **Missing wildcard probe (R3 action #2 carried)**. The first step that depends on suffix matching is step 4 (`http://main.weftwise.localhost/` → HTTP 200). If `--wildcard` is "fallback for unregistered subdomains" rather than suffix matching, step 4 fails with no diagnostic distinguishing "alias not registered correctly" from "wildcard semantics not as expected."

  Recommend inserting a new step 0 (or step 1.5 after sysctl + spawn):

  > 0. `<bundled-portless> alias testfoo 8080 & python3 -m http.server 8080 & sleep 1 && curl -sf http://bar.testfoo.localhost/` — expect HTTP 200 if suffix matching is real. If 404, the per-branch fallback path needs to be implemented.

- **Non-blocking:** Step 7 "Add a new worktree on the host: `git worktree add ../feature-y` | New directory appears in container" — assumes the bare-worktree mount surfaces new worktrees automatically. This is the round-3 E3 outcome; correct, but recommend an explicit `ls /workspaces/weftwise/` check rather than the more passive "appears."
- **Non-blocking:** Step 9 "second project (e.g., whelm) with portless in features" — assumes whelm has adopted portless and the dev-script convention. State this as a precondition rather than letting the implementer discover it.
- **Non-blocking:** Step 10 reboot semantics are correctly tested. Good.
- **Non-blocking:** Step 11 reversal is the user's ask #3 satisfied at the test-plan level. Excellent.
- **Non-blocking:** Success criteria: "First `lace up --rebuild` wall time (excluding sudo prompt) under 90s." This is the same number from round 3. Reasonable budget; mention warm-image vs cold-image variance.

### Test Plan (consolidated)

- **Non-blocking:** Unit tests cover the four state-machine outcomes, spawn args, alive-PID probe, shellout arguments, and schema validation. Good coverage.
- **Non-blocking:** The integration test description mocks `runDevcontainerUp`. Recommend a complementary integration test that runs the full `runUp` pipeline against a fixture, with the spawn redirected to a dummy long-running process (e.g., `bash -c 'sleep 600'`) to verify the runtime module's spawn invocation reaches the right code path without an actual portless install in the test environment.
- **Non-blocking:** End-to-end maps to Phase 5's matrix. Good.
- **Non-blocking:** Weftwise-side smoke: error-path coverage (`no package.json`, `no portless`, `no node_modules`) is complete.

### Edge Cases

- **Non-blocking:** E1 (sysctl is system-wide) — surfaces D12's security framing without re-rendering it. Correct.
- **Non-blocking:** E2 (port-80 collision) — the preflight catches this; the runtime would not get the chance to fail. Clean.
- **Non-blocking:** E3 (PID reuse across reboot) — addressed by the `/proc/<pid>/cmdline` check. Correct.
- **Non-blocking:** E4 (wildcard alias matching) — restates the core assumption. Acceptable.
- **Non-blocking:** E5 (`--rebuild` for `appPort` changes) — carryover from earlier rounds.
- **Non-blocking:** E6 (new worktrees mid-session) — clean.
- **Non-blocking:** E7 (container hostname) — cosmetic.
- **Non-blocking:** E8 (pnpm version split-brain) — carryover from earlier rounds. The R3 action item asking for Phase 5 verification is still not threaded into the matrix.
- **Non-blocking:** E9 (multiple services per worktree) — correctly deferred.

### Open Questions

- **Non-blocking:** All five questions are well-framed and have answers. The HTTPS RFP prioritization (Q5) is consistent with D12.

### Summary section

- **Non-blocking:** Surface-area enumeration ("~400 lines across four new modules + a few touches in `up.ts`") is a useful sizing estimate.
- **Non-blocking:** Deviations are honestly surfaced (HTTPS, stale aliases, pinned portless version requiring lace releases for upgrades). All three have destinations.

### References

- **Non-blocking:** All references resolve cleanly. The decisions-report path is correct. The two follow-up RFP paths assume those files exist (verify if not already).

### Decisions Supplemental Report

I read the supplemental in full:

- **Non-blocking:** D1-D12 are all coherent, well-argued, and internally consistent.
- **Non-blocking:** D8 mentions `lace clean --portless` as a future subcommand; D10 mentions `lace setup --reverse` and `lace doctor --uninstall`; the proposal Phase 0 mentions `lace doctor --reset` and `lace doctor --uninstall`. **Naming drifts across four locations.** Pin one name.
- **Non-blocking:** D9 ("pnpm add -g @weftwiseink/lace") assumes the eventual published package name. This is a forward-looking decision; not load-bearing for this proposal.
- **Non-blocking:** D11 closes the round-3 N2 cleanly. Good explicit argument for the generic schema.
- **Non-blocking:** D12 surfaces the security implications correctly: local impostor risk + cookie/origin leakage. Both are real concerns on `*.localhost` with HTTP-only on :80. The recommended scheduling ("immediately after the initial proposal's Phase 5 completes") is appropriate.
- **Non-blocking:** D10's `99-lace-unprivileged-ports.conf` naming uses `99-` prefix, which is consistent with sysctl drop-in conventions (later files override earlier). Other tooling that writes a higher-numbered drop-in could override; vanishingly unlikely in practice.

## Verdict

**Revise.**

One blocking issue: Phase 4's `hostAlias` will be silently dropped at the runtime extractor in `feature-metadata.ts:660-673` unless the extractor is also widened. The Phase 4 Files list and the unit-test section both omit this. An implementer following the proposal verbatim would land a non-functional change.

All other findings are non-blocking polish:

- The subcommand name for the reversal/reset operation drifts across Phase 0, Phase 3 Acceptance, Open Questions, D8, and D10. Pin one name (recommendation: `lace doctor --reset` for the runtime-state reset, `lace doctor --uninstall` for the sysctl drop-in removal — different operations, different names).
- The `--wildcard` semantics empirical probe (R3 action #2) is still not threaded into Phase 5's matrix. Add a step 0.
- The legacy-builder precondition (R3 action #6) is implicitly asserted but not explicitly noted.
- The Phase 5 `pnpm install` corepack verification (R3 action #9) is still not in the matrix.
- The non-interactive `lace up` behaviour for the sysctl prompt should be specified (default abort vs default proceed under `--yes`).
- The Phase 0 exit-code typo on line 162.

The proposal is materially closer to implementation-ready than round 3 was. Once Phase 4 is patched, this is an Accept.

## Action Items

1. **[blocking]** In Phase 4, extend the Files list to include the extractor branch in `feature-metadata.ts:660-673` (the `extractLaceCustomizations` runtime narrowing block). Add the `hostAlias` field to the validated port shape with a `typeof === "boolean" || typeof === "string"` guard. Add a unit test for the extractor's `hostAlias` round-trip in addition to the schema-level validation test. Without this, `hostAlias: true` from feature manifests is silently dropped before the allocation loop in `up.ts` sees it.

2. **[non-blocking]** Pin the reversal/reset subcommand naming across Phase 0 line 168, Phase 3 line 329, Open Questions Q4 line 551, D8 line 82, and D10 line 109. Recommendation: `lace doctor --reset` resets the runtime state (kills host portless, removes the runtime JSON); `lace doctor --uninstall` removes the sysctl drop-in. Two different operations, two different names.

3. **[non-blocking]** Add a Phase 5 step 0 (or step 1.5) that empirically probes `--wildcard` suffix-matching semantics with a synthetic backend before relying on it for the real worktree URLs. R3 action #2 carryover.

4. **[non-blocking]** Add a NOTE under Background or Phase 2 stating the legacy-builder migration precondition. The proposal asserts top-level `features` in Background fact 5; if the migration is not yet landed, Phase 2 should include the migration in the same PR. R3 action #6 carryover.

5. **[non-blocking]** Add a step to Phase 5 that verifies `pnpm install` invoked by `worktree.sh dev` resolves via corepack/`packageManager: pnpm@10.26.2` rather than the login-shell `pnpm` at 11.1.1. R3 action #9 carryover.

6. **[non-blocking]** In Phase 0, specify the non-interactive default for the sysctl prompt: if stdout is not a TTY (e.g., CI, scripted invocation), abort with the snippet printed; do not silently apply.

7. **[non-blocking]** Fix the exit-code typo in Phase 0 line 162: "exits 0 with status 1" — pick one.

8. **[non-blocking]** Clarify in Phase 4 whether `lookupPortDeclaration(allocation.label, metadataMap)` is an existing helper or a new one to write. If new, add it to the Files list.

9. **[non-blocking]** Verify the bind address used by portless on host (`0.0.0.0` vs `127.0.0.1`) and update the Phase 0 port-80 probe to match. If portless binds on `0.0.0.0`, the probe should too.

10. **[non-blocking]** Add a second arrow to the Proposed Solution Mermaid diagram showing the alias-shellout step (`H_LACE -- alias --> H_P`) so the diagram reflects all four moving pieces.

11. **[non-blocking]** Reword the BLUF's "bundled via pnpm" to "bundled as a runtime dependency" — the package-manager choice is downstream of the dependency declaration.

12. **[non-blocking]** Phase 3: bump the port-80 readiness poll budget from 3s (30×100ms) to 6s (60×100ms) to absorb slow-system variance, or surface as a debug env var.

## Questions for the Author (multi-choice, non-blocking)

**Q1: Reversal/reset subcommand naming.**

The proposal references three different command names across five locations. Pick one consistent shape:

- (a) `lace doctor --reset` (runtime state only) + `lace doctor --uninstall` (sysctl drop-in). Two distinct operations, two distinct names. Recommended.
- (b) `lace setup --reverse` for everything (sysctl + runtime). Single command, single operation, but conflates two reversibility surfaces.
- (c) `lace clean --portless` (kills host portless) + `lace setup --reverse` (sysctl + runtime). Yet another split.

**Q2: Phase 5 `--wildcard` probe placement.**

- (a) Insert a synthetic-backend probe as step 0 of Phase 5, before any worktree-level measurement. Recommended.
- (b) Make the probe a Phase 3 acceptance criterion (gates Phase 5 entirely).
- (c) Leave as is and discover via the real worktree URLs in steps 4-6.

**Q3: Phase 4 extractor widening.**

- (a) Add the `hostAlias` extractor branch in `feature-metadata.ts:660-673` as part of the Phase 4 Files list (blocking fix). Recommended.
- (b) Add the extractor widening as a separate `feature-metadata-extractor.ts` task before Phase 4.
- (c) Bypass the extractor entirely; have `up.ts` re-read the raw feature manifest for `hostAlias`. Adds duplication.

**Q4: Sysctl prompt non-interactive default.**

- (a) Non-interactive context (no TTY): abort with snippet printed; no silent sudo. Recommended.
- (b) Non-interactive context: silently apply via sudo if `--yes` is passed; abort otherwise.
- (c) Non-interactive context: silently apply via sudo regardless. Most aggressive, most surprising.

**Q5: Bundled-portless observability.**

The Phase 3 spawn uses `stdio: "ignore"`. If host portless silently crashes, lace has no visibility.

- (a) Keep `stdio: "ignore"` for v1; defer observability to a follow-up RFP.
- (b) Capture stdout/stderr to `~/.config/lace/host-portless.log` from v1.
- (c) Capture to the runtime JSON's path field for the log location, but enable only via debug env var.
