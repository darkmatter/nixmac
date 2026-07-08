# Feature Flags

Feature flags keep unfinished work out of release-like builds while still
letting the team iterate quickly.

## Tiers

- Experimental/in-progress: hidden by default, not user-facing, and safe to
  ship only because normal users cannot reach it.
- Validated/configurable: visible to users in settings or another explicit UI.

Do not use a user-facing flag to hide work that has not met the product quality
bar. Do not let hidden dev work define the release product.

## Implementation Rules

- Runtime environment access goes through `apps/native/src/lib/env.ts`.
- Behavior flags that users can control belong in preferences/configurable
  state, not hard-coded component booleans.
- Tabs or surfaces not meant to ship may need compile-time or build-profile
  gating.
- Hidden developer settings should use a deliberate affordance, not accidental
  discoverability.

## Review Questions

- Is this flag experimental or validated?
- What is the default in release builds?
- Who can turn it on?
- What removes the flag?
