# graphify (code graph)

Installs the [graphify](https://github.com/Graphify-Labs/graphify) code-graph CLI (the `graphifyy` PyPI package) via an isolated, system-wide pipx install.
graphify builds a deterministic, tree-sitter AST graph of a codebase (zero API calls for the code path) and exposes it for querying.

This feature provisions the engine and persists its index across rebuilds.
It is a **scoping aid, not a related-code guarantee**: see [Graceful degradation](#graceful-degradation).

## Usage

Add to your `devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/graphify:1": {}
  }
}
```

Pin a version, and opt into the MCP server:

```jsonc
{
  "features": {
    "ghcr.io/weftwiseink/devcontainer-features/graphify:1": {
      "version": "0.9.61",
      "installMcpServer": true
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `version` | string | `0.9.61` | `graphifyy` PyPI version (exact pin; pre-1.0, so no range). Installed as `graphifyy==<version>`. |
| `installMcpServer` | boolean | `false` | Register the graphify MCP server for the remote user via `claude mcp add graphify -s user -- graphify-mcp`. Requires the `claude-code` feature; no-op with a warning if the `claude` CLI is absent. |
| `installGitHook` | boolean | `false` | Install a post-commit git hook running `graphify update`. Off by default: it adds latency to every commit. |

## What gets installed

- `/usr/local/bin/graphify`: the code-graph CLI (isolated pipx venv under `/usr/local/pipx`).
- `/usr/local/bin/graphify-mcp`: the MCP server (`--transport stdio|http`, stdio default).
- `GRAPHIFY_OUT=/var/cache/graphify`: the container env var pointing graphify's output/cache dir out of the working tree (see below).

Verify with `graphify --version`.

## Basic use

Index a tree (AST-only, no LLM, no API key needed):

```sh
graphify update .          # (re)build the graph for the current repo
graphify query "..."       # BFS traversal of the graph for a question
graphify explain "X"       # explain a node and its neighbors
graphify path "A" "B"      # shortest path between two nodes
```

## Index persistence (lace mount)

By default graphify writes its output (the AST cache **and** `graph.json` / `GRAPH_REPORT.md` / `graph.html`) to a project-local `graphify-out/` directory inside the working tree.
That would pollute the repo.
This feature instead sets `GRAPHIFY_OUT=/var/cache/graphify` (via the manifest's `containerEnv`), redirecting the whole output dir out of the tree, and declares a lace mount for it:

| Label | Target | Type | Default Source | Description |
|-------|--------|------|----------------|-------------|
| `graphify/index` | `/var/cache/graphify` | directory | `~/.cache/graphify` | graphify output dir (`GRAPHIFY_OUT`): AST index cache + `graph.json` |

> NOTE: `GRAPHIFY_OUT` is a fixed, user-independent path (`/var/cache/graphify`) rather than `$HOME/.cache/graphify`, because a feature's `containerEnv` is baked as a raw Docker `ENV` that does not resolve `${containerEnv:HOME}`. The fixed path also avoids the root-vs-non-root home divergence.

When the mount is active, the index persists across container rebuilds, so `graphify update` stays incremental rather than re-indexing from scratch.

> NOTE: The mount is applied by lace's `up` path, not by the standalone `devcontainer features test` harness. Harness tests verify the target dir is created and owned by the remote user; end-to-end persistence across a rebuild is a lace `up` concern.

To use a different host path, add a settings override to `~/.config/lace/settings.json`:

```json
{
  "mounts": {
    "graphify/index": { "source": "/path/to/your/graphify-cache" }
  }
}
```

> NOTE: `GRAPHIFY_OUT` is a single fixed path, so a container hosting multiple checkouts shares one graph. This matches lace's one-project-per-container norm. For multiple projects in one container, set `GRAPHIFY_OUT` per-invocation or run graphify from each project root with its own override.

## MCP server (opt-in)

With `installMcpServer: true` and the `claude-code` feature present, the feature registers the graphify MCP server (`query_graph`, `get_node`, `shortest_path`) into the remote user's Claude config via `claude mcp add graphify -s user -- graphify-mcp` (stdio transport).
Registration goes through the `claude` CLI (idempotent, version-tolerant), never a hand-edited config file.
If the `claude` CLI is absent, registration is skipped with a warning and the install still succeeds.

## The `/graphify` skill is NOT installed by this feature

The `/graphify` Claude Code skill is a plugin/marketplace concern owned by the clauthier `cdocs` plugin layer, which the driving review-loop RFP names as the review-loop owner.
A devcontainer feature installing an agent skill would couple infrastructure provisioning to agent-plugin distribution with no clean ownership boundary.
Install the skill from the clauthier `cdocs` plugin, not from here.

## Dependencies

| Dependency | Why | Auto-installed? |
|------------|-----|-----------------|
| `ghcr.io/devcontainers/features/python:1` | Provides Python 3 (and pip/ensurepip) that the pipx bootstrap builds on | Yes (`dependsOn`) |
| `pipx` | Isolates the CLI in its own venv | Self-provisioned by `install.sh` (`ensurepip` + `pip install pipx`) if not already on PATH |
| `ghcr.io/weftwiseink/devcontainer-features/claude-code` | Only for `installMcpServer` | `installsAfter` (ordering only; not a hard dependency) |

The one unrecoverable case is `python3` absent (no python feature and none in the base image): `install.sh` errors loudly with a pointer to add the python feature.

## Graceful degradation

This feature makes the graph substrate cheaply available and reproducible.
It does **not** guarantee the index is fresh or present at query time, and the graph does not settle whether it earns its cost over grep.

- **Fall back to grep.** A missing or stale index MUST degrade to the grep-scoping floor (`git grep` for importers, ~97.4% recall). The consuming loop treats graphify as a scoping *aid*, never a related-code guarantee.
- **The graph is blind to CRDT coupling.** graphify is reference/import-granularity, not dataflow. It is blind to weftwise's ~125 CRDT `.observe`/`.subscribe` coupling sites (~86.8% of that codebase's real coupling), where mutator and reactor share a runtime object, not a resolvable symbol. A graph-scoped review is NOT a coupling guarantee.
- **The cost win over grep is unmeasured.** The grep floor already ties graphify on recall. graphify's advantage is precision-on-collisions plus multi-hop traversal, not recall; its token delta over grep at equal recall has never been measured in a real loop. Do not present this feature as a cost optimization until that A/B is run.

## Maintenance note

graphify is pre-1.0 (229 PyPI releases in ~5.5 months). The `version` option is an exact pin, not a range, so rebuilds are reproducible, but option names, output shape, and MCP tool signatures can move between pins. Bumping the pin is a deliberate, re-verified maintenance step.
