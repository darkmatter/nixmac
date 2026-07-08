# ADR 0009: Storybook Is The Frontend Agent Harness

Status: proposed for team review

## Context

Granola notes from 2026-06-23 record Cooper's view that Storybook previews and
snapshot diffs are high-signal for frontend regressions and that constraining
agents to mocked UI states can improve code quality as the codebase grows.

## Decision

Storybook is the primary frontend harness for new UI surfaces. New reusable or
behavior-sensitive UI should include stories that make key states inspectable by
agents and reviewers. Storybook is not a substitute for native app evidence when
the change touches Tauri, Rust, macOS permissions, git state, rebuild/apply, or
release behavior.

## Consequences

- Frontend PRs should include Storybook links or explain why they are not useful.
- Reviewers should treat broken Storybook/snapshot infrastructure as something
  to diagnose, not dismiss.
- Domain docs should call out story expectations for onboarding and settings.
