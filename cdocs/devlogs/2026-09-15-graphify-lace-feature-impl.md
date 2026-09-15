---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-15T10:00:00-08:00
task_list: code-graph/graphify-lace-feature
type: devlog
state: live
status: review_ready
tags: [devcontainer_features, code_graph, tooling, runtime_validated]
---

# Graphify lace devcontainer feature: implementation devlog

> BLUF(opus/code-graph/graphify-lace-feature): Implements the accepted `graphify` feature at `devcontainers/features/src/graphify/` per proposal `cdocs/proposals/2026-09-15-graphify-lace-devcontainer-feature.md`.
> Phase 1 (the real verification gate) is RESOLVED against the actually-installed `graphifyy==0.9.61`: verify command is `graphify --version`, the index/smoke command is `graphify update <path>` (AST-only, no LLM), and the output/cache dir is project-local `graphify-out/` (NOT `~/.cache/graphify`), redirectable via the `GRAPHIFY_OUT` env var.
> The cache-path finding forces a corrected-but-faithful mount design: set `GRAPHIFY_OUT` to a dir outside the working tree and mount THAT, realizing the proposal's "cache, not repo artifact" intent via the confirmed redirect capability.

## Objective

Ship `devcontainers/features/src/graphify/{devcontainer-feature.json, install.sh, README.md}` and `devcontainers/features/test/graphify/{scenarios.json, test.sh, ...}`, mirroring the `claude-code`/`neovim`/`blesh` idioms and the `portless` test harness.
Constraint (from the proposal): modify only files under `devcontainers/features/src/graphify/` and `devcontainers/features/test/graphify/`. Do NOT edit sibling features, the CI workflow, or lace's `up` path.

## Phase 1 verification outcomes (the real gate)

All resolved EMPIRICALLY against the installed package (PyPI reachable from this environment; wheel downloaded and inspected; package installed into a local venv and exercised).

| Question | Proposal assumption | Confirmed reality | Source |
|---|---|---|---|
| PyPI package + version | `graphifyy==0.9.61` | `graphifyy==0.9.61` exists, is the LATEST (229 releases), `requires_python>=3.10` | `pypi.org/pypi/graphifyy/json` |
| Verify command | `graphify --version` | `graphify --version` prints `graphify 0.9.61` | venv run |
| Cache/output dir | `~/.cache/graphify` | project-local `graphify-out/` (cache at `graphify-out/cache/`), overridable via `GRAPHIFY_OUT` env var | `graphify/paths.py` (`GRAPHIFY_OUT = os.environ.get("GRAPHIFY_OUT", "graphify-out")`), venv run |
| Index/smoke command | `graphify --update` | `graphify update <path>` (positional path; AST-only, "no LLM needed"); produced `graph.json` (5 nodes, 7 edges) on a 2-file fixture with NO API keys, exit 0 | venv run |
| Output redirect | open question | YES: `GRAPHIFY_OUT` env var redirects the whole output dir; confirmed it moves cache+graph.json out of the tree with NO in-tree residue | venv run |
| MCP server command | `<graphify mcp command>` placeholder | separate console script `graphify-mcp` (`--transport {stdio,http}`, default stdio, takes graph.json path) | wheel `entry_points.txt`, `--help` |

Console scripts the wheel installs (`entry_points.txt`):
- `graphify = graphify.__main__:main` (the CLI; this is what must resolve on PATH).
- `graphify-mcp = graphify.serve:_main` (the MCP server).

> NOTE(opus/code-graph/graphify-lace-feature): DEVIATION 1 - cache path. The proposal assumed `~/.cache/graphify` and its NOTE explicitly required Phase 1 to "confirm the cache path and correct the manifest/script if they differ." They differ: graphify's default output (cache AND artifacts) is project-local `graphify-out/`, inside the working tree. Because the lace working tree is already a host bind mount, the default would (a) persist for free but (b) pollute the repo. To honor the proposal's "Cache mount, not repo artifact" design intent, the feature sets `GRAPHIFY_OUT` to a dir outside the tree (`$HOME/.cache/graphify`) and mounts that. This is the "output-dir redirect" the proposal's Open Questions hoped for ("A redirect is cleaner than a gitignore and would tighten the README contract"): confirmed to exist and used.

> NOTE(opus/code-graph/graphify-lace-feature): DEVIATION 2 - index command. `graphify --update` (proposal) does not exist as a flag; the real command is `graphify update <path>`. The git-hook (Phase 4) and README use `graphify update`.

> NOTE(opus/code-graph/graphify-lace-feature): DEVIATION 3 - MCP command. The registered MCP command is the dedicated `graphify-mcp` console script (stdio default), not a `graphify` subcommand.

> NOTE(opus/code-graph/graphify-lace-feature): CAVEAT - single-cache-per-container. Redirecting `GRAPHIFY_OUT` to one per-user path means a container hosting multiple checkouts shares one graph. This is acceptable under lace's one-project-per-container norm; documented in the README.

## GRAPHIFY_OUT delivery decision (revised after empirical harness failure)

> NOTE(opus/code-graph/graphify-lace-feature): DEVIATION 4 - GRAPHIFY_OUT is a FIXED path `/var/cache/graphify`, not `$HOME/.cache/graphify`.
> First attempt set `containerEnv: { "GRAPHIFY_OUT": "${containerEnv:HOME}/.cache/graphify" }`. The harness caught this immediately: a feature's `containerEnv` is baked as a raw Docker `ENV` line, and Docker's ENV substitution does NOT understand `${containerEnv:HOME}` (a devcontainer.json-level variable). The build failed with `unsupported modifier (:H) in substitution`.
> Fix: use a fixed, user-independent path `/var/cache/graphify` for both `GRAPHIFY_OUT` (plain ENV, works in all shells) and the lace mount `target`. This is simpler than the proposal's `/home/${_REMOTE_USER}/.cache/graphify` and eliminates the root-vs-non-root home divergence the proposal had to NOTE. install.sh creates + chowns it; the mount `recommendedSource` stays `~/.cache/graphify` on the host.
> Cost: the cache is not under the user's home. Acceptable for a cache dir, and `/var/cache` is its standard FHS location.

## Implementation Phases progress

- Phase 1 (core install + verify): DONE + harness-verified. See table above.
- Phase 2 (index persistence mount): DONE (mount + `GRAPHIFY_OUT` redirect + dir create/chown; fixed path `/var/cache/graphify`). Target-dir create/ownership harness-verified; cross-rebuild persistence out of harness scope.
- Phase 3 (optional MCP): DONE. `installMcpServer`, `claude mcp add graphify -s user -- graphify-mcp` via `su - $_REMOTE_USER`, no-op+warn when claude absent. Only the no-op path harness-verified.
- Phase 4 (optional git hook): DONE (static). `installGitHook`, post-commit running `graphify update` via a global `core.hooksPath`. Not exercised by a scenario.
- Phase 5 (README): DONE.
- Phase 6 (test harness): DONE. 4 scenarios, all pass.
- Phase 7 (CI awareness, no code change): DONE (inspection). See verification results.

## Verification results

RAN: `cd devcontainers/features && devcontainer features test --features graphify --skip-autogenerated` (devcontainer CLI 0.87.0, docker/buildkit, base image `mcr.microsoft.com/devcontainers/base:ubuntu`, real container builds with the `python:1` feature). **All 4 scenarios PASSED, harness exit 0.**

| Scenario | Remote user | Checks passed |
|---|---|---|
| `default_install` | vscode (non-root) | graphify on PATH; `--version`==0.9.61; shim under `/usr/local/bin` (not `~/.local/bin`); `graphify-mcp` on PATH; `GRAPHIFY_OUT=/var/cache/graphify` set; cache dir exists + writable; **functional smoke: `graphify update` built `graph.json` with nodes, no LLM/API key** |
| `custom_version` | vscode | `--version`==0.9.60 (the custom pin honored) |
| `non_root_user` | vscode (explicit) | running as non-root; graphify on PATH **for the remote user**; `--version` resolves as remote user; system-wide shim; cache dir exists, writable, and **owned by the remote user** |
| `mcp_without_claude` | vscode | install still succeeded (exit 0) with `installMcpServer=true` and no claude-code; `claude` CLI absent; **no broken/`graphify-mcp` MCP entry written** to any Claude config |

Durable excerpt of the (ephemeral) harness summary:

```
✅ Passed:      'default_install'
✅ Passed:      'custom_version'
✅ Passed:      'non_root_user'
✅ Passed:      'mcp_without_claude'
HARNESS_EXIT=0
```

Verification floor (from the brief) SATISFIED empirically: graphify installs and is on PATH for the NON-ROOT remote user, the pipx shim landed in the shared `/usr/local/bin` (not a root-only location), and the `GRAPHIFY_OUT` mount-target dir is created and owned by the remote user. The failing pictures the proposal's Verification Methodology enumerated (root-only PATH, version-shadowing, root-owned cache) are all ruled out by passing checks.

Static verification also clean: `shellcheck --shell=sh install.sh` (no findings); `jq empty` on both JSON files; test scripts shellcheck-clean apart from intentional info-level SC1091 (harness-provided `dev-container-features-test-lib`) and SC2016 (deliberate single-quoting so `$HOME`/`$(id -u)` expand at container runtime).

### What was NOT empirically verified (honest scope)

- **Mount PERSISTENCE across a rebuild.** The `devcontainer features test` harness does NOT apply lace mounts (per the proposal's Verification NOTE). It verified the mount-TARGET dir creation + ownership; it did NOT verify that a populated `/var/cache/graphify` survives a `lace up` rebuild and keeps `graphify update` incremental. That requires a lace `up` cycle, out of harness scope. Left as a manual step.
- **MCP registration success path (Phase 3, `installMcpServer=true` WITH claude-code).** Only the no-claude no-op path was exercised in the harness. The `su - $_REMOTE_USER -c 'claude mcp add ...'` happy path was not built (would need the claude-code feature + a valid Claude config in the scenario). The command shape follows the proposal's spec and `graphify-mcp` is confirmed to exist and accept stdio; the registration write itself is unverified end-to-end.
- **The git hook (Phase 4, `installGitHook=true`).** Not exercised by a scenario. The hook script is static-only verified (written, `chmod +x`, guarded/non-fatal). No scenario builds it or runs a commit.
- **Phase 7 CI publish.** Not triggered (no merge). Confirmed by inspection only: `.github/workflows/devcontainer-features-release.yaml` publishes `devcontainers/features/src/**` to GHCR on push to main, and `devcontainer-features-test.yaml` runs the harness on PRs touching `devcontainers/features/**`. The first merge to main WILL publish `ghcr.io/weftwiseink/devcontainer-features/graphify:1.0.0` with the `0.9.61` pin baked in - a real side effect, and the pin is verified (latest on PyPI).

## Status

Core deliverable (Phases 1, 2, 6) empirically verified via the harness. Additive Phases 3 (MCP no-op path only), 4 (static only), 5 (README) complete. Phase 7 confirmed by inspection.
Setting this devlog `review_ready`.

## Issues Encountered and Solved

1. **Harness scenario-script naming.** The `devcontainer features test` harness requires a per-scenario script named exactly after each scenario key (`default_install.sh`, etc.); a generic `test.sh` is only the autogenerated-default test, which `--skip-autogenerated` skips. First run failed with "No scenario test script found ... default_install.sh". Fixed by renaming `test.sh` -> `default_install.sh` (the other three scenarios already had matching names).
2. **`${containerEnv:HOME}` in feature containerEnv is invalid.** See DEVIATION 4 above. Caught by the harness build (`unsupported modifier (:H)`). Fixed by switching to the fixed path `/var/cache/graphify`.
