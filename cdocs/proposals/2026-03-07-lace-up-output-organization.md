---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-07T12:00:00-06:00
task_list: lace/devx
type: proposal
state: live
status: review_ready
tags: [lace-up, output-organization, devx, logging, error-reporting, agent-friendly]
---

# Structured Output Organization for `lace up`

> BLUF: `lace up` currently dumps 2600+ lines of raw Docker build output, progress bars, and apt-get logs on failure, making it nearly impossible for a human or agent to find the actual error. This proposal introduces a three-layer output architecture: (1) a concise **summary view** shown to the user by default that ends with a single actionable next step, (2) a **structured log file** written to `.lace/logs/` with phase-separated sections and machine-parseable markers, and (3) a **filtered verbose mode** (`--verbose`) that streams output in real time but strips progress noise. The implementation reuses the existing `UpResult.phases` structure and `LACE_RESULT` JSON line, extending them rather than replacing them.
>
> - **Motivated by:** Real failure output at `tmp/weftwise-lace-up-output.log` (2601 lines, ~98% noise, actual error buried at line 1274)

## Objective

When `lace up` fails, the user (or more commonly, a Claude agent acting on their behalf) needs to quickly understand what went wrong and what to do next. Today, the entire raw output of `devcontainer up` -- which includes Docker BuildKit step output, apt-get package lists, wget progress bars, pnpm resolution lines, and Playwright download bars -- is dumped to stderr in an undifferentiated wall of text. The actual error (`cannot copy to non-directory: .../node_modules/tsx` at Dockerfile step 14/15) is buried under hundreds of lines of successful step output, and then the entire build log is repeated a second time as part of the error message.

The goal is:

1. **For humans**: A failed `lace up` should produce at most 10-20 lines of output, ending with a clear "next step" instruction.
2. **For agents**: A structured log file should exist at a predictable path, with phase boundaries and error sections clearly marked, so an agent can be pointed at it and extract the relevant context without processing 2600 lines.
3. **For debugging**: The full raw output should still be retained, but separated from the user-facing output.

## Background

### Current Architecture

`lace up` runs through a multi-phase pipeline defined in `packages/lace/src/lib/up.ts`:

1. Workspace layout detection
2. Host validation
3. Feature metadata fetch and validation
4. Template resolution (ports, mounts)
5. Prebuild (calls `devcontainer build` via subprocess)
6. Mount resolution
7. Config generation (writes `.lace/devcontainer.json`)
8. `devcontainer up` invocation (calls `devcontainer up` via subprocess)

Each phase populates `UpResult.phases` with exit codes and messages. On completion, the `up` command (in `packages/lace/src/commands/up.ts`) emits a `LACE_RESULT` JSON line to stderr with `exitCode`, `failedPhase`, and `containerMayBeRunning`.

### Current Output Handling

The subprocess runner (`packages/lace/src/lib/subprocess.ts`) uses `execFileSync` with `stdio: ["pipe", "pipe", "pipe"]`, capturing all stdout and stderr into strings. This means:

- During execution, the user sees **nothing** -- no progress indication at all.
- On failure, the entire captured stderr is dumped via `console.error(upResult.stderr)` at line 620 of `up.ts`.
- The `devcontainer up` command itself passes through raw Docker BuildKit output, which includes interleaved timestamp-prefixed lines, build step numbers, and package manager progress indicators.

### Noise Categories in the Raw Output

Analysis of `tmp/weftwise-lace-up-output.log` (2601 lines) reveals these noise categories:

| Category | Example | Lines | % |
|----------|---------|-------|---|
| apt-get package fetch/install | `Get:47 http://deb.debian.org/...` | ~700 | 27% |
| Docker build step output (successful) | `#6 [dev_container_auto_added_stage_label 2/15] RUN...` | ~200 | 8% |
| Package unpack/setup | `Unpacking libdrm2:amd64...` / `Setting up libdrm2...` | ~500 | 19% |
| wget/curl progress bars | `.......... .......... 42% 58.6M 0s` | ~100 | 4% |
| Playwright download bars | `\|##############\| 60% of 164.7 MiB` | ~40 | 2% |
| pnpm progress lines | `Progress: resolved 73, reused 70...` | ~20 | 1% |
| Devcontainer CLI timestamps | `[2026-03-07T16:33:22.364Z]` | (prefix on most lines) | -- |
| **Duplicate: entire log repeated in error message** | Lines 1314-2599 | ~1286 | 49% |
| **Actual error** | `#18 ERROR: cannot copy to non-directory...` | ~15 | 0.6% |
| Lace's own phase output | `Fetching feature metadata...` | ~20 | 0.8% |

The duplication is the single biggest contributor to noise: when `devcontainer up` fails, it includes the full build log in its error message, and then `lace up` dumps that error message (which contains the full log) to stderr. The result is the entire build output appearing twice.

### Existing Infrastructure

- `.lace/` directory already exists as lace's output directory (contains `devcontainer.json`, `port-assignments.json`, `mount-assignments.json`, `prebuild/`).
- `LACE_RESULT` JSON line already provides machine-readable exit info on stderr.
- `UpResult.phases` already tracks per-phase outcomes with exit codes and messages.
- The `bin/` directory (referenced in worktree scripts like `wez-into`) already consumes `LACE_RESULT` for downstream decision-making.

## Proposed Solution

### Three-Layer Output Architecture

#### Layer 1: Summary View (default, to terminal)

On success, output is unchanged -- lace already prints concise phase progress messages (`Fetching feature metadata...`, `Validated metadata for 5 feature(s)`, etc.).

On failure, instead of dumping the raw subprocess output, lace prints:

```
lace up failed at phase: devcontainerUp

  Docker build step 14/15 (COPY) failed:
  ERROR: cannot copy to non-directory: /var/lib/docker/overlay2/.../node_modules/tsx

  Full log: .lace/logs/up-2026-03-07T163321.log (2601 lines)
  Error context: .lace/logs/up-2026-03-07T163321.log:1274

  Next step: Run `lace up --verbose` to see full output, or point an agent at the log file above.
```

This is achieved by:
1. Writing the full subprocess output to a log file before processing it.
2. Extracting error lines from the output using pattern matching.
3. Printing only the extracted error summary and the log file path.

#### Layer 2: Structured Log File (always written to `.lace/logs/`)

Every `lace up` invocation writes a structured log file to `.lace/logs/up-<ISO-timestamp>.log`. The log file contains:

```
=== LACE UP LOG ===
timestamp: 2026-03-07T16:33:21Z
workspace: /var/home/mjr/code/weft/weftwise/main
lace_version: 0.1.0

=== PHASE: workspaceLayout ===
status: ok
Auto-configured for worktree 'main' in /var/home/mjr/code/weft/weftwise

=== PHASE: metadataValidation ===
status: ok
Validated metadata for 5 feature(s)

=== PHASE: templateResolution ===
status: ok
Allocated ports:
  wezterm-server/hostSshPort: 22425

=== PHASE: prebuild ===
status: ok
Building prebuild image: lace.local/node:24-bookworm

=== PHASE: devcontainerUp ===
status: failed
exit_code: 1

--- RAW STDOUT ---
(full stdout from devcontainer up)

--- RAW STDERR ---
(full stderr from devcontainer up)

--- EXTRACTED ERRORS ---
Line 1274: #18 ERROR: cannot copy to non-directory: /var/lib/docker/overlay2/.../node_modules/tsx
Line 1289: ERROR: failed to build: failed to solve: cannot copy to non-directory: ...

=== RESULT ===
{"exitCode":1,"failedPhase":"devcontainerUp","containerMayBeRunning":false}
```

Key properties:
- Phase boundaries marked with `=== PHASE: <name> ===` for easy grep/parsing.
- Raw output separated into stdout and stderr sections.
- Extracted errors section provides a pre-filtered view.
- Machine-readable `=== RESULT ===` section at end for agent consumption.
- Log rotation: keep last 10 log files, delete older ones.

#### Layer 3: Verbose Mode (`--verbose`)

A new `--verbose` flag causes lace to stream subprocess output to the terminal in real time, but with noise filtering applied. This replaces the current behavior where nothing is shown during execution and then everything is dumped on failure.

Verbose mode filters:
- Strips wget/curl progress bars (lines matching `^\s*\d+K\s+\.{10}`)
- Strips Playwright/Chromium download bars (lines matching `\|[# ]+\|\s+\d+%`)
- Strips pnpm progress lines (lines matching `^Progress: resolved`)
- Collapses consecutive apt-get `Get:` lines into a summary (`Fetching 109 packages...`)
- Collapses consecutive `Unpacking`/`Setting up` lines into a summary
- Preserves Docker build step headers (`#N [stage M/N] RUN ...`)
- Preserves all error and warning lines
- Preserves the devcontainer CLI version/platform header

Implementation: Use `child_process.spawn` instead of `execFileSync` when `--verbose` is active, reading stdout/stderr line-by-line and applying filter rules before printing to the terminal. The full unfiltered output is still written to the log file simultaneously.

### Error Extraction

The error extractor scans the raw subprocess output for high-signal lines:

```typescript
interface ExtractedError {
  line: number;
  text: string;
  source: "docker-build" | "devcontainer-cli" | "feature-install" | "unknown";
}

function extractErrors(output: string): ExtractedError[] {
  // Patterns, in priority order:
  // 1. Docker build errors: "#N ERROR:", "ERROR: failed to build"
  // 2. Devcontainer CLI errors: "Error:" at start of line, "Exit code N" where N > 0
  // 3. Feature install errors: lines containing "FAILED" or "error:" (case-insensitive)
  //    within a feature install step context
  // 4. Dockerfile context: ">>>" marker lines from Docker error output
}
```

The extractor also identifies the **failed Docker build step** by finding the last `#N [stage M/T]` header before the first error line, providing context like "Docker build step 14/15 (COPY) failed".

### Deduplication

The current double-output problem (where the build log appears once as raw output and again inside the error message) is addressed by:

1. Capturing the `devcontainer up` stderr.
2. Detecting the duplicate pattern: if the stderr contains a `Start: Run: docker buildx build` line, everything after `devcontainer up failed:` is likely a repeat of the build log.
3. Truncating the error message at the duplication boundary and replacing it with a reference to the log file.

## Important Design Decisions

### Decision: Log files go in `.lace/logs/`, not a system-wide directory

**Why:** `.lace/` is already the per-project output directory for lace artifacts. Putting logs there keeps them co-located with the project they belong to, makes them easy to find (no need to know `$XDG_STATE_HOME` or similar), and makes cleanup simple (delete `.lace/` to reset everything). It also means the logs are visible to agents working in the project directory. The trade-off is that `.lace/logs/` should be in `.gitignore`, but `.lace/` already should be gitignored (it contains generated `devcontainer.json`, port assignments, etc.).

### Decision: Use `spawn` for verbose mode, keep `execFileSync` for default mode

**Why:** The default (summary) mode benefits from synchronous execution -- lace can capture all output, process it, and present a clean summary. Verbose mode needs streaming, which requires `spawn`. Rather than converting the entire subprocess infrastructure to async, we add a parallel path: `runSubprocessStreaming` alongside the existing `runSubprocess`. The `--verbose` flag selects which path to use. This avoids a large refactor of the existing test infrastructure that relies on synchronous subprocess mocking.

### Decision: Filter patterns are hardcoded, not configurable

**Why:** The noise patterns (progress bars, package lists, etc.) come from well-known tools (Docker BuildKit, apt-get, wget, pnpm, Playwright) whose output formats are stable. Making filters configurable would add complexity without clear benefit -- if a new tool starts producing noise, the right fix is to add a new filter pattern in the lace codebase, not to ask users to configure regex patterns. The full unfiltered output is always available in the log file for cases where the filter removes something important.

### Decision: Keep `LACE_RESULT` on stderr, add log path to it

**Why:** `LACE_RESULT` is already consumed by downstream scripts (`wez-into` etc.) that parse it from stderr. Changing its location would break those consumers. Instead, we extend the JSON payload to include a `logFile` field pointing to the structured log, giving agent consumers a direct path to detailed diagnostics.

### Decision: Summary view extracts errors rather than requiring `--verbose` to see them

**Why:** The most common failure scenario is a user (or agent) running `lace up` and getting an error. They should not need to re-run the command with `--verbose` to understand what happened -- the error information is already captured in the subprocess output. Extracting and displaying the error summary from the captured output provides immediate value without requiring a re-run. The `--verbose` flag is for cases where the user wants to watch progress in real time or needs more context than the extracted errors provide.

## Stories

### Story 1: Human user encounters a build failure

A developer runs `lace up` in a new project. The Docker build fails because a `COPY` instruction conflicts with a symlinked `node_modules` entry. Instead of 2600 lines of output, they see 8 lines: the phase that failed, the Docker error, the log file path, and a "next step" instruction. They can either fix the issue themselves based on the error message or paste the log file path into a Claude conversation for diagnosis.

### Story 2: Agent troubleshoots a failed `lace up`

A Claude agent running in `wez-into` detects that `lace up` failed. It reads the `LACE_RESULT` JSON from stderr, extracts the `logFile` path, reads the structured log, and jumps directly to the `=== PHASE: devcontainerUp ===` section. It finds the `--- EXTRACTED ERRORS ---` subsection and diagnoses the issue without processing apt-get output.

### Story 3: Developer wants to watch a long build

A developer is doing a cold build that involves prebuild + feature installation + full `devcontainer up`. They run `lace up --verbose` and see a filtered stream of build progress: Docker step headers, feature installation summaries, and any warnings or errors, but not the 500 lines of `Setting up libfoo:amd64...` output.

### Story 4: Intermittent network failure during feature install

The prebuild phase fails because a GitHub release download times out. The summary view shows the phase (`prebuild`), the error (`wget: connection timed out`), and the log file path. The agent reads the log, sees the failed step was downloading `git-delta`, and suggests retrying with `lace up` (transient failure) or checking network connectivity.

## Edge Cases / Challenging Scenarios

### Interleaved stdout/stderr from Docker BuildKit

Docker BuildKit interleaves stdout and stderr within a single stream. The devcontainer CLI captures this and re-emits it with timestamps. When parsing for errors, we cannot assume errors only appear on stderr -- Docker `#N ERROR:` lines may appear on either stream. The error extractor must scan both stdout and stderr from the subprocess result.

### Very long build output exceeding buffer limits

The current `execFileSync` uses `maxBuffer: 10 * 1024 * 1024` (10 MB). For extremely large builds, this could be exceeded. The streaming mode (`spawn`) avoids this entirely by writing directly to the log file. For the default mode, we should increase `maxBuffer` and add a fallback that writes partial output to the log file if the buffer is exceeded.

### Log file cleanup race conditions

Multiple `lace up` invocations for the same project (e.g., from different terminal tabs) could create log files simultaneously. Using ISO timestamps with millisecond precision in the filename avoids collisions. The cleanup routine (delete logs older than the 10 most recent) should use `readdir` + sort rather than glob to avoid TOCTOU races.

### Prebuild vs. devcontainerUp error differentiation

Both the prebuild phase and the devcontainerUp phase shell out to `devcontainer` subcommands. The error extraction needs to know which phase produced the output. Since phases run sequentially and each phase's output is captured separately (prebuild via `runPrebuild`, devcontainerUp via `runDevcontainerUp`), the log writer can tag each section with the correct phase.

### Backward compatibility for `LACE_RESULT` consumers

The `LACE_RESULT` JSON format is extended with a new `logFile` field. Existing consumers that destructure only `exitCode`, `failedPhase`, and `containerMayBeRunning` are unaffected because additional JSON fields are silently ignored in JavaScript destructuring. The new field is optional -- it is omitted if log writing fails for any reason.

## Implementation Phases

### Phase 1: Log File Infrastructure

**Goal:** Every `lace up` invocation writes a structured log file to `.lace/logs/`.

**Changes:**
- Create a `LogWriter` class in `packages/lace/src/lib/log-writer.ts` that manages log file creation, phase section writing, and cleanup.
- Modify `runUp()` in `up.ts` to instantiate a `LogWriter` at the start of the pipeline and pass it through phases.
- After each phase completes, write its result to the log file.
- For the `devcontainerUp` phase, write both the raw stdout/stderr and extracted errors.
- Add log rotation: on each invocation, delete all but the 10 most recent `.lace/logs/up-*.log` files.
- Add `logFile` field to the `LACE_RESULT` JSON output.

**Files to modify:** `packages/lace/src/lib/up.ts`, `packages/lace/src/commands/up.ts`
**Files to create:** `packages/lace/src/lib/log-writer.ts`
**Constraints:** Do not change the `RunSubprocess` type signature or the test mock infrastructure. The `LogWriter` receives output after subprocess completion, not during.

**Verification:** Unit tests for `LogWriter` (phase writing, rotation, cleanup). Integration test: run `lace up --skip-devcontainer-up` and verify `.lace/logs/up-*.log` is created with correct phase sections.

### Phase 2: Error Extraction

**Goal:** Extract actionable error lines from raw subprocess output.

**Changes:**
- Create an `extractErrors()` function in `packages/lace/src/lib/error-extractor.ts`.
- Implement pattern matchers for Docker build errors, devcontainer CLI errors, feature install errors, and Dockerfile context lines.
- Implement `identifyFailedStep()` to find the Docker build step that failed.
- Implement `deduplicateOutput()` to detect and truncate the repeated build log in `devcontainer up` error messages.
- Integrate with `LogWriter` to write the `--- EXTRACTED ERRORS ---` section.

**Files to create:** `packages/lace/src/lib/error-extractor.ts`
**Files to modify:** `packages/lace/src/lib/log-writer.ts`

**Verification:** Unit tests with fixture data from `tmp/weftwise-lace-up-output.log`. Test cases:
- Docker COPY error is extracted with correct line number.
- Failed build step is identified as "14/15 (COPY)".
- Duplicated build log is detected and truncated.
- Non-error output is not included in extracted errors.

### Phase 3: Summary View on Failure

**Goal:** Replace the raw stderr dump with a concise error summary.

**Changes:**
- Modify the failure path in `runUp()` (lines 617-621 of `up.ts`) to use the error extractor instead of dumping raw stderr.
- Print: failed phase name, extracted error summary (max 5 lines), log file path with line number, and a "next step" instruction.
- For non-devcontainerUp phases (prebuild, metadata validation, etc.), the existing error messages are already concise -- leave those unchanged.
- Keep `console.error(upResult.stderr)` only when the error extractor finds zero errors (fallback to old behavior).

**Files to modify:** `packages/lace/src/lib/up.ts`, `packages/lace/src/commands/up.ts`

**Verification:** Integration test: mock a `devcontainer up` failure with Docker build error output, verify the console output is under 20 lines and contains the error message, log path, and next step instruction.

### Phase 4: Verbose Streaming Mode

**Goal:** `--verbose` flag streams filtered output in real time.

**Changes:**
- Add a `runSubprocessStreaming()` function in `packages/lace/src/lib/subprocess.ts` that uses `child_process.spawn` and returns a `Promise<SubprocessResult>`.
- Create an `OutputFilter` class in `packages/lace/src/lib/output-filter.ts` with rules for stripping progress bars, collapsing package lists, and preserving errors/step headers.
- Add `--verbose` flag to the `up` command args in `packages/lace/src/commands/up.ts`.
- When `--verbose` is set, use `runSubprocessStreaming` for the prebuild and devcontainerUp phases. The filter reads lines from the child process, writes filtered lines to the terminal, and writes unfiltered lines to the log file simultaneously.
- The `runUp` function signature gains an optional `verbose` boolean that selects streaming vs. sync subprocess execution for the phases that shell out.

**Files to create:** `packages/lace/src/lib/output-filter.ts`
**Files to modify:** `packages/lace/src/lib/subprocess.ts`, `packages/lace/src/lib/up.ts`, `packages/lace/src/commands/up.ts`
**Constraints:** Do not modify the existing `runSubprocess` function or its tests. The streaming variant is a separate export. The `RunSubprocess` type used by test mocks is not changed -- tests continue to use the synchronous mock.

**Verification:** Unit tests for `OutputFilter` with sample input containing progress bars, package lists, and errors. Verify filtered output preserves step headers and errors while removing noise. Manual verification of real-time streaming against a live Docker build.

### Phase 5: Agent Ergonomics

**Goal:** Make the structured log optimally consumable by Claude agents.

**Changes:**
- Add a `lace up --last-log` convenience flag that prints the path to the most recent log file. Useful for agents that need to find the log without parsing `LACE_RESULT`.
- Add a `lace up --show-errors` flag that re-reads the most recent log file and prints only the `--- EXTRACTED ERRORS ---` section. Useful for agents that want error context without re-running.
- Document the log file format and phase markers in `CONTRIBUTING.md` so that agent instructions (CLAUDE.md files) can reference the conventions.
- Ensure the `LACE_RESULT` JSON includes `logFile` path and `errorSummary` (first extracted error, truncated to 200 chars) for quick agent triage without reading the log file.

**Files to modify:** `packages/lace/src/commands/up.ts`, `CONTRIBUTING.md`

**Verification:** Manual test: run `lace up`, observe `LACE_RESULT` contains `logFile`. Run `lace up --last-log`, verify it prints the correct path. Run `lace up --show-errors`, verify it prints extracted errors from the most recent log.

## Open Questions

1. **Should `.lace/logs/` be gitignored by `lace init`?** Currently `.lace/` as a whole is expected to be gitignored. If `lace init` is implemented (per the existing RFP), it should add `.lace/` to `.gitignore`. But projects that already use lace might not have this entry. Should `lace up` warn if `.lace/` is not gitignored?

2. **Should the log file include lace's own phase output (the `console.log` calls)?** Currently lace's phase progress messages go to stdout. The log file could capture these too by redirecting lace's own console output through the `LogWriter`. This would make the log file fully self-contained but adds complexity. Phase 1 could start with just subprocess output and add lace's own output later.

3. **Should there be a `--quiet` mode that suppresses even the summary?** Some CI environments might want only the exit code. The `LACE_RESULT` JSON on stderr already serves this purpose, but a `--quiet` flag could suppress even the phase progress messages during a successful run.
