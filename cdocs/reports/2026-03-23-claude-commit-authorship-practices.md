---
first_authored:
  by: "@claude-opus-4-6-20250320"
  at: 2026-03-23T14:00:00-07:00
task_list: lace/claude-commit-authorship
type: report
state: live
status: review_ready
tags: [git, attribution, architecture, claude_code]
---

# Claude Commit Authorship Practices

> BLUF: There is no single correct approach to AI commit authorship.
> The right choice depends on context: personal projects, team repos, and open source each have different requirements.
> For this project (lace), the current pattern of human author + `Co-Authored-By` trailer is well-suited: it preserves contributor graph accuracy, satisfies DCO requirements, and provides full auditability.
> The trailer format Claude Code uses (`Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`) is recognized by GitHub and does not require a real email address.
> The most important gap in this project is not authorship attribution but the absence of any git identity configuration in the devcontainer, which blocks committing entirely.

## Background

Git tracks two identities per commit: **author** (who wrote the change) and **committer** (who applied it to the repository).
These are independent fields with separate name/email pairs.
Most tools display the author by default; the committer is visible via `git log --format='%cn <%ce>'` or in GitHub's expanded commit view.

The `Co-Authored-By` trailer is a commit message convention (not a git primitive) that GitHub and GitLab parse to display additional contributors on a commit.
It lives in the commit message body, not in git's structured author/committer metadata.

## Approach Analysis

### 1. Human Author + Co-Authored-By Trailer

The human developer is the git author.
Claude is credited via a `Co-Authored-By` trailer in the commit message body.

This is what Claude Code does by default and what this project currently uses.
19 of the last 20 commits in this repo carry the trailer `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`.

**How GitHub renders it:**
GitHub displays the co-author avatar and name on the commit detail page.
The human author appears in contributor graphs, blame views, and PR attribution.
The co-author does not appear in the repository's main contributor list, only on individual commits.

**Legal/IP:**
The human is the legal author.
This aligns with the U.S. Copyright Office position that copyright requires human authorship.
The human can sign off on DCO (Developer Certificate of Origin) obligations without ambiguity.
The co-author trailer serves as disclosure, not as a claim of AI copyright.

**Auditability:**
`git log --grep="Co-Authored-By: Claude"` identifies all AI-assisted commits.
This is greppable, standard, and preserved through most git operations.

> WARN(opus/claude-commit-authorship): Squash merges via GitHub's web UI discard commit message bodies, including Co-Authored-By trailers.
> Merge commits and rebase merges preserve them.

**Open source compatibility:**
Fully compatible with DCO-based projects.
The Linux kernel's `coding-assistants.rst` policy requires human sign-off and recommends an `Assisted-by` tag for tool disclosure, which is compatible with this approach.
Some projects (e.g., QEMU) ban AI-generated contributions entirely; the trailer makes compliance auditing straightforward.

**Verdict:** Best default for most contexts.
Low friction, high auditability, no legal ambiguity.

### 2. Claude as Author + Human as Committer

Git author is set to Claude (via `--author="Claude <noreply@anthropic.com>"`).
The human's identity appears only as the committer.

**How GitHub renders it:**
The author (Claude) appears in `git log`, `git blame`, and commit listings.
The committer (human) is visible only in expanded commit details.
If the author email does not match a GitHub account, the commit is attributed to a ghost user in contributor graphs.
This can inflate "contributor" counts with phantom entries.

**Legal/IP:**
Creates ambiguity.
The git author field is commonly treated as the copyright holder in tooling and legal analysis.
Since AI-generated output is not copyrightable in the U.S. (per *Thaler v. Perlmutter*), marking AI as the author could be interpreted as disclaiming copyright over the code.
This may be undesirable for commercial or open source projects.

**Auditability:**
Excellent: `git log --author="Claude"` cleanly separates AI-authored commits.
This is the strongest approach for audit filtering.

**Signed commits:**
GPG/SSH signature verification applies to the committer, not the author.
A human-signed commit with a non-human author will show as "Verified" on GitHub because the committer's signature is valid.
No technical issue, but the optics of a "Verified" commit with a non-human author may confuse reviewers.

**Open source compatibility:**
Problematic for DCO-based projects.
The DCO `Signed-off-by` tag is conventionally tied to the author.
An AI author cannot legally certify the DCO.
The Linux kernel explicitly prohibits AI agents from adding `Signed-off-by`.

**Verdict:** Useful for personal projects where audit filtering is a priority.
Avoid for open source or team projects due to legal and DCO complications.

### 3. Claude as Author + Co-Authored-By Human

Inverse of approach 1: Claude is the git author, the human is credited via `Co-Authored-By` trailer.

**How GitHub renders it:**
Claude appears as the primary author in all default views.
The human appears as a co-author on the commit detail page but not in contributor graphs.
This is the worst outcome for contributor visibility: the human who directed, reviewed, and approved the work is reduced to a footnote.

**Legal/IP:**
Same problems as approach 2, compounded by the human's reduced visibility.
The person actually responsible for the code is not the git author, creating a disconnect between legal accountability and version control metadata.

**Auditability:**
Human contributions are harder to find since the co-author trailer is less queryable than the author field.

**Open source compatibility:**
Incompatible with most project norms.
No major open source project recommends this pattern.

**Verdict:** Not recommended for any context.
It inverts the actual responsibility relationship.

### 4. Shared/Bot Account

A dedicated bot identity (e.g., `lace-bot <bot@example.com>`) is used as the git author for all AI-assisted commits.
The human is either the committer or credited via trailer.

**How GitHub renders it:**
If the bot email is linked to a GitHub account (e.g., a machine user or GitHub App), commits appear attributed to that account.
GitHub Apps can produce "Verified" commits automatically when committing via the API.
The bot appears in contributor graphs.

**Legal/IP:**
Similar to approach 2: the bot is not a legal person.
The advantage over approach 2 is that a bot account can be organizationally owned, making the ownership chain clearer.
The disadvantage is that individual human accountability is obscured.

**Auditability:**
Clean separation: `git log --author="lace-bot"` captures all bot commits.
Does not distinguish between different AI tools (Claude vs. Copilot vs. manual bot scripts).

**Signed commits:**
GitHub Apps can sign commits via the API with GitHub's own key.
Self-hosted bots require managing GPG/SSH keys for the bot identity.

**Open source compatibility:**
Common for CI/CD automation (dependabot, renovate).
Less accepted for substantive code contributions.
The Linux kernel and most DCO-based projects would not accept `Signed-off-by` from a bot.

**Verdict:** Appropriate for CI/CD and automated maintenance tasks.
Overkill for interactive AI-assisted development where a human is directing the work.

### 5. Human-Only Authorship (No AI Attribution in Metadata)

The human is the sole git author.
AI involvement is mentioned only in prose (commit message body, PR description) or not at all.

**How GitHub renders it:**
Indistinguishable from fully human-authored commits.
Contributor graphs, blame, and PR attribution all show only the human.

**Legal/IP:**
Cleanest from a copyright perspective.
The human claims full authorship, which is defensible when the human directed, reviewed, and approved the code.
This is the implicit stance of most Copilot usage today: GitHub Copilot does not add any co-author attribution by default.

**Auditability:**
None from git metadata.
If AI involvement is mentioned in commit messages, it is ad-hoc and unstructured.
If not mentioned at all, there is no audit trail.

> NOTE(opus/claude-commit-authorship): Some organizations are building tooling to detect AI-generated code patterns regardless of attribution metadata.
> Coderbuds and similar tools publish YAML rule sets for detecting Claude Code, Copilot, and Cursor contributions from code style and commit message patterns.

**Open source compatibility:**
Fully compatible with all project policies, including those that ban AI contributions, since there is no disclosure.
Whether non-disclosure is ethical when a project has an explicit AI ban is a separate question.

**Verdict:** Pragmatic for projects that do not require AI disclosure.
Inappropriate when transparency is a value or when project policy requires disclosure.

## Comparison Matrix

| Criterion | Human + Co-Author | Claude Author | Claude Author + Co-Author Human | Bot Account | Human Only |
|---|---|---|---|---|---|
| Contributor graph accuracy | Correct | Distorted | Inverted | Bot visible | Correct |
| `git blame` attribution | Human | Claude | Claude | Bot | Human |
| DCO compatibility | Yes | No | No | No | Yes |
| Copyright clarity | Clear | Ambiguous | Ambiguous | Ambiguous | Clear |
| Auditability (AI involvement) | Good (grep trailer) | Excellent (author field) | Good (author field) | Good (author field) | None |
| Signed commit compatibility | No issues | Works but confusing | Works but confusing | Requires key mgmt | No issues |
| Open source acceptance | High | Low | Very low | Medium (for automation) | Highest |
| Personal project suitability | Good | Good | Poor | Overkill | Good |

## Claude Code Specifics

### Default Trailer Format

Claude Code appends this trailer to commit messages by default:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

In practice, the format varies by model.
This project's commits use `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`, which includes the model name and context window.

### Email Address Validity

The `noreply@anthropic.com` email does not need to be a real, deliverable address.
GitHub's Co-Authored-By parsing requires only the `Name <email>` format.
The email is used for account linking: if the email matches a GitHub account, the avatar and profile link appear.
Since `noreply@anthropic.com` does not match any GitHub account, the co-author renders as plain text without a profile link.

> NOTE(opus/claude-commit-authorship): GitHub's own noreply addresses (`ID+username@users.noreply.github.com`) demonstrate that non-functional emails work for attribution purposes.

### Configuration

Claude Code's co-authorship behavior is controlled by settings:
- `"includeCoAuthoredBy": false` in `~/.claude/settings.json` or `.claude/settings.json` removes the trailer.
- The setting can be overridden per-project via `.claude/settings.local.json`.
- Disabling the trailer does not change Claude Code's functionality, only the commit message content.

### Interaction with Signed Commits

The `Co-Authored-By` trailer lives in the commit message body, which is part of the signed payload.
GPG/SSH signatures cover the entire commit object, including the message body.
Adding or removing the trailer after signing invalidates the signature.

There is no conflict between the trailer and commit signing: the human signs the commit, and the trailer is part of what they sign.
This is semantically clean: the human is attesting to the commit contents (including the disclosure that Claude co-authored it).

## This Project's Current State

### What works

All recent commits use the human author + Co-Authored-By trailer pattern.
The author/committer fields are consistent (`micimize <rosenthalm93@gmail.com>` for both).
The trailer is present on 19 of the last 20 commits, providing a strong audit trail.

### What does not work

Git identity is not configured in this devcontainer at any level.
`user.name` and `user.email` are empty in global, local, and environment variable contexts.
This means `git commit` fails entirely without explicit `--author` overrides.

> NOTE(opus/claude-commit-authorship): This gap is documented in detail in `cdocs/reports/2026-03-23-devcontainer-git-identity-gaps.md`.
> Resolving it is a prerequisite for any commit authorship strategy to function.

The most recent commit ("claudin up a sprack") lacks the Co-Authored-By trailer, breaking the otherwise consistent pattern.
This may indicate it was committed outside of Claude Code or with the setting disabled.

## Recommendations

1. **Continue using human author + Co-Authored-By trailer** as the default for this project.
   It is the most widely accepted pattern, provides adequate auditability, and creates no legal ambiguity.

2. **Fix the devcontainer git identity gap** before worrying about attribution nuances.
   Without `user.name` and `user.email`, no commits can be created at all.

3. **Do not switch to Claude-as-author** for this project.
   The contributor graph distortion and DCO incompatibility outweigh the marginal auditability benefit.

4. **Consider adding a project-level convention** (in CLAUDE.md or `.claude/settings.json`) that explicitly documents the expected authorship pattern.
   This prevents drift when different Claude sessions or human collaborators use different defaults.

5. **Be aware of squash merge behavior.**
   If PRs are squash-merged via GitHub's web UI, the Co-Authored-By trailer is lost.
   Use merge commits or rebase merges to preserve attribution metadata.

## Sources

- [How to Use Git with Claude Code: Understanding the Co-Authored-By Attribution](https://www.deployhq.com/blog/how-to-use-git-with-claude-code-understanding-the-co-authored-by-attribution)
- [Should AI Be Listed as a Co-Author in Your Git Commits?](https://www.dariuszparys.com/should-ai-be-listed-as-a-co-author-in-your-git-commits/)
- [The DCO Debate: Who Is Responsible for AI-Generated Code?](https://adventures.nodeland.dev/archive/who-is-responsible-for-ai-generated-code)
- [Attribute Git Commits to AI Agents](https://elite-ai-assisted-coding.dev/p/attribute-git-commits-to-ai-agents)
- [Git AI Standard v3.0.0](https://github.com/git-ai-project/git-ai/blob/main/specs/git_ai_standard_v3.0.0.md)
- [Signing Your Name on AI-Assisted Commits with RAI Footers](https://dev.to/anchildress1/signing-your-name-on-ai-assisted-commits-with-rai-footers-2b0o)
- [About Commit Signature Verification - GitHub Docs](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
- [Git Commits Partially Verified - Secure Git Guide](https://secure-git.guide/009_GPG-Git-commits-partially-verified)
- [Navigating the Legal Landscape of AI-Generated Code](https://www.mbhb.com/intelligence/snippets/navigating-the-legal-landscape-of-ai-generated-code-ownership-and-liability-challenges/)
- [Copyright and Artificial Intelligence - U.S. Copyright Office](https://www.copyright.gov/ai/)
- [How Can Open Source Projects Accept AI-Generated Code? - Lessons from QEMU's Ban Policy](https://shujisado.org/2025/07/02/how-can-open-source-projects-accept-ai-generated-code-lessons-from-qemus-ban-policy/)
- [Co-authoring Git commits](https://dev.to/cassidoo/co-authoring-git-commits-3gin)
- [Easily create co-authored commits with GitHub handles](https://sethmlarson.dev/easy-github-co-authored-by)
- [The New Git Blame: Who's Responsible When AI Writes the Code?](https://pullflow.com/blog/the-new-git-blame/)
