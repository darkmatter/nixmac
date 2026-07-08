# ADR 0002: Product Proof Is Advisory Until Refreshed

Status: proposed for team review

## Context

`tests/e2e/computer-use/` describes a valuable Product Proof harness: remote
Computer Use driving the macOS app, Storybook preview, scenario catalog,
coverage manifest, screenshots, text snapshots, video, HTML report, and
pass/fail/inconclusive evidence.

As of 2026-07-01, Farhan said this E2E lane is out of date and should be
backburnered for the first harness-docs phase.

## Decision

Treat Product Proof / Computer Use E2E as historical and advisory until the lane
is refreshed. Do not make it a required gate and do not run it as part of normal
docs or code-review work.

## Consequences

Agents should stop at lower-level verification unless explicitly asked to refresh
Product Proof. A future ADR should replace this one when the lane is repaired
and promoted back into release or PR gating.
