---
first_authored:
  by: "@claude-opus-4-6-20250605"
  at: 2026-03-21T22:00:00-07:00
task_list: terminal-management/sprack-tui
type: report
state: live
status: wip
tags: [rust, style_guide, code_quality, naming, sprack]
---

# Sprack Rust Style Guide

> BLUF: This guide defines Rust coding conventions for the sprack project, prioritizing semantic naming, small functions, flat control flow, and idiomatic Rust.
> It adapts the project's existing emphasis on clarity and communicative efficiency to Rust-specific patterns.

## 1. Naming Conventions

### Variables: Descriptive and Semantic

Variable names carry the reader through the code.
Err on the side of verbosity when context might be lost.

```rust
// Preferred: names encode domain context
let pane_current_command = get_pane_command(pane_id);
let session_lace_port = config.port_for_session(&session_name);
let container_health_status = check_container_health(&container_id)?;

// Avoid: ambiguous short names
let cmd = get_pane_command(pane_id);
let port = config.port_for_session(&session_name);
let status = check_container_health(&container_id)?;
```

Boolean variables use `is_`, `has_`, `can_`, `should_` prefixes:

```rust
let is_pane_active = pane.status == PaneStatus::Active;
let has_running_process = !pane.processes.is_empty();
let should_refresh_layout = layout_generation < current_generation;
```

### Functions: Verb-First, Describe the Action

Function names state what the function does.
A reader should understand the function's purpose without opening it.

```rust
// Preferred: specific, verb-first names
fn parse_tmux_pane_line(raw_line: &str) -> Result<TmuxPane> { ... }
fn build_host_group_tree(hosts: &[HostEntry]) -> GroupTree { ... }
fn resolve_session_config(session_name: &str) -> Result<SessionConfig> { ... }
fn render_pane_status_widget(pane: &PaneState, area: Rect, buf: &mut Buffer) { ... }

// Avoid: vague or overly terse names
fn parse(line: &str) -> Result<TmuxPane> { ... }
fn build_tree(hosts: &[HostEntry]) -> GroupTree { ... }
fn resolve(name: &str) -> Result<SessionConfig> { ... }
```

### Types: Noun-Phrase, Specific

Type names describe the thing they represent.
Avoid generic names that could refer to anything.

```rust
// Preferred: specific, unambiguous type names
struct TmuxFormatOutput {
    pane_id: String,
    pane_pid: u32,
    pane_current_command: String,
}

enum PaneProcessStatus {
    Running,
    Stopped,
    Exited(i32),
}

struct SessionLayoutConfig {
    split_direction: SplitDirection,
    pane_ratios: Vec<f32>,
}

// Avoid: generic names that lose meaning at the call site
struct Output { ... }
enum Status { ... }
struct Config { ... }
```

### Abbreviations

Well-known abbreviations are fine: `db`, `id`, `pid`, `ctx`, `tx`, `rx`, `fd`, `io`, `ui`, `tui`.

Domain-specific terms are spelled out: `container` not `ctr`, `session` not `sess`, `process` not `proc` (unless in a Unix context where `proc` is standard), `command` not `cmd`, `configuration` not `cfg` (except in type names where `Config` is idiomatic Rust).

> NOTE(opus/sprack-tui): `Config` as a type suffix is idiomatic Rust and acceptable.
> The rule against `cfg` applies to variable names: `session_config` not `session_cfg`.

### Module Names

Short, lowercase, descriptive.
One word when possible, two when needed for disambiguation.

```
src/
  tmux/
    format.rs      // tmux format string parsing
    layout.rs      // pane layout computation
    session.rs     // session management
  tui/
    widgets.rs     // reusable TUI widgets
    input.rs       // keyboard/mouse input handling
    render.rs      // frame rendering orchestration
  config.rs        // configuration loading
  error.rs         // error types
```

## 2. Function Decomposition

### Each Function Does One Thing

If you can describe a function's purpose with "and", it should be two functions.

```rust
// Preferred: separate concerns
fn fetch_tmux_pane_list() -> Result<Vec<RawPaneLine>> {
    let tmux_output = run_tmux_list_panes_command()?;
    parse_tmux_pane_list_output(&tmux_output)
}

fn parse_tmux_pane_list_output(raw_output: &str) -> Result<Vec<RawPaneLine>> {
    raw_output
        .lines()
        .filter(|line| !line.is_empty())
        .map(parse_single_pane_line)
        .collect()
}

fn parse_single_pane_line(line: &str) -> Result<RawPaneLine> {
    let fields: Vec<&str> = line.split('\t').collect();
    let field_count = fields.len();
    if field_count < 4 {
        return Err(anyhow!("expected 4+ fields, got {field_count}: {line}"));
    }
    Ok(RawPaneLine {
        pane_id: fields[0].to_string(),
        pane_pid: fields[1].parse()?,
        pane_width: fields[2].parse()?,
        pane_height: fields[3].parse()?,
    })
}
```

### Line Budget

If a function exceeds roughly 15-20 lines of logic, look for extraction opportunities.
This is a guideline, not a hard rule: a 25-line function that reads clearly is fine.

### Named Helpers Over Inline Closures

Extract non-trivial closures into named functions.
Closures are appropriate for simple transforms in iterator chains.

```rust
// Fine: simple closure in an iterator chain
let active_pane_ids: Vec<&str> = panes
    .iter()
    .filter(|pane| pane.is_active)
    .map(|pane| pane.id.as_str())
    .collect();

// Extract: non-trivial logic deserves a name
fn compute_pane_display_label(pane: &PaneState) -> String {
    let process_name = pane
        .current_command
        .rsplit('/')
        .next()
        .unwrap_or("unknown");
    let status_indicator = if pane.is_focused { "*" } else { " " };
    format!("{status_indicator} {process_name} [{}]", pane.pane_id)
}

let pane_labels: Vec<String> = panes.iter().map(compute_pane_display_label).collect();
```

### Early Returns and Guard Clauses

Validate preconditions at the top.
The main logic should not be nested inside conditionals.

```rust
fn resolve_pane_target(session: &Session, target_name: &str) -> Result<PaneId> {
    let pane_list = session.list_panes()?;
    if pane_list.is_empty() {
        return Err(anyhow!("session has no panes"));
    }

    let matching_pane = pane_list
        .iter()
        .find(|pane| pane.title == target_name);

    let Some(pane) = matching_pane else {
        return Err(anyhow!("no pane matching target '{target_name}'"));
    };

    if !pane.is_alive() {
        return Err(anyhow!("pane '{}' exists but is not alive", pane.pane_id));
    }

    Ok(pane.pane_id.clone())
}
```

## 3. Error Handling

### Crate Boundaries

Use `thiserror` for library error types and `anyhow` for binary/application code.

```rust
// In library code: structured error types with thiserror
#[derive(Debug, thiserror::Error)]
pub enum TmuxFormatError {
    #[error("missing required field '{field_name}' in format output")]
    MissingField { field_name: String },

    #[error("invalid pane dimensions: width={width}, height={height}")]
    InvalidDimensions { width: i32, height: i32 },

    #[error("tmux command failed")]
    CommandFailed(#[from] std::io::Error),
}

// In binary code: anyhow for ergonomic error propagation
fn main() -> anyhow::Result<()> {
    let config = load_sprack_config()?;
    let session = connect_to_tmux_session(&config.session_name)?;
    run_tui_event_loop(session, config)?;
    Ok(())
}
```

### Error Variant Naming

Variants describe what went wrong, not where it happened.

```rust
// Preferred: describes the problem
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("configuration file not found at '{path}'")]
    FileNotFound { path: PathBuf },

    #[error("invalid port number: {value}")]
    InvalidPort { value: String },
}

// Avoid: describes the location
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("error in load_config")]
    LoadConfigError(#[from] std::io::Error),
}
```

### Propagation and Matching

Use `?` for propagation.
Use `match` only when handling specific variants.

```rust
// Propagate with ?
let pane_list = fetch_tmux_pane_list()?;
let parsed_config = toml::from_str::<SprackConfig>(&config_contents)?;

// Match only when you need variant-specific handling
match connect_to_session(&session_name) {
    Ok(session) => session,
    Err(TmuxError::SessionNotFound { .. }) => create_new_session(&session_name)?,
    Err(other) => return Err(other.into()),
}
```

### No Unwrap in Libraries

```rust
// Never in library code
let value = map.get("key").unwrap();

// .expect() is acceptable in binary init code with a clear reason
let runtime = tokio::runtime::Runtime::new()
    .expect("failed to create tokio runtime during startup");
```

## 4. Structure and Organization

### File Layout

Public API at the top, private helpers below.

```rust
//! Module-level documentation: what this module is responsible for.

// === Imports ===
use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::Result;
use serde::Deserialize;

use crate::config::SprackConfig;
use crate::tmux::session::TmuxSession;

// === Public types ===
#[derive(Debug, Clone)]
pub struct PaneLayout {
    pub pane_id: String,
    pub position: PanePosition,
    pub dimensions: PaneDimensions,
}

// === Public functions / impl blocks (public methods first) ===
impl PaneLayout {
    pub fn from_tmux_format(raw_line: &str) -> Result<Self> {
        let fields = split_format_fields(raw_line)?;
        Ok(Self {
            pane_id: fields.pane_id,
            position: parse_pane_position(&fields)?,
            dimensions: parse_pane_dimensions(&fields)?,
        })
    }

    pub fn area(&self) -> u32 {
        self.dimensions.width * self.dimensions.height
    }

    fn validate_dimensions(&self) -> Result<()> {
        // ...
    }
}

// === Private helpers ===
fn split_format_fields(raw_line: &str) -> Result<RawFormatFields> {
    // ...
}

fn parse_pane_position(fields: &RawFormatFields) -> Result<PanePosition> {
    // ...
}

fn parse_pane_dimensions(fields: &RawFormatFields) -> Result<PaneDimensions> {
    // ...
}

// === Tests ===
#[cfg(test)]
mod tests {
    use super::*;
    // ...
}
```

### Import Ordering

Three groups, separated by blank lines: std, external crates, internal modules.

```rust
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use ratatui::layout::Rect;
use serde::{Deserialize, Serialize};

use crate::config::SprackConfig;
use crate::tmux::format::TmuxFormatOutput;
```

### One Concern Per Module

A module handles one cohesive responsibility.
If a module grows beyond roughly 300 lines, look for a natural split.

## 5. Rust Idioms

### Iterator Chains Over Explicit Loops

Prefer iterator chains when they read clearly.

```rust
// Preferred: iterator chain reads as a pipeline
let active_session_names: Vec<String> = sessions
    .iter()
    .filter(|session| session.is_active)
    .map(|session| session.name.clone())
    .collect();

// Also fine: explicit loop when the body is complex or has side effects
let mut session_errors = Vec::new();
for session in &sessions {
    if let Err(error) = validate_session(session) {
        log::warn!("session '{}' invalid: {error}", session.name);
        session_errors.push((session.name.clone(), error));
    }
}
```

### Readability Ceiling on Combinators

Use `Option`/`Result` combinators for simple transforms.
Switch to `match` when a chain becomes hard to follow.

```rust
// Good: simple combinator chain
let display_name = pane
    .custom_title
    .as_deref()
    .unwrap_or_default();

let process_name = command_path
    .rsplit('/')
    .next()
    .map(|name| name.to_string())
    .unwrap_or_else(|| command_path.to_string());

// Prefer match: when logic branches or the chain exceeds 3-4 combinators
let pane_label = match &pane.override_label {
    Some(label) if !label.is_empty() => label.clone(),
    _ => format!("{}:{}", pane.pane_index, pane.current_command),
};
```

### Ownership Patterns

Owned types in structs, borrows in function parameters.

```rust
// Struct owns its data
#[derive(Debug, Clone)]
pub struct SessionState {
    pub session_name: String,          // owned
    pub panes: Vec<PaneState>,         // owned
    pub layout_config: LayoutConfig,   // owned
}

// Functions borrow what they read, own what they must store
pub fn find_pane_by_command<'a>(
    panes: &'a [PaneState],
    target_command: &str,
) -> Option<&'a PaneState> {
    panes.iter().find(|pane| pane.current_command == target_command)
}
```

### Flexible APIs with `impl Into<T>`

```rust
pub fn set_pane_title(pane_id: &str, title: impl Into<String>) {
    let title = title.into();
    // ...
}

// Callers can pass &str or String without friction
set_pane_title("%3", "my-editor");
set_pane_title("%3", format!("{process_name} - {session_name}"));
```

### `#[must_use]` on Important Return Values

```rust
#[must_use]
pub fn compute_layout_diff(
    current: &PaneLayout,
    desired: &PaneLayout,
) -> LayoutDiff {
    // ...
}
```

### Derive Macros

Always derive `Debug`.
Add `Clone` and `PartialEq` when useful.

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct PanePosition {
    pub x: u32,
    pub y: u32,
}

#[derive(Debug)]  // Clone intentionally omitted: holds a file handle
pub struct TmuxConnection {
    socket_path: PathBuf,
    control_channel: std::fs::File,
}
```

### Enums Over Booleans for State

```rust
// Preferred: enum makes states explicit and extensible
#[derive(Debug, Clone, PartialEq)]
pub enum PaneVisibility {
    Visible,
    Hidden,
    Collapsed,
}

// Avoid: boolean that will inevitably need a third state
pub struct PaneState {
    pub is_visible: bool,
}
```

## 6. Comments and Documentation

### Doc Comments on All Public Items

```rust
/// Parses a single line of tmux `list-panes` output in the custom format
/// defined by `TMUX_PANE_FORMAT`.
///
/// Returns an error if required fields are missing or malformed.
pub fn parse_tmux_pane_line(raw_line: &str) -> Result<TmuxPane> {
    // ...
}
```

### No Comments on Self-Explanatory Code

```rust
// Avoid: restating the code
// Check if the pane is active
if pane.is_active {

// Preferred: explain WHY, or omit if obvious
// tmux reports dead panes as active during the brief window
// between SIGHUP delivery and reaping, so verify the pid exists.
if pane.is_active && process_exists(pane.pid) {
```

### Callout Conventions

Follow cdocs callout style in code comments:

```rust
// NOTE(opus/sprack-tui): tmux format strings changed in tmux 3.4.
// This parser handles both the old and new field ordering.

// TODO(opus/sprack-tui): replace this polling loop with tmux control mode events.

// WARN(opus/sprack-tui): this assumes single-server mode.
// Multi-server support will require connection pooling.
```

## 7. Testing Style

### Test Naming

Pattern: `test_<what>_<condition>_<expected>`.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pane_line_valid_input_returns_pane() {
        let raw_line = "%0\t12345\t80\t24\tbash";
        let pane = parse_tmux_pane_line(raw_line).unwrap();
        assert_eq!(pane.pane_id, "%0");
        assert_eq!(pane.pane_pid, 12345);
    }

    #[test]
    fn test_parse_pane_line_missing_field_returns_error() {
        let raw_line = "%0\t12345";
        let result = parse_tmux_pane_line(raw_line);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_pane_line_empty_input_returns_error() {
        let result = parse_tmux_pane_line("");
        assert!(result.is_err());
    }
}
```

### One Assertion Per Test (Where Practical)

Multiple assertions are fine when they verify a single logical outcome.
Separate tests are required when conditions or expected outcomes differ.

### Test Data Builders

For complex structs, use builder functions to reduce setup noise.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_pane() -> PaneState {
        PaneState {
            pane_id: "%0".to_string(),
            pane_pid: 1234,
            pane_width: 80,
            pane_height: 24,
            current_command: "bash".to_string(),
            is_active: true,
        }
    }

    fn make_test_pane_with_command(command: &str) -> PaneState {
        PaneState {
            current_command: command.to_string(),
            ..make_test_pane()
        }
    }

    #[test]
    fn test_find_pane_by_command_existing_command_returns_pane() {
        let panes = vec![
            make_test_pane_with_command("bash"),
            make_test_pane_with_command("nvim"),
        ];
        let found = find_pane_by_command(&panes, "nvim");
        assert!(found.is_some());
        assert_eq!(found.unwrap().current_command, "nvim");
    }
}
```

### Test Module Placement

`#[cfg(test)] mod tests` at the bottom of each file.
Integration tests go in `tests/` at the crate root.

## 8. Formatting and Linting

### rustfmt

Use `rustfmt` with default settings.
No custom `rustfmt.toml` unless a specific override is needed and documented.
Default max line width is 100 characters.

### clippy

Run `clippy` with default lints.
Treat warnings as errors in CI: `cargo clippy -- -D warnings`.

Suppress individual lints only with justification:

```rust
#[allow(clippy::too_many_arguments)]
// NOTE(opus/sprack-tui): this mirrors the tmux format string field order
// and will be refactored into a struct parameter.
fn build_pane_from_fields(
    pane_id: &str,
    pane_pid: u32,
    pane_width: u32,
    pane_height: u32,
    pane_title: &str,
    current_command: &str,
    is_active: bool,
) -> PaneState {
    // ...
}
```

### CI Pipeline

```toml
# In CI or Makefile
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```
