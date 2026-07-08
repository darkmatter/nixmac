# ADR 0007: Semantic Nix Edits Preserve User Intent

Status: proposed for team review

## Context

Slack threads around login items, Homebrew services, and auto-nixfmt show a
consistent product preference: nixmac should manage explicit user intent and
avoid destructive or broad edits to user-owned config.

## Decision

Managed Nix edits should be semantic, surgical, and scoped to the user's
intent. Avoid importing vendor-managed machine state. Use Nix evaluation where
possible to avoid duplicate recommendations. Formatting should be scoped to the
edited expression or called out explicitly when broader.

### 2026-07-02 Addendum

Agents should preserve the user's existing expression shape unless the requested
change requires a broader rewrite. Do not flatten nested attrsets, reorder
unrelated siblings, or rewrite a whole file to add one option.

Before adopting macOS or system state into managed Nix, prove the state maps to
explicit user intent. Prefer evidence from the user's config, an app workflow, or
a clear prompt over incidental machine state.

When several Nix option families can represent a behavior, prefer the family
already used nearby. If no local pattern exists, choose the narrowest option
that matches the requested behavior and document the tradeoff in the PR.

### 2026-07-08 Runtime Option Metadata Addendum

Runtime nix-darwin/Home Manager option metadata should be generated from the
same source of truth used by scanner behavior and docs search. Do not let
`search_docs`, scanner recommendations, and UI copy drift into separate option
schemas.

When option shape or default values affect correctness, derive metadata from the
user's pinned inputs or the evaluated runtime context. Cache invalidation should
include `flake.lock` and the relevant input revisions, not just app version.

Legacy `*-options.json` bundles and atomic markdown option files are
implementation details. Do not document them as the product contract unless the
shipping app actually reads them.

## Consequences

- Homebrew services and user-authored launch agents/daemons are better
  candidates than opaque login/background items.
- Semantic editors must not overwrite files just to add one option.
- Reviewer evidence should include before/after diff and git status for managed
  edits.
- Broad formatter churn should be separated from semantic edits. If a formatter
  touches unrelated expressions, call that out and avoid mixing the churn with a
  behavior change when possible.
- Option docs, scanner metadata, and `search_docs` fixtures should share
  provenance and cache keys whenever they describe the same Nix option surface.
