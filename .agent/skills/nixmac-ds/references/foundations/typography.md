# Typography

Source: `assets/starter/components/nixmac/tokens/typography.css` and `tokens/fonts.css`. Fonts load via `styles.css` (already linked in `globals.css`) from the Fontsource CDN — no font setup needed.

## Font families

| Token | Family | Use for |
| --- | --- | --- |
| `--font-sans` | **Inter Variable** (100–900) | all UI text, headings, body, labels |
| `--font-mono` | **Geist Mono Variable** (100–900) | file paths, package names, hashes, diffs, terminal/agent output, `Kbd`, `FileBadge` |

The sans/mono split is meaningful in nixmac: anything the machine produced or that names a system path renders in **Geist Mono**. Prose and chrome render in **Inter**. Don't mix them up.

```tsx
<p style={{ fontFamily: "var(--font-sans)" }}>Apply this change to your config?</p>
<code style={{ fontFamily: "var(--font-mono)" }}>modules/home/programs/direnv.nix</code>
```

## Type scale

| Token | Size | Typical use |
| --- | --- | --- |
| `--text-xs` | 12px | captions, meta, badge text |
| `--text-sm` | 14px | **base UI text** (default) |
| `--text-base` | 16px | body copy |
| `--text-lg` | 18px | card titles |
| `--text-xl` | 20px | section headings |
| `--text-2xl` | 24px | page headings |
| `--text-3xl` | 30px | large headings |
| `--text-4xl` | 36px | display |
| `--text-6xl` | 60px | hero |

Base UI text is **14px (`--text-sm`)**, not 16 — this is a dense, desktop-app aesthetic.

## Line height, weight, tracking

- Leading: `--leading-tight` 1.1, `--leading-snug` 1.35, `--leading-normal` 1.5, `--leading-relaxed` 1.7.
- Weight: `--font-weight-normal` 400, `--font-weight-medium` 500, `--font-weight-semibold` 600. Headings and emphasis top out at 600 — nixmac never uses heavy/black weights.
- Tracking: `--tracking-tight` (-0.01em) on headings and titles; `--tracking-normal` (0) for body.

Apply as `style={{ fontSize: "var(--text-sm)", lineHeight: "var(--leading-normal)", fontWeight: "var(--font-weight-medium)", letterSpacing: "var(--tracking-tight)" }}`.
