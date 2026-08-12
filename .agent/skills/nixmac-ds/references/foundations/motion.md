# Motion & signature effects

Source: `assets/starter/components/nixmac/tokens/effects.css` and `assets/starter/components/nixmac/buttons/ButtonGlow.jsx`.

## Elevation & focus

| Token | Use |
| --- | --- |
| `--shadow-xs` … `--shadow-md`, `--shadow-2xl` | card/popover elevation (subtle; dark UI leans on borders more than shadows) |
| `--ring-width` (3px) | focus ring width; ring color is `var(--ring)` |

Focus is expressed as a 3px ring: `boxShadow: 0 0 0 var(--ring-width) color-mix(in oklch, var(--ring) 50%, transparent)`. Keep all interactive components keyboard-focusable with a visible ring.

## The signature glow (reserved)

Two glow tokens exist and are **brand-critical**:

- `--brand-glow` — a lime halo (1px ring + soft outer bloom) for brand moments.
- `--teal-glow` — a teal ring+bloom for the **build/run** action, driven by `--glow-teal`.

`ButtonGlow` renders an animated conic teal ring around a pill button. The ring rotates via the `nixmac-glow-spin` keyframes:

- Idle: slow ambient rotation (~8s).
- `active`: ambient 5s rotation — the calm, "working" state chosen for nixmac. Do not speed this up; a fast spin reads as frantic.

Use `ButtonGlow` **only** for the primary "Build & Test" / apply / run affordance — the moment nixmac executes a change. Every other button is a plain `Button`. See `references/components/buttons.md`.

## General transitions

Components use short, quiet transitions (background/border/opacity, ~120–160ms). Keep motion subtle and functional — nixmac is a focused tool, not a marketing splash. Avoid large entrance animations, parallax, or bouncy easings.
