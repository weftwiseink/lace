---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-01-31T12:00:00-08:00
task_list: lace/packages-lace-cli
type: proposal
state: live
status: request_for_proposal
tags: [devcontainer, prebuild, cache, diff, lace]
---

# Smart Prebuild Cache Busting for .lace/prebuild/

> BLUF: Replace the simple config-hash staleness check in `lace prebuild` with a field-level JSON diff that distinguishes prebuild-impactful devcontainer.json changes (base image, prebuildFeatures, build args) from non-impactful ones (extensions, lifecycle commands, mounts), so rebuilds are only triggered when the cached image would actually differ.
>
> - **Motivated by:** [`cdocs/proposals/2026-01-30-packages-lace-devcontainer-wrapper.md`](./2026-01-30-packages-lace-devcontainer-wrapper.md) (see NOTE on caching the full temp context in `.lace/prebuild/` and smart cache busting)

## Objective

The packages/lace proposal establishes that `lace prebuild` caches the full temporary build context (devcontainer.json, Dockerfile, metadata) in `.lace/prebuild/`. The current staleness detection is a simple config hash: any change to devcontainer.json triggers a full rebuild, even when the change cannot affect the prebuild output (e.g., adding a VS Code extension or changing `postCreateCommand`).

This RFP proposes a smarter cache invalidation strategy that:

- Diffs the cached `.lace/prebuild/devcontainer.json` against the newly generated one field-by-field.
- Classifies each changed field as prebuild-impactful or non-impactful.
- Only triggers a rebuild when at least one impactful field has changed.
- Logs skipped rebuilds with an explanation of which fields changed and why they were deemed non-impactful.

Additionally, the cached `.lace/prebuild/devcontainer.json` should contain only the prebuildFeatures (promoted to the `features` key for the temp build context), not the regular `features` from the source devcontainer.json. This ensures the diff compares the correct feature sets.

## Scope

The full proposal should explore the following areas:

- **JSON diff mechanism**: How to perform a structured, field-by-field diff of two devcontainer.json objects. Consider whether an existing library (e.g., `deep-diff`, `json-diff`) is suitable or whether a purpose-built comparator is warranted given the small surface area.
- **Field impact classification**: Define and maintain a mapping of devcontainer.json fields to their prebuild impact. At minimum:
  - **Impactful fields** (trigger rebuild): `build` (dockerfile, context, args), `image`, `features` (within the temp context, i.e., prebuildFeatures), `containerEnv` (if passed as build args), `customizations.lace.prebuildFeatures`.
  - **Non-impactful fields** (skip rebuild): `customizations.vscode`, `features` (regular, creation-time features), `postCreateCommand`, `postStartCommand`, `postAttachCommand`, `mounts`, `forwardPorts`, `remoteUser`, `containerUser`, `remoteEnv`.
  - How to handle unknown/new fields: default to impactful (safe) or non-impactful?
- **Feature stripping in cached context**: The `.lace/prebuild/devcontainer.json` should reflect the temp build context (prebuildFeatures promoted to `features`), not the original devcontainer.json. The regular `features` block should be stripped out during cache generation.
- **Rebuild trigger contract**: A clear, documented list of conditions that trigger rebuild vs. skip, suitable for both the implementation and user-facing `lace status` output.
- **Skip logging**: When a rebuild is skipped despite detected changes, log the changed fields, their old and new values (or a summary), and the classification rationale. Consider verbosity levels (default: field names only; `--verbose`: full diff).
- **Integration with existing pipeline**: How this replaces or wraps the current config-hash check in the prebuild pipeline. Whether the hash check should be retained as a fast-path (hash match = definitely skip, hash mismatch = run the smart diff).

## Open Questions

1. **Default for unknown fields**: Should a field not present in the impact classification default to "impactful" (conservative, triggers unnecessary rebuilds) or "non-impactful" (permissive, risks stale cache)? The conservative default seems safer.
2. **Nested field granularity**: Should the diff operate at the top-level field level (e.g., any change within `build` triggers rebuild) or at a nested level (e.g., only `build.args` changes trigger, but `build.target` does not)?
3. **Array-valued fields**: Fields like `features` are objects with ordered keys. How should key reordering (without value changes) be handled? Devcontainer feature ordering can matter for install order.
4. **Hash as fast-path**: Is it worth retaining the simple hash check as a fast-path before running the more expensive field-level diff? If the hash matches, the diff is guaranteed to produce no changes.
5. **User-configurable overrides**: Should users be able to mark additional fields as impactful or non-impactful via `customizations.lace` configuration?
