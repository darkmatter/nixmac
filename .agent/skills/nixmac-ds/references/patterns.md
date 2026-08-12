# Screen-level patterns

Cross-cutting guidance for composing nixmac screens. For component APIs see `components/`; for tokens see `foundations/`.

## The nixmac feel

A nixmac screen is **mostly grayscale, dense, and calm**. Neutral surfaces (`--background`, `--card`), hairline `--border`s, 14px base text, and generous but not airy spacing. Color is rare and load-bearing: the lime `--brand` for identity, the teal glow for the build action, semantic tints for status, and the diff palette for changes. If a screen looks colorful, it's wrong.

## Layout skeleton

- **Top bar**: `NixmacMark` + wordmark left; actions/toggle right. Separate from content with a `--border` bottom rule.
- **Body**: a centered container (`max-width` ~1000–1100px, `margin-inline: auto`, `padding-inline: var(--space-6)`), sections separated by `--space-8`…`--space-12`.
- **Cards** carry the real content — compose `Card` + subparts rather than free-floating divs. Group related settings/reviews into one Card.
- Build responsively with flex/grid + `gap` tokens and `auto-fit` grids (see `foundations/spacing-layout.md`). No fixed page widths.

## Recurring compositions

- **Prompt → review → build**: `Textarea` (+ `BadgeButton` suggestions) → `Tabs` review/diff → `ButtonGlow`. See `examples/agent-diff-review.md`.
- **Settings rows**: `Label` + hint (mono option name via `--font-mono`) on the left, `Switch`/`Checkbox`/`Input` on the right; rows separated by `Separator`.
- **Status line**: `Badge variant="success|warning|destructive"` for outcomes; `Spinner` + muted text while running; `FileBadge` for any path/hash.
- **Diffs**: mono lines, `--diff-added`/`--diff-removed` at ~10% background with full-strength text; `+N`/`-N` counts in mono muted.

## Client boundary

Every nixmac component is a client component (state/hooks/context). Put `"use client"` at the top of any page/section that renders them. Keep purely static server content in separate server components if you want, and drop the interactive parts into a client child.

## Theme

Ship dark (`<html class="dark">`). Add a light/dark toggle only when the product calls for it, using the starter's `ThemeProvider`/`useTheme()`. Both themes are fully tokenized, so components adapt automatically — never hard-code a color that wouldn't flip.

## Don'ts

- Don't add Tailwind classes or a second component/icon library.
- Don't use the teal glow or lime brand as general decoration.
- Don't use generic green/red for diffs — use the diff tokens.
- Don't hard-code hex/px where a token exists.
- Don't render machine text (paths, hashes, config) in Inter — use `--font-mono`.
