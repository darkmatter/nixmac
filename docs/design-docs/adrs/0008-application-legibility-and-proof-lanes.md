# ADR 0008: Application Legibility And Proof Lanes

Status: proposed for team review

## Context

The OpenAI harness model depends on agents being able to observe and drive the
application. nixmac already has Storybook and Product Proof machinery, but
Product Proof is currently stale/advisory.

## Decision

Agents must use the smallest honest proof lane:

- static/lint checks for pure docs or narrow code changes;
- unit tests for local logic;
- Storybook for UI state and visual review;
- local macOS app/log evidence for native behavior;
- Product Proof only when refreshed or explicitly requested.

The repo must document how to boot the app, where logs live, and which critical
journeys matter.

## Consequences

- Verification claims must name the lane that actually ran.
- Product Proof remains advisory until ADR 0002 is replaced.
- UI-only Storybook evidence does not prove native macOS behavior.
