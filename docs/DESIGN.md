# Design

nixmac should feel like a trustworthy native Mac tool for risky local system
changes. Design should make state, ownership, and reversibility legible.

## Core Principles

- Default surfaces should be release-shaped; hide experimental or half-wired
  behavior behind explicit flags.
- Show real app state, not polished placeholders.
- Make review/save/discard/rollback boundaries obvious.
- Use Storybook to make UI states inspectable, then verify native behavior in
  the app when the workflow depends on macOS, Tauri, git, Nix, or filesystem
  effects.
- Product Proof / Computer Use is advisory until refreshed.

## Feature Flags

Use two tiers:

- Hidden experimental/in-progress flags: off for normal users.
- Validated configurable flags: user-accessible settings once the feature is
  product-ready.

Runtime flags are appropriate for behavior toggles. Build-time flags are
appropriate for surfaces that should not ship at all yet.

## Visual Evidence

For UI changes, include Storybook states or screenshots when useful, but do not
claim native app confidence from Storybook alone.

Relevant design decisions live in [design-docs/index.md](design-docs/index.md).
