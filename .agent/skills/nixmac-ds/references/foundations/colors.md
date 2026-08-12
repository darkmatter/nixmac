# Colors, theming & the signature palette

Source: `assets/starter/components/nixmac/tokens/colors.css`. All values are OKLCH. Tokens are defined twice: `:root` = **light**, `.dark` = **dark** (the ship default). Reference every color as `var(--token)` — never hard-code.

## Theming model

- Dark-first. `app/layout.tsx` sets `<html class="dark">`. Light is enabled by removing the `.dark` class (the starter's `ThemeProvider` / `useTheme()` toggle handles this).
- The base is **monochrome-neutral** — nearly all surface/text tokens are hue 0 (pure gray). Color enters only through the brand, glow, semantic, and diff tokens. Keep it that way: a nixmac screen is mostly grayscale with sparse, meaningful color.

## Core surface & text tokens

| Token | Role | Dark value |
| --- | --- | --- |
| `--background` | app canvas | `oklch(0.1445 0 0)` (near-black) |
| `--foreground` | primary text | `oklch(0.9848 0 0)` |
| `--card` / `--card-foreground` | panels, cards | `oklch(0.169 0.002 270)` / `--foreground` |
| `--popover` / `--popover-foreground` | overlays | `oklch(0.205 0 0)` |
| `--primary` / `--primary-foreground` | solid buttons | `oklch(0.9848 0 0)` / `oklch(0.2044 0 0)` |
| `--secondary` / `--secondary-foreground` | secondary fills | `oklch(0.2686 0 0)` |
| `--muted` / `--muted-foreground` | subtle bg / dim text | `oklch(0.2686 0 0)` / `oklch(0.7153 0 0)` |
| `--accent` / `--accent-foreground` | hover fills | `oklch(0.2686 0 0)` |
| `--border` / `--input` | hairlines, field borders | `oklch(0.2686 0 0)` |
| `--ring` | focus ring | `oklch(0.8697 0 0)` |
| `--sidebar*` | sidebar surface set | see source |

## Brand & glow (the color that matters)

| Token | Meaning | Value |
| --- | --- | --- |
| `--brand` | **lime** accent — the one brand color | `oklch(0.9415 0.1774 123.64)` |
| `--brand-foreground` | text on brand | `oklch(0.1553 0.0042 285.9)` |
| `--glow-teal` | signature **teal** for the build/run action | `oklch(0.8 0.13 178)` |

Use `--brand` sparingly: the `NixmacMark`, one hero CTA halo, key highlights. Use `--glow-teal` **only** for the primary "Build & Test / run" affordance (see `motion.md` and `ButtonGlow`). Never use lime as a general button fill or teal as a decorative accent.

## Semantic status

| Token | Use | Dark value |
| --- | --- | --- |
| `--success` / `--success-foreground` | success (emerald) | `oklch(0.74 0.15 152)` / `oklch(0.2 0.03 152)` |
| `--warning` / `--warning-foreground` | warning (amber) | `oklch(0.81 0.14 65)` / `oklch(0.24 0.04 65)` |
| `--destructive` / `--destructive-foreground` | error/danger (bright red) | `oklch(0.69 0.26 16.55)` / `oklch(0.9848 0 0)` |

The `Badge` component maps `variant="success" | "warning" | "destructive"` onto these. On destructive alerts, keep the title/body text on `--destructive-foreground` (white) with the red on icon/border — bright red text on a panel reads poorly.

## Diff palette (Monaco "Minted")

nixmac's core surface is a config diff. Use these — **not** generic green/red:

| Token | Meaning | Value |
| --- | --- | --- |
| `--diff-added` | added lines (teal) | `oklch(0.9 0.08 178)` |
| `--diff-removed` | removed lines (rose) | `oklch(0.78 0.09 12)` |

Render added/removed line backgrounds as a low-alpha mix of these over `--card`, e.g. `background: color-mix(in oklch, var(--diff-added) 12%, transparent)`, with the `+`/`-` gutter glyph in the full-strength token. See `references/examples/agent-diff-review.md`.

## Charts & extras

`--chart-1`…`--chart-5` (distinct data-viz hues) and `--highlight` (selection wash) exist for data displays — see source for values.

## Mixing tokens

Prefer `color-mix(in oklch, var(--token) N%, transparent)` for tints/translucency and `color-mix(in oklch, var(--a) N%, var(--b))` for blends, so derived colors track the theme. This is how the components themselves build hover/tint states.
