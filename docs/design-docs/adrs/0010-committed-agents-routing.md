# ADR 0010: Commit Root Agent Routing

Status: accepted for this branch; call out in the PR before merge

## Context

The OpenAI-style harness needs a short, repo-root entrypoint that every agent can
find before reading deeper docs. In nixmac, `/AGENTS.md` was previously ignored
by bd initialization, so introducing a committed root `AGENTS.md` reverses that
local-file assumption.

## Decision

Commit root `AGENTS.md` as the canonical agent routing file. Keep it short and
link it to durable docs under `docs/` instead of duplicating the full harness.

## Consequences

- Agents have one stable first read for repo-specific defaults.
- The PR must explicitly mention that `/AGENTS.md` is now committed so Cooper
  and anyone with local untracked copies can reconcile them before merge.
- Ruler-generated ignore blocks or agent-file scaffolding must not regenerate an
  ignore rule for `/AGENTS.md` after this lands.
- Future personal or tool-specific scratch notes must not be placed in root
  `AGENTS.md`; use `.agent-runs/` for disposable run state and `docs/` for
  durable guidance.
