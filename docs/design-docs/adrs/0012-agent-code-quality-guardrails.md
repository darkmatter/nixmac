# ADR 0012: Deterministic Guardrails For Agent Code Quality

Status: proposed for team review

## Context

Granola and Slack evidence from Cooper, Juan, and Farhan converged on the same
agent failure mode: as the codebase gets more complex, generic agents produce
large, locally plausible diffs that ignore repo-specific architecture, collapse
logic into giant files, and add code instead of reducing complexity.

Cooper's current manual workaround is highly scoped prompting: small file-level
instructions, explicit target files, and deterministic checks at the end. Juan
called out that large vibe-coded PRs surprise maintainers and create conflict or
cleanup burden. The team also values Storybook as a constrained frontend harness
and CLI/eval paths as cleaner core-logic surfaces.

## Decision

Agent work should be constrained by deterministic guardrails, not only prose:

- Prefer small slices with explicit owners and target files.
- Use Storybook-first UI development when the feature is mostly frontend state
  or interaction design.
- Use CLI-first or isolated core logic when the domain supports it, then wire UI.
- Split generated/mechanical artifacts from behavior changes when possible.
- Run lints, formatters, type checks, tests, and docs checks before claiming
  quality.
- Treat maximum function/file size, complexity, and duplicated ownership checks
  as valid future lint gates when the repo standardizes them.
- Promote repeated review comments into docs, tests, lints, ADRs, or Danger
  checks.

## Consequences

Agents should not attempt large multi-domain feature PRs in one pass unless the
user explicitly asks for that risk. When a change must cross Rust, generated
bindings, frontend state, Storybook, and docs, the PR should explain the split,
the generated pieces, and the verification story.

Reviewers should push back on "works by adding more code" fixes when a local
abstraction, managed edit helper, existing query hook, or state owner already
exists.
