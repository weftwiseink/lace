---
review_of: cdocs/reports/2026-09-06-sandbox-containment-security-audit.md
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-06T12:05:00-07:00
task_list: lace/security-audit/sandbox-containment
type: review
state: live
status: wip
tags: [fresh_agent, security, containment, code_verified, runtime_validation_pending]
---

# Review: Sandbox Containment Security Audit

## Summary Assessment

The report answers the owner's question ("other than reading Claude state, how easily could a compromised agent break containment?") by showing that the framing understates the exposure: the same shared `~/.claude` mount is a live host-credential store and a write-back code-execution channel, not just a cross-project reader.
I independently verified every CONFIRMED finding and every key-positive reassurance against the actual code, at the cited files and line ranges, checking mode (ro/rw), resolved source path, and behavior.
All CONFIRMED findings are technically accurate, the SUSPECTED findings are correctly labelled and not overstated, and the severity ranking is sound.

Verdict: **Accept**.
No blocking findings.
F1 is correctly the top finding, and I concur with the CRITICAL rating.
The non-blocking notes below are precision improvements, chiefly that one CONFIRMED sub-claim (the `.credentials.json` plaintext file existing on this host) is a host-state assumption rather than a code fact and belongs in the live-verification list.

## Verification Log

Each CONFIRMED claim was read at source. Results:

| Claim | Cited location | Verified | Result |
|-------|----------------|----------|--------|
| F1 `config`/`config-json` mounts declare no `readonly`, source `~/.claude` + `~/.claude.json` | `claude-code/devcontainer-feature.json:20-33` | yes | Accurate. Description literally reads "configuration, credentials, and session state". |
| F1 recommendedSource resolves to live host path, no `readonly` token emitted | `mount-resolver.ts:351-380`, `resolveFullSpec:468-498` | yes | Accurate. `resolveFullSpec` pushes `readonly` only `if (decl.readonly)` (line 489); the declarations set none, so the bind is rw. |
| F1 `CLAUDE_CONFIG_DIR` wired to the mount target | `.devcontainer/devcontainer.json:61` | yes | Accurate: `"${lace.mount(claude-code/config).target}"`. |
| F2 neovim `plugins` mount, source `~/.local/share/nvim`, no `readonly` | `neovim/devcontainer-feature.json:20-27` | yes | Accurate, same rw resolution path as F1. |
| F3 `NOPASSWD:ALL` sudoers grant | `.devcontainer/Dockerfile:70` | yes | Exact: `echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME}`. |
| F5 denylist gates only `user.json` mounts | `user-config.ts:293-346`, call site `up.ts:420` | yes | Accurate. `validateMountSources` is invoked exactly once, only against `userConfig.mounts` (label `user/${name}`). No other call site exists. |
| F5 denylist contents (ssh, gnupg, aws, kube, gh, docker.sock, podman socket, containers) | `user-config.ts:48-86` | yes | Accurate; also covers `~/`, gcloud, azure, op, npmrc, netrc, keyrings, password-store. |
| F6 `curl \| sh` chezmoi install | `lace-fundamentals/steps/chezmoi.sh:7` | yes | Exact. |
| F6 dotfiles repoMount `readonly: false` | `.devcontainer/devcontainer.json:36-37` | yes | Accurate. |
| Key positive: no `--privileged`/`--cap-add`/`--security-opt`/`--pid=host`/`--network=host`/`--device` | whole-repo grep | yes | Confirmed. Only match is a false positive: the word "Unprivileged" in a `host-portless.ts` comment. |
| Key positive: lace injects only `--label` + `--name` into runArgs | `up.ts:1485-1492` | yes | Accurate. |
| Key positive: `runDevcontainerUp` adds only benign flags | `up.ts:1532-1580` | mostly | Accurate for security purposes. The report's list omits `--remove-existing-container` (conditional) and two `podman rm/rmi` cleanup calls, but none add a security-relevant runtime flag. |
| Key positive: no container socket mounted; denylist blocks it | `user-config.ts:78-85` | yes | Accurate. |
| Posture: `repoMounts` default `readonly: true` | `mounts.ts` (`override.readonly ?? true`, clone default `readonly: true`) | yes | Accurate. |
| Posture: sprack `data` mount project-scoped | `sprack/devcontainer-feature.json:22` | yes | Accurate: `~/.local/share/sprack/lace/${lace.projectName}`. |
| F4 `appPort` emitted as bare `port:port` | `template-resolver.ts:706-740` | yes | Accurate: `result.appPort.push(\`${alloc.port}:${alloc.port}\`)`. |
| F4 port range 22425-22499 | `port-allocator.ts:8-9` | yes | Accurate. |
| F4 `getContainerHostPorts` parses `0.0.0.0` | `up.ts:109` | yes | Accurate comment/parse. |
| Portless pin rationale (0.15.4 loopback-only) | `portless/devcontainer-feature.json:15-16` | yes | Quoted accurately. |

## Section-by-Section Findings

### BLUF and Threat Model

Strong.
The BLUF leads with the correct dual message: the kernel boundary holds, but the data layer is broken by design, and the easiest break (host OAuth token theft) is worse than the accepted "reads other projects' state" framing.
No surprises surfaced during verification, which is the test a good BLUF should pass.
The trust-boundary ordering and the (a)/(b)/(c) threat decomposition are clear and are used consistently in the findings table.
Non-blocking.

### F1 (CRITICAL): shared rw `~/.claude`

Accurate and correctly the top finding.
The mount is rw (verified: no `readonly` token is emitted because the declaration sets none), it resolves to the single fixed live host `~/.claude` for every project, and `.credentials.json` is therefore reachable by `cat` from any container.
The report correctly splits confidence: credential read is CONFIRMED and TRIVIAL; the settings.json write-back host-RCE pivot is explicitly hedged as MODERATE and partly SUSPECTED, with the host-side trigger deferred to live verification.
That is the right calibration: it does not oversell the pivot as proven.

One precision gap, non-blocking: the sub-claim "`~/.claude/.credentials.json` on Linux holds the OAuth tokens" is presented as CONFIRMED, but whether the token lives in that plaintext file versus the system keyring (libsecret) is a host-state fact, not a code fact, and it is not verifiable from the lace source.
The entire TRIVIAL-credential-theft severity hinges on that file existing in the mounted directory.
Recommend adding "confirm `.credentials.json` exists as a plaintext file under `~/.claude` on this host" to the Verification Needed list, so the one load-bearing non-code assumption is tracked like the others.

### F2 (HIGH): shared rw `~/.local/share/nvim`

Accurate.
Same rw resolution path as F1, verified.
HIGH (versus F1's CRITICAL) is justified: the payload requires the victim to open `nvim`, whereas F1's credential read requires nothing.

### F3 (HIGH, contained by userns): `NOPASSWD:ALL`

Accurate and honestly caveated.
The sudoers line is exact, and the report correctly states this is container root, not host root, under `--userns=keep-id`, so it does not itself cross the kernel boundary.
The "High (contained by userns)" annotation is the right way to express a finding that is severe in-box but bounded.
A reasonable reviewer could argue for MEDIUM given the containment, but framing it as the enabler that defeats in-container hardening for F1/F2/F5 justifies HIGH. Not miscalibrated.

### F5 (HIGH): asymmetric mount policy

Accurate and important.
Verified there is exactly one `validateMountSources` call site and it runs only against `userConfig.mounts`.
The "untrusted repo you `lace up` can bind your SSH keys" claim is real: a project `.devcontainer/devcontainer.json` raw `mounts` string, a `settings.json` override (which flows through `MountPathResolver`, checking only path type via `validateSourceType`, not the denylist), or a `repoMounts` source all bypass the credential policy.
HIGH is defensible; for the untrusted-repo threat this is arguably as severe as F1, and the report acknowledges it "directly answers threat (c)".

### F4 (MEDIUM, SUSPECTED) and F7 (MEDIUM, SUSPECTED)

Correctly labelled.
F4's code facts (bare `port:port`, `0.0.0.0` parse, port range) are CONFIRMED, and the `0.0.0.0`-on-all-interfaces conclusion plus the shared-network assumption are correctly flagged SUSPECTED pending `podman port`/`podman network inspect`.
The report also correctly notes the default entry path is `podman exec` via `bin/lace-into`, not sshd, so the sshd-on-LAN concern is latent, not active.
F7 is appropriately hedged as MODERATE-to-HARD SUSPECTED and correctly notes the sprack `data` mount is project-scoped, bounding blast radius.
Neither is overstated.

### F6 (MEDIUM, CONFIRMED, Hard): build-time downloads

Accurate.
`curl | sh` for chezmoi and the writable dotfiles repoMount are both verified.
HARD ease with a whole-fleet blast radius is the right framing.

### Containment Posture Assessment

This is the report's strongest section and the reassurances are true.
Verified: no `--privileged`/`--cap-add`/`--security-opt label=disable`/`--pid=host`/`--network=host`/`--device` anywhere in lace code, features, or the Dockerfile; no container socket mounted and the denylist blocks it; runArgs injection is limited to `--label` and `--name`.
The `--userns=keep-id` claim is handled with integrity: the report explicitly states the flag is applied by the external `devcontainer` CLI, not by lace code in this repo, marks it CONFIRMED-by-design, and routes it to live `podman inspect` verification.
That is exactly the right epistemic posture for a reassurance that, if wrong, would falsely comfort the reader.

### Recommended Hardening and Verification Needed

The hardening list is prioritized correctly (F1 first, single highest-impact fix) and each item maps to a finding.
The "Verification Needed on a Live Container" list is complete with respect to every SUSPECTED claim and the userns-by-design caveat, with the single exception noted in F1 (the `.credentials.json`-exists assumption).

## Convention Compliance

Compliant.
BLUF present and load-bearing.
Sentence-per-line is followed.
No prose em-dashes (the only `--` occurrences are a shell flag inside a code span and a table "n/a" placeholder).
Framing is critical and detached: it neither alarmist-oversells the kernel escape (repeatedly states none was found) nor glosses the data-layer leak.
CONFIRMED and SUSPECTED are cleanly separated per-finding and in the summary table's Confidence column.

## Independent Take: Is F1 Correctly the Top Finding?

Yes.
Discount the speculative settings.json write-back RCE entirely, and F1 still stands as CRITICAL: a read-write bind of the live host `~/.claude` into every container, for every project, exposes the host's long-lived Anthropic OAuth refresh token to any compromised agent via a single `cat`.
That is a host-credential compromise of the highest-value asset in the stated threat model, it is trivial, and it is fully code-confirmed.
F5 (SSH-key exposure via an untrusted repo) is comparably severe but has a narrower precondition ("you `lace up` a repo you do not trust") than F1's ("every container, always").
F1 as the ranked top is correct.

## Verdict

**Accept.**
The report is technically accurate where it claims CONFIRMED, appropriately hedged where it claims SUSPECTED, and correctly reassuring on the kernel boundary.
It is safe to drive hardening work from this document.
The non-blocking items below improve precision but change none of the conclusions.

## Action Items

1. [non-blocking] Add to "Verification Needed on a Live Container": confirm `~/.claude/.credentials.json` exists as a plaintext file on this host (versus tokens held in the system keyring), since the TRIVIAL credential-theft severity in F1 depends on it. This is the one CONFIRMED sub-claim that is a host-state assumption rather than a code fact.
2. [non-blocking] Tighten two citation ranges: the claude-code feature declaration spans lines 20-33 (cited 20-38, past end of file at 36), and the F5 `validateMountSources` call site is `up.ts:420` (cited 418-436). Neither points at wrong code.
3. [non-blocking] Optionally note in F1 that `config-json` targets `/home/.../.claude/.claude.json` while sourcing `~/.claude.json`, nesting the onboarding-state file inside the `.claude` mount; a curiosity, not security-relevant, but it may confuse a reader tracing paths.

## Clarifying Options for the Author

Underconsidered points, surfaced as choices rather than mandates:

1. F3 severity framing. Keep HIGH (enabler that defeats in-container hardening), or (a) reclassify as MEDIUM given userns containment with a note that its practical weight is as an F1/F2/F5 amplifier, or (b) leave as-is and add one sentence stating explicitly that removing NOPASSWD:ALL is defense-in-depth, not a containment fix on its own?
2. F5 blast-radius emphasis. The SSH-key exposure path arguably deserves its own severity call-out separate from the general policy-asymmetry finding. Split F5 into "policy asymmetry (mechanism)" and "credential exfiltration via untrusted repo (impact)", or keep them merged?
3. Refresh-token durability. Should the report note that the exfiltrated OAuth artifact is a refresh token (long-lived, not trivially rotated) to sharpen the F1 impact statement, or is that editorializing beyond the audit's scope?
