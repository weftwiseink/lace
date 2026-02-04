---
first_authored:
  by: "@claude-opus-4-5-20251101"
  at: 2026-02-04T20:30:00-08:00
task_list: lace/plugins-system
type: proposal
state: live
status: request_for_proposal
tags: [plugins, conditional, when-clause, devcontainer, lace-cli]
related_to: cdocs/proposals/2026-02-04-lace-plugins-system.md
---

# RFP: Plugin Conditional Loading (`when` field)

> BLUF: Add a `when` field to plugin declarations that enables conditional loading based on context (file presence, environment variables, project characteristics). Inspired by VS Code's when-clause conditional expressions, this would allow projects to declare plugins that are only mounted when certain conditions are met, reducing unnecessary mounts and enabling project-type-aware configurations.

## Objective

Enable conditional plugin loading in lace-managed devcontainers so that:

1. Plugins can be declared as "use this only when X condition is true"
2. Large or specialized plugins don't slow down unrelated workflows
3. Project configurations can be more portable (declare many plugins, load only relevant ones)
4. Users can customize which plugins load based on their environment

**Reference**: [VS Code when-clause contexts](https://code.visualstudio.com/api/references/when-clause-contexts) for prior art on conditional expression languages.

## Scope

The full proposal should explore:

### Expression Language Design

- What conditions should be supported?
  - File existence: `fileExists('.python-version')`, `fileExists('Cargo.toml')`
  - Environment variables: `env.CI`, `env.LACE_ENV == 'production'`
  - Project metadata: `project.name == 'lace'`, `project.hasWorkspaces`
  - User settings: `settings.experimentalPlugins`
  - Combined expressions: `fileExists('package.json') && !fileExists('pnpm-lock.yaml')`

- What operators?
  - Logical: `&&`, `||`, `!`
  - Comparison: `==`, `!=`, `>`, `<` (for semver?)
  - Membership: `in` (for checking values in arrays)

- Expression syntax considerations:
  - Keep simple enough to validate statically
  - Avoid Turing-completeness (no loops, function definitions)
  - Clear error messages for invalid expressions

### Evaluation Timing

- When are conditions evaluated?
  - At `lace resolve-mounts` time (before container start)
  - Some conditions may need host-side evaluation, others container-side
  - File existence checks need clear scope (workspace folder? project root?)

### Schema Extension

```jsonc
// Example of what this might look like
{
  "customizations": {
    "lace": {
      "plugins": {
        "github.com/user/python-tooling": {
          "when": "fileExists('.python-version') || fileExists('pyproject.toml')"
        },
        "github.com/user/rust-tooling": {
          "when": "fileExists('Cargo.toml')"
        },
        "github.com/user/heavy-plugin": {
          "when": "!env.CI"  // Don't load in CI environments
        }
      }
    }
  }
}
```

### Interaction with Existing Features

- How does `when` interact with the error-on-missing behavior?
  - If `when` evaluates to false, plugin is not missing -- it's intentionally skipped
  - If `when` evaluates to true but plugin can't be resolved, error as usual

- How does `when` interact with user overrides?
  - Can users override `when` conditions in settings.json?
  - Or should user overrides bypass `when` entirely?

### Testing Strategy

- How to test conditional expressions?
- Mock file system for file existence checks?
- Test matrix for expression combinations?

## Open Questions

1. **Expression complexity**: How complex should the expression language be? Simple boolean checks vs. full expression language with comparisons and nested conditions.

2. **Host vs container evaluation**: File existence on host may differ from container. Which takes precedence? Or should we support explicit scoping (`hostFileExists` vs `containerFileExists`)?

3. **Dynamic re-evaluation**: If a file is created after container start, should plugins hot-load? Likely out of scope (evaluate once at start), but worth considering.

4. **Debugging**: How do users debug why a plugin wasn't loaded? Verbose logging? Dry-run mode showing which plugins would load and why?

5. **Default behavior**: If `when` is not specified, plugin always loads (current behavior). Is this the right default?

6. **Negation patterns**: Common pattern might be "load everything except when in CI". Should there be a `whenNot` or just use `!` operator?

## Prior Art

- **VS Code when-clauses**: Boolean expressions using context keys (editorTextFocus, languageId, etc.) with logical operators
- **Webpack conditionals**: Environment-based bundling decisions
- **GitHub Actions `if` conditions**: Expression syntax for workflow conditionals
- **Ansible `when` conditions**: Jinja2-based conditional task execution

## Success Criteria for Full Proposal

1. Clear, minimal expression language specification
2. Comprehensive list of supported context variables
3. Well-defined evaluation semantics (timing, scope, error handling)
4. Schema and TypeScript type definitions
5. Test plan with expression parsing and evaluation coverage
6. Implementation phases with clear milestones
