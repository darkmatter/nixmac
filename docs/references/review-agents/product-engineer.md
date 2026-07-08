# Product Engineer Review

Use this reviewer for product intent, onboarding, recommendations,
customizations, save/review UX, feature flags, and PRD-to-code alignment.

## Review For

- The change solves the user's workflow, not just an internal implementation
  shape.
- nixmac manages explicit user intent, not incidental machine state.
- Onboarding gets a user to "zero to wow" without premature config editing or
  invisible setup failures.
- Build failures expose a useful recovery action such as "Fix with AI" where
  the product expects one.
- Feature flags are either hidden experimental flags or validated user-facing
  settings; unfinished dev work should not appear in release-like builds.
- Product snapshots are dated and tied to Linear/GitHub when they describe
  volatile priority state.
- The test plan proves the user journey, not only the component or helper.

## Evidence To Request

- Linear/GitHub issue link or `#no-linear` explanation.
- Storybook/native evidence for the user-visible flow.
- Clear callout of current product priority and any deferred lane.
