# ADR 0001: Repo-Local Agent Docs System

Status: proposed for team review

## Context

Agent behavior was relying on scattered sources: `.github/copilot-instructions.md`,
Cursor rules, Slack threads, Linear issues, GitHub PR reviews, and local memory.
Some existing instructions were stale, especially around state management and
IPC.

## Decision

Create a small repo-local docs system:

- Root `AGENTS.md` as the routing entrypoint.
- `docs/README.md` as the table of contents.
- Domain docs for onboarding, evolve agent, config/secrets, and release/CI.
- Quality, reliability, and security docs as explicit review rubrics.
- ADRs for durable decisions.
- Source log for promoted external evidence.

## Consequences

Agents have a committed source of truth before editing code. The docs must stay
small and maintained; stale docs are worse than missing docs.
