# Quality Score

Use this rubric before calling a nixmac change "done." Score each category 0-3.
A launch-quality change should be at least 14/18 with no zeroes.

This is a pre-PR self-check. Report the score in the PR only when the PR is
large, risky, or when a reviewer asks for it.

## 1. Product Fit

- 0: Solves an internal shape but not the user's workflow.
- 1: Partially addresses the workflow with obvious missing states.
- 2: Covers the main workflow and expected edge cases.
- 3: Covers the workflow, edge cases, empty/error states, and aligns with current
  product priorities.

## 2. Architecture Fit

- 0: Adds a new pattern where an established one exists.
- 1: Mostly works but bypasses state/IPC/config conventions.
- 2: Uses existing conventions with minor debt.
- 3: Strengthens existing architecture or removes meaningful drift.

## 3. Correctness

- 0: Relies on guesses or has known broken paths.
- 1: Handles the happy path only.
- 2: Handles realistic success/failure paths.
- 3: Handles boundaries, races, stale state, and recovery paths.

## 4. Verification

- 0: No meaningful verification.
- 1: Only static checks or only manual smoke.
- 2: Relevant automated or manual verification ran.
- 3: Verification matches blast radius and includes failure/recovery evidence.

## 5. Maintainability

- 0: Hard to understand or likely to break adjacent flows.
- 1: Localized but duplicates logic or buries assumptions.
- 2: Clear and reasonably scoped.
- 3: Clear, scoped, documented when needed, and easy for the next agent to edit.

## 6. Review Readiness

- 0: Missing context, test plan, or linked issue.
- 1: Reviewable only with tribal knowledge.
- 2: PR explains what changed and how to verify it.
- 3: PR links Linear/GitHub context, explains tradeoffs, and highlights risks.

## Quality Bar

Extra attention goes to changes touching onboarding, evolve agent, git state,
secrets, release, or CI. These should include explicit failure-mode thinking,
not just happy-path implementation.

## Agent-Code Quality Checks

Before calling agent-written code high quality, check for these nixmac-specific
failure modes:

- Did the agent use an established local path such as oRPC/TanStack Query,
  managed edits, nostics diagnostics, or path-safe helpers instead of inventing
  a generic pattern?
- Did the change add one large file or oversized function where local code uses
  smaller domain-owned modules?
- Did it split generated/mechanical artifacts from behavior changes or at least
  call them out for review?
- Did it preserve Nix expression shape, comments, and host/platform boundaries?
- Did it re-check live git/system/config state before applying a managed edit?
- Did it distinguish app failure from CI/provider/runner failure?
- Did it include the lowest proof lane that matches the blast radius?
- If it touched backend-derived UI state, path/security boundaries, credentials,
  or user config, did it follow
  [AGENTS.md](../AGENTS.md#high-risk-routing)?
- Did new tests match the package's actual test runner conventions?

If two or more answers are "no", cap Maintainability and Review Readiness at 1
unless the PR explicitly explains the tradeoff.

## Harness Guidance Provenance

When adding durable guidance for agents, prefer rules backed by a non-evaluation
source: repo invariant, ADR, PR review pattern, Slack/Granola decision, or a
repeated codebase pattern. Evaluation failures can reveal weak spots, but do not
turn an offline-evaluation answer into durable guidance unless the rule also has
a broader source.

If a new guidance bullet is seeded by evaluation results, record that in the
local evaluation artifact and keep the next confirmatory evaluation from using
that same seeded task as clean primary evidence.

## Example

For a small onboarding parser fix with unit tests, Storybook coverage, and no
backend behavior change:

- Product Fit: 2 if the main import path works, 3 if non-root flakes, `?ref=`,
  `?dir=`, empty state, and failure copy are covered.
- Architecture Fit: 2 if it uses existing parser/viewmodel patterns, 3 if it
  removes duplicate frontend/backend parsing.
- Correctness: 2 with happy-path and rejection tests, 3 with regression tests
  for previously broken formats.
- Verification: 2 if relevant unit tests ran, 3 if unit tests plus Storybook or
  app-level import verification ran.
- Maintainability: 2 if the code is scoped, 3 if assumptions are documented or
  centralized.
- Review Readiness: 2 with a clear test plan, 3 with Linear/GitHub context and
  explicit skipped-lane notes.
