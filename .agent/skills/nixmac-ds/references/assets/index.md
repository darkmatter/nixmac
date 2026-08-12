# Assets

All shipped assets live in `assets/starter/public/nixmac/` and serve from `/nixmac/…` at runtime. These are the real nixmac brand assets — use them, never placeholder stock or invented logos.

## Brand marks

| File | viewBox | Use |
| --- | --- | --- |
| `/nixmac/icon.svg` | 560×520 | primary app icon (robot-face tile), light face on dark tile |
| `/nixmac/icon-dark.svg` | 576×533 | dark-variant app icon |
| `/nixmac/logo.svg` | 441×406 | full logo mark |
| `/nixmac/outline.svg` | 441×406 | outline logo (dark strokes) |
| `/nixmac/outline-white.svg` | 534×494 | outline logo (white strokes, for dark bg) |
| `/nixmac/nixmac-mascot.svg` | 441×406 | animated mascot (pairs with `nixmac-mascot.css`) |

- For the inline brand mark in components, prefer the **`NixmacMark`** React component (see `components/brand.md`) — it's recolorable and accessible.
- For favicons, `<img>` tags, OG images, or raw embeds, reference the SVG files by path, e.g. `<img src="/nixmac/logo.svg" alt="nixmac" />`.
- The mascot animation requires `/nixmac/nixmac-mascot.css` — link it if you use `nixmac-mascot.svg` as an animated element.

## AI provider icons

nixmac talks to model providers; their marks ship under `/nixmac/providers/`:

| File | Provider |
| --- | --- |
| `/nixmac/providers/openai.svg` | OpenAI |
| `/nixmac/providers/ollama.svg` | Ollama |
| `/nixmac/providers/openrouter.svg` | OpenRouter |

Use these when showing model/provider selection. They're monochrome-friendly; size ~16–20px and let them inherit surrounding color where possible.

## General icons

For everything else, use **lucide-react** (already a dependency), sized 12–16px to match component slots, inheriting `currentColor`. Do not introduce a second icon library.

## Rules

- Never invent new brand assets or alter the mark's proportions.
- Don't recolor the provider marks arbitrarily; keep them legible on the current surface.
- Decorative marks get `alt=""`/`aria-hidden`; meaningful logos get real `alt` text.
