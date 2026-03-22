---
first_authored:
  by: "@claude-opus-4-6"
  at: 2026-03-22T10:00:00-07:00
task_list: tmux/alt-s-debug
type: report
state: live
status: done
tags: [tmux, nushell, quoting, lace-split]
---

# Alt+S (M-S) lace-split Binding Debug

> BLUF: The `ControlPath` quoting is not the bug.
> The root cause is that `tmux split-window` passes its command string through the default shell, which is nushell.
> Nushell cannot parse POSIX shell constructs (`&&`, `$SHELL`) in the SSH remote command.
> The binding works by accident when `@lace_workspace` is empty (no `remote_cmd` appended), but fails when workspace is set.

## Analysis

### Quoting layers

The `M-S` binding in `tmux.conf` has three layers of shell interpretation:

1. **tmux config parser**: the `run-shell` argument is single-quoted, so content is stored literally.
2. **/bin/sh** (`run-shell` always uses `/bin/sh`): expands `$HOME`, `$port`, `$user`, `$ws`, constructs the `split-window` command.
3. **nushell** (`split-window` uses `default-shell`, which is `~/.cargo/bin/nu`): executes the SSH command string.

### What works

The `\"ControlPath=$HOME/.ssh/lace-ctrl-%C\"` escaping is correct through all three layers.
After sh expansion, `split-window` receives `ssh ... -o "ControlPath=/home/mjr/.ssh/lace-ctrl-%C" ...`.
Nushell treats `"..."` as a string literal (no interpolation), so the embedded quotes and `%C` are passed through to SSH correctly.

### What fails

When `@lace_workspace` is set, `remote_cmd` expands to `cd /workspaces/lace && exec $SHELL -l`.
This is appended bare to the `split-window` argument string.
Nushell sees `&& exec $SHELL` and fails:

```
  x The '&&' operator is not supported in Nushell
     instead of '&&', use ';' or 'and'
```

Even if `&&` were replaced with nushell-compatible syntax, `$SHELL` would also fail: nushell requires `$env.SHELL`, not `$SHELL`.

### Why it sometimes works

When `@lace_workspace` is empty, `remote_cmd` is empty, and the `split-window` argument is just `ssh -o ... node@localhost`.
This is a simple external command that nushell can parse and execute.
The binding appears to work in sessions without a workspace set.

## Verified Fix

Wrap the remote command in double quotes within the `split-window` argument, and prefix with `exec` to bypass nushell entirely.

### Before (broken)

```tmux
bind -n M-S run-shell '\
  port=$(tmux show-option -qv @lace_port); \
  ...
  if [ -n "$ws" ]; then \
    remote_cmd="cd $ws && exec \\$SHELL -l"; \
  else \
    remote_cmd=""; \
  fi; \
  tmux split-window -h \
    "ssh -o IdentityFile=$HOME/.config/lace/ssh/id_ed25519 \
         ...
         -o \"ControlPath=$HOME/.ssh/lace-ctrl-%C\" \
         ...
         -t -p $port ${user:-node}@localhost $remote_cmd"; \
  ...'
```

### After (fixed)

```tmux
bind -n M-S run-shell '\
  port=$(tmux show-option -qv @lace_port); \
  user=$(tmux show-option -qv @lace_user); \
  ws=$(tmux show-option -qv @lace_workspace); \
  if [ -n "$port" ]; then \
    ssh_base="exec ssh \
      -o IdentityFile=$HOME/.config/lace/ssh/id_ed25519 \
      -o IdentitiesOnly=yes \
      -o UserKnownHostsFile=$HOME/.ssh/lace_known_hosts \
      -o StrictHostKeyChecking=no \
      -o ControlMaster=auto \
      -o ControlPath=$HOME/.ssh/lace-ctrl-%C \
      -o ControlPersist=600 \
      -t -p $port ${user:-node}@localhost"; \
    if [ -n "$ws" ]; then \
      full_cmd="$ssh_base \"cd $ws && exec \$SHELL -l\""; \
    else \
      full_cmd="$ssh_base"; \
    fi; \
    tmux split-window -h "$full_cmd"; \
  else \
    tmux split-window -h -c "#{pane_current_path}"; \
  fi'
```

Key changes:

1. **`exec ssh`** instead of `ssh`: nushell replaces itself with the ssh process, avoiding any nushell command parsing of the SSH output or signals.
2. **Remote command in escaped double quotes** (`\"cd $ws && exec \$SHELL -l\"`): sh expands `$ws` but preserves `$SHELL` as literal. The resulting string `"cd /ws && exec $SHELL -l"` is a nushell string literal, passed as a single argument to ssh. The remote shell then interprets `&&` and `$SHELL` correctly.
3. **Removed `\"ControlPath=...\"` quoting**: unnecessary since the path contains no spaces. Simplifies the quoting and eliminates a potential confusion point.
4. **Build command in variable** (`ssh_base`, `full_cmd`): avoids deeply nested quoting by constructing the string incrementally.

## Verification

Tested both cases live against the `lace` session (port 22427, container `dfb0036cdf75`):

- **No workspace**: pane opens in container home directory. Confirmed with `pwd` showing `/home/node`.
- **With workspace `/workspaces/lace`**: pane opens in container at `/workspaces/lace`. Confirmed with `pwd`.
- **Non-lace session**: falls through to `split-window -h -c "#{pane_current_path}"` (normal split). Untested end-to-end but the sh logic is trivial.

## Secondary Finding: Remote Command Parsing Bug

The original binding has a latent bug even under `/bin/sh`: the bare `$remote_cmd` expansion places `&&` at the shell level, meaning `/bin/sh` would interpret `ssh ... cd /ws && exec $SHELL -l` as `(ssh ... cd /ws) && (exec $SHELL -l)`.
The `exec $SHELL -l` would run locally, not remotely.
This bug is masked because `@lace_workspace` is typically empty in current usage.
The fix addresses this by quoting the remote command as a single SSH argument.
