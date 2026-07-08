# Product Sense

Durable product and reviewer taste for nixmac.

## Current Product Priorities

- Onboarding is the highest-risk product surface.
- Config import is a major wedge: users need their real nix-darwin config in the
  app without losing explicit intent.
- Evolution quality, speed, reliability, and refinement context come before
  plugin expansion.
- Save/review/rollback must reconcile to git; app-local state cannot pretend to
  be the source of truth.
- macOS permission and `/Applications` placement issues are real product risks.

## Reviewer Taste

Scott tends to reward concrete correctness: clear naming, deduplicated logic,
performance awareness, regression tests, and minimal formatting churn. He will
reject broad speculative cleanup when local context does not justify it.

Cooper emphasizes coherent onboarding, product intent, and avoiding internal
implementation leakage in user-facing state.

Juan/arximboldi emphasizes homogeneous state ownership, Nix-native expectations,
realistic user repos, comments/formatting preservation, and inspectable
eval/report artifacts.

## Durable Team Rules

- Storybook is useful review evidence, but native workflows need native proof.
- Repeated review feedback should become docs, tests, lints, or ADRs.
- Candidate eval tasks from Slack, Granola, GitHub, or docs are training and
  calibration seeds, not clean held-out tasks.
- Feature flags are hidden until a feature is product-ready.
- Multi-host configs need host/platform-specific checks.
