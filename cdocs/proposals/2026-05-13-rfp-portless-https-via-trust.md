---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-13T16:30:00-07:00
task_list: weftwise/parallel-feature-development/follow-up/https-trust
type: proposal
state: live
status: request_for_proposal
tags: [portless, https, tls, lace-core, future_work]
---

# RFP: HTTPS Support for Portless via `portless trust`

> BLUF(opus/parallel-dev/follow-up/https-trust): The parallel-dev proposal (`cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md`) ships HTTP-only on port 80.
> Upstream portless natively supports HTTPS on port 443 via a generated local CA installed by `portless trust`.
> This RFP requests a proposal for adopting that path: deciding when HTTPS becomes default, what setup ergonomics lace owns, and how to handle the system-trust-store modification.

## Problem statement

After the parallel-dev proposal lands, users reach dev servers at `http://main.weftwise.localhost/`.
HTTPS would offer:

- A more production-like dev environment (catches HSTS quirks, Secure-cookie behaviour, mixed-content warnings).
- Compatibility with browser features that require a secure context (Service Workers, WebAuthn, Clipboard API, the Permissions API for camera/mic, etc.).
- A path toward staging configurations that already terminate TLS.

Upstream portless ships HTTPS support out of the box:

- `portless trust` generates a local CA and installs it into the system trust store.
- `portless proxy start` (without `--no-tls`) binds :443 and serves the local-CA-signed certs for any `*.localhost` host.

The setup is a one-time `sudo` to write the CA to the system trust store (and per-browser trust on Firefox, which maintains its own NSS database).
Once installed, every browser on the machine trusts `https://*.localhost/` certs portless mints on the fly.

## Goals

The eventual proposal must address:

- Decide the default scheme.
  Options: keep HTTP on :80 as default and document HTTPS as opt-in; flip the default to HTTPS once `portless trust` is run; auto-detect (HTTP if no CA, HTTPS if CA installed).
- Document the `portless trust` setup as a first-class lace setup step or leave it as raw portless documentation.
- Cover the Firefox NSS-database quirk if relevant (portless upstream may handle it; verify).
- Handle the dual-binding case: does host portless bind both :80 AND :443 simultaneously, or just one?
  If both, the parallel-dev proposal's sysctl for :80 is still needed; if just :443, the sysctl can drop.
- Coexist with users who do NOT install the CA (HTTPS must fail gracefully, not break HTTP).

## Non-goals

- HTTPS termination at any layer other than host portless. Container portless and dev servers continue to speak HTTP internally.
- Cross-machine cert trust. Single-host scope.
- Custom CA (lace generates its own, separate from portless's). Use upstream's CA path.

## Open questions for the proposal author

- What does `portless trust` actually do on Linux? Verify by source-reading or by running it in a throwaway container. The fresh-eyes report says "installs the local CA into the system trust store, per-user where possible, falls back to sudo." Confirm.
- Does port 443 require the same sysctl as port 80 (`net.ipv4.ip_unprivileged_port_start=443`), or is the existing :80 sysctl wide enough?
  Hint: `net.ipv4.ip_unprivileged_port_start=80` already lowers the boundary to 80, so 443 is covered.
- Should `lace setup` (an as-yet-nonexistent subcommand) bundle `portless trust` with the other one-time host setup steps (sysctl, npm install, service install)?
  Or is it cleaner to keep CA install as a separate deliberate user action?
- How does HTTPS interact with the wildcard alias question?
  Per the parallel-dev proposal's Phase 0, host portless must forward `*.weftwise.localhost` to a single container backend.
  HTTPS adds a SNI dimension; verify that portless's TLS handshake handles wildcard SNI correctly.
- Should the lace `hostAlias: true` metadata grow a sibling `https: true` flag, or is HTTPS purely a host-side concern (no lace metadata)?

## References

- Source proposal: `cdocs/proposals/2026-05-13-rfp-weftwise-parallel-feature-development.md` (introduces host portless; HTTPS is its Edge Case E8 / Open Question).
- Fresh-eyes URL routing survey: `cdocs/reports/2026-05-13-clean-portless-urls-fresh-eyes.md` (covers `portless trust` as a clean-URLs enabler).
