> NOTE(mjr): Human authored, please update frontmatter with /triage

Review of the dev dependency proposal:

Thinking more on this, I think it should really be a full-fledged lace plugins system rather than calling it devDependencies. Lets "evolve" this proposal into a a new one with the following amendments (use subagents liberally for research /report /review etc

1. The devcontainer format can be much the same, but github.com/user/claude-plugins/plugins works for subdirs, we need an alias field for the conflicting path case. Readonly and required aren't necessary but spin off a future work /rfp for a when field point to https://github.com/imbue-ai/command-on-key-when for reference
  2. Instead of ~/.config/lace/repos.json, we have ~/.config/lace/settings.json with a plugins field mapping repos to configs of { overrideMount?: { source, readonly?, target? }. Missing plugins are errors on `lace up`. Target overrides the mount target and symlinks the default lace target to that target (we use this instead of mirrorPath)
  3. lace resolve-deps should be lace resolve-mounts instead.
  4. Non-mount-overridden plugins, are shallow-cloned to `~/.config/lace/$project/plugins/$plugin_name_or_alias`, updated by `resolve-mounts` and mounted as readonly.  The default mount target is `/mnt/lace/plugins/$name_or_alias`. `resolve-mounts` fails if two plugins conflict for `$name_or_alias
  5. Spin off another /rfp for plugins to prep files and host setup (ie wezterm ssh key) and supply runtime scripts etc, but we'll leave that for future work

So, overall plan here is to seed a new plugin interface with the first immediate tricky bit about shared dev resources via wip project mounts.

Please consider these changes thoroughly against the prior dev dependency proposal and expand it into a fully fleshed out implementation and testing plan, being mindful of the need for iterative testing and debugging exercising true production code paths.

Detailed decisions/considerations should be broken into a separate /report and referenced as needed

After the proposal is complete, go through some iterative /review
