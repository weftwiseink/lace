---
first_authored:
  by: "@claude-opus-4-7"
  at: 2026-05-12T19:00:00-07:00
task_list: lace/tmp-workaround-injection
type: proposal
state: live
status: request_for_proposal
tags: [podman, buildah, buildkit, defensive_injection, future_work, rfp]
---

# Auto-Inject `chmod 1777 /tmp` Workaround Into Lace-Managed Builds

> BLUF(opus/lace/tmp-workaround-injection): `containers/buildah#6503` corrupts `/tmp` permissions during devcontainer feature install on rootless podman with the default `--layers` overlay graph driver, breaking `apt-get` GPG verification.
> The community workaround is `RUN chmod 1777 /tmp` before the first feature-touching layer.
> This RFP requests a proposal for lace to inject that workaround automatically into user Dockerfiles (or into the prebuild build context), so users on rootless podman do not have to know about the bug.
>
> - **Motivated by:** [`cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md`](../reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md)
> - **Companion empirical work:** [`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`](../reports/2026-05-12-pretest-experiment-buildkit-never-drop.md) - verifies whether the chmod alone is sufficient (i.e., whether `--buildkit never` at `up.ts:1311` can be dropped).
> - **Independent of:** [`cdocs/proposals/2026-05-05-rfp-rethink-prebuild-cache.md`](./2026-05-05-rfp-rethink-prebuild-cache.md). Useful regardless of what happens with the broader prebuild cache rethink. If lace keeps prebuild, this makes prebuild safer. If lace deletes prebuild, this makes the deleted-prebuild path safer for any user who relies on `devcontainer build` directly.

## Objective

Make any lace-managed devcontainer build immune to `containers/buildah#6503` on rootless podman, without requiring the user to know about or apply the workaround themselves.

The current state is:
- Lace's *own* `.devcontainer/Dockerfile` (line 19) has `RUN chmod 1777 /tmp` applied. This is project-specific and was added by hand after the bug was diagnosed in 2026-03-26.
- User projects like weftwise and whelm do *not* have the chmod in their Dockerfiles. They rely on lace's `--buildkit never` flag to avoid the bug indirectly.
- If lace drops `--buildkit never` (a separate plausible follow-up after the pre-test experiment), user projects without the chmod will start failing.
- Even if `--buildkit never` stays, the chmod is a more honest mitigation: it fixes the symptom directly rather than disabling the codepath that exposes it.

The proposal should design a mechanism that ensures the chmod is in place for every lace-managed build, regardless of whether the user knows about the bug.

## Scope

The full proposal should explore:

### Where to inject

- **Option I1: Inject into the user's Dockerfile in place.** Lace's prebuild pipeline already rewrites the `FROM` line; it could equally well insert a `RUN chmod 1777 /tmp` line before the first `RUN`. Visible to the user; preserves their authorship; risks confusion if they don't expect lace to mutate their file.
- **Option I2: Inject into the temp prebuild build context.** Lace generates `.lace/prebuild/.devcontainer/Dockerfile` for the prebuild build; this can include the chmod without touching the user's source. Doesn't help the post-prebuild `devcontainer up` build of the workspace image, which uses the user's actual Dockerfile.
- **Option I3: Inject at both layers.** Prebuild context + user Dockerfile. Belt-and-suspenders.
- **Option I4: Wrap via a synthesized base layer.** Build a tiny intermediate image `FROM <user-from>` + `RUN chmod 1777 /tmp`, push it, and rewrite the user's FROM to point at it. Conceptually clean but adds another tag to manage.
- **Option I5: Use `onCreateCommand` (runtime) instead of build-time.** Runs after the container is created, before `postCreateCommand`. Wrong layer of the stack but worth flagging as a non-build-time option. The bug bites at *build* time, so this is probably the wrong place; documenting for completeness.

### When to inject

- Always.
- Only when lace detects rootless podman (e.g., `podman info` shows the user is non-root).
- Only when lace detects podman *at all* (docker users do not hit #6503).
- Behind a settings flag, off by default.

### How visible

- Silent — lace just does it, no console output.
- A one-line stderr note ("lace: injecting chmod 1777 /tmp workaround for containers/buildah#6503").
- Documented prominently in `lace up --help` and the CONTRIBUTING/README.

### Removal trigger

- When `containers/buildah#6503` is fixed upstream, lace should detect the fix (e.g., podman/buildah version range) and stop injecting.
- The detection mechanism is itself a small design decision: version-based, env-var override, or empirical (always inject and let it be a no-op when the bug is fixed).

## Out of Scope

- The broader question of whether to delete `lace prebuild` (covered by [`2026-05-05-rfp-rethink-prebuild-cache.md`](./2026-05-05-rfp-rethink-prebuild-cache.md)).
- Whether to drop `--buildkit never` (covered by the pre-test experiment report).
- Fixes for other podman/buildah bugs that may affect lace.
- Cross-platform parity (this is podman-specific; docker users are not affected by #6503).

## Open Questions

1. **Is the chmod actually sufficient on its own?**
   The pre-test experiment (`cdocs/reports/2026-05-12-pretest-experiment-buildkit-never-drop.md`) will answer this.
   If the answer is "no, --buildkit never is also necessary," the scope of this proposal narrows (inject the chmod *and* keep --buildkit never) or widens (also automate `--buildkit never` based on podman detection).
2. **What if the user has their own custom `chmod` on `/tmp`?**
   Unlikely but worth considering: a user might have `RUN chmod 0755 /tmp` for security reasons (unusual; documented for completeness).
   The injection should either detect existing `chmod /tmp` directives and respect them, or always apply 1777 with a documented override mechanism.
3. **Where in the Dockerfile to inject?**
   Specifically, before the *first* `RUN` instruction (the simplest rule) or specifically before the *first apt-get*?
   The first-RUN rule is simpler but injects even when no apt-get follows; the apt-get-specific rule is more targeted but more fragile (apt-get can be aliased, called from a script, etc.).
4. **Does the injection survive a `lace restore` cycle?**
   Lace already rewrites/restores the FROM line; the chmod injection mechanism needs to interoperate cleanly with that.

## Prior Art

- `packages/lace/src/lib/dockerfile.ts:rewriteFrom` and `restoreFrom` - the existing in-place Dockerfile mutation machinery.
- `packages/lace/src/lib/prebuild.ts:generatePrebuildDockerfile` - generates the prebuild temp context's Dockerfile from the user's FROM + ARG prelude.
- `cdocs/devlogs/2026-03-26-podman-buildkit-tmp-fix.md` - the original diagnosis and the hand-applied fix in lace's own Dockerfile.
- `cdocs/reports/2026-05-12-podman-tmp-buildkit-bug-investigation.md` - upstream tracking, root-cause correction.
- `containers/buildah#6503` (upstream bug).
- `packages/lace/.devcontainer/Dockerfile:19` - the hand-applied `RUN chmod 1777 /tmp` line in lace's own Dockerfile.

## Scope Note

This RFP is intentionally narrow.
The expected proposal is a small, well-defined change (probably 50-200 lines of code plus tests), self-contained, and unlocked by either a yes-or-no answer to "should lace inject this workaround?".
It should not balloon into a broader "lace as a devcontainer-bug-mitigation-layer" platform discussion.
If that platform discussion is warranted, it should be a separate RFP.
