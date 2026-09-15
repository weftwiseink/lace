---
first_authored:
  by: "@claude-opus-4-8"
  at: 2026-09-15T10:00:00-08:00
task_list: code-graph/graphify-lace-feature
type: devlog
state: live
status: wip
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

## GRAPHIFY_OUT / HOME resolution decision

`containerEnv` in the manifest sets `GRAPHIFY_OUT=${containerEnv:HOME}/.cache/graphify`.
`${containerEnv:HOME}` resolves to the remote user's home at runtime for all shells (login and non-login), and neatly resolves the root edge (`/root` for root, `/home/<user>` otherwise), so `GRAPHIFY_OUT` and install.sh's created dir agree even for a root remote user.
The lace mount `target` keeps the proposal's `/home/${_REMOTE_USER}/.cache/graphify` (lace substitutes `_REMOTE_USER`); for a root remote user this diverges from `/root/...`, the same pre-existing, accepted divergence the proposal NOTE'd for claude-code. For the non-root verification-floor case all three paths agree.

## Implementation Phases progress

- Phase 1 (core install + verify): see table above. RESOLVED.
- Phase 2 (index persistence mount): mount + `GRAPHIFY_OUT` redirect + dir create/chown.
- Phase 3 (optional MCP): `installMcpServer`, `claude mcp add graphify -s user -- graphify-mcp` via `su - $_REMOTE_USER`, no-op+warn when claude absent.
- Phase 4 (optional git hook): `installGitHook`, post-commit running `graphify update`.
- Phase 5 (README).
- Phase 6 (test harness).
- Phase 7 (CI awareness, no code change).

## Verification results

(filled in after the harness run below)

## Issues Encountered and Solved

(running log)
