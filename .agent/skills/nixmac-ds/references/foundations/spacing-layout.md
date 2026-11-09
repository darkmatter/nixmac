# Spacing, radii, layout & responsiveness

Sources: `assets/starter/components/nixmac/tokens/spacing.css` and `tokens/radius.css`.

## Spacing scale

Tailwind-4-based, 0.25rem unit. Use these tokens for gaps, padding, and margins:

| Token | px | | Token | px |
| --- | --- | --- | --- | --- |
| `--space-0-5` | 2 | | `--space-5` | 20 |
| `--space-1` | 4 | | `--space-6` | 24 |
| `--space-1-5` | 6 | | `--space-8` | 32 |
| `--space-2` | 8 | | `--space-10` | 40 |
| `--space-3` | 12 | | `--space-12` | 48 |
| `--space-4` | 16 | | | |

Component internals commonly use 12–16px (`--space-3`/`--space-4`) padding and 8–12px gaps. Section rhythm on pages uses 32–48px (`--space-8`…`--space-12`).

## Radii

| Token | px | Use |
| --- | --- | --- |
| `--radius-sm` | 4 | inputs, small chips |
| `--radius-md` | 6 | buttons, badges |
| `--radius-lg` | 8 | cards, popovers, alerts (base `--radius`) |
| `--radius-xl` | 12 | large cards, panels |
| `--radius-full` | 9999 | pills — `ButtonGlow`, tags, `Switch` |

## Layout & responsiveness

nixmac's origin is a **fixed-size native desktop widget** — `--window-min-width: 800px`, `--window-min-height: 600px` exist in `spacing.css` as the app's real minimums. The design system ships **no web breakpoint tokens or responsive props**; components are fluid and size to their container.

So for web screens, build responsiveness with **standard CSS that respects the tokens**:

- Use flexbox/grid with `gap: var(--space-N)` and let content wrap: `display: flex; flex-wrap: wrap` or `grid-template-columns: repeat(auto-fit, minmax(<min>, 1fr))`.
- Constrain reading width with a centered container (e.g. `max-width: 1100px; margin-inline: auto; padding-inline: var(--space-6)`).
- Use `clamp()` for fluid type/space on hero/section headings rather than fixed px.
- The starter's `app/page.module.css` is the worked example: an `auto-fit` swatch grid, a two-column layout that collapses under `@media (max-width: 720px)`, and a nav that stacks on narrow widths. Mirror that approach — token-driven, container-first, with a small number of `max-width` media queries only where a grid must change column count.
- Don't hard-code fixed pixel widths for page regions; let them be fluid down to mobile.

Verify layouts at desktop **and** a narrow (~390px) width; the components themselves are happy fluid.
