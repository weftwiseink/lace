---
name: rfp
description: Scaffold a lightweight request-for-proposal stub
argument-hint: "[topic]"
---

# CDocs RFP

Scaffold a lightweight request-for-proposal stub that captures an idea for future elaboration.

**Usage:** User-invoked when a proposal idea needs to be captured quickly without writing a full proposal.
RFP stubs feed the proposal pipeline: `/cdocs:propose` can later consume an RFP stub by elaborating it in-place.

## Invocation

1. If `$ARGUMENTS` provides a topic, use it. Otherwise, prompt the user.
2. Determine today's date.
3. Create `cdocs/proposals/YYYY-MM-DD-topic.md` using the template below.
4. If `cdocs/proposals/` doesn't exist, suggest running `/cdocs:init` first.
5. If a file already exists at the target path, report the collision and ask the user whether to open the existing file or create a new one with a disambiguating suffix.

## Template

Use the template in `template.md` alongside this skill file.
Fill in:
- `first_authored.by` with the current model name (e.g., `@claude-opus-4-5-20251101`) or `@username` for human authors.
- `first_authored.at` with the current timestamp including timezone.
- `task_list` with the relevant workstream path. For nascent ideas where the workstream is not yet well-defined, use a provisional path that can be refined during elaboration.
- `type: proposal`, `state: live`, `status: request_for_proposal`.
- `tags` relevant to the idea. Author-supplied tags are sufficient for initial discoverability; the triage subagent refines them later.

## Sections

RFP stubs have four required sections.
Keep stubs lightweight: capture intent and scope, not design.

- **> BLUF:** One-line summary of the idea and its value.
  - Ideally contains a **Motivated By:** `${paths to motivating cdocs}` bullet point
- **Objective:** The problem or improvement goal.
- **Scope:** What the full proposal should explore. Frame as questions or bullet points.
- **Open Questions:** Unknowns that need resolution before or during elaboration.

### Optional freeform sections

The author may add domain-specific sections as needed beyond the four required sections.
Common optional sections include:

- **Known Requirements**: concrete scenarios or constraints already identified.
- **Prior Art**: links to related docs, external references, or existing implementations.
- **Context**: brief background if the objective alone is insufficient.

These are suggestions, not requirements.
The goal is to capture enough information to seed a future proposal without over-specifying the design.

## Relationship to `/cdocs:propose`

RFP stubs are the entry point of the proposal pipeline.
To elaborate an RFP stub into a full proposal, the user invokes `/cdocs:propose cdocs/proposals/YYYY-MM-DD-topic.md`.
The propose skill detects `status: request_for_proposal` and elaborates the stub in-place.

The RFP step is optional: `/cdocs:propose` can still create proposals from scratch without a prior RFP stub.
