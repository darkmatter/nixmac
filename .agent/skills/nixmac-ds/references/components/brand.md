# Brand

Source: `assets/starter/components/nixmac/brand/NixmacMark.jsx`.

## NixmacMark

The nixmac brand mark — the rounded-square app tile with the friendly robot-face glyph. Use it in nav bars, headers, empty states, and auth screens. This is the real app icon; do **not** substitute a generic logo or invent a wordmark.

```tsx
import { NixmacMark } from "@/components/nixmac";

<NixmacMark size={32} />                          {/* default: dark tile + light face */}
<NixmacMark variant="glyph" size={24} />          {/* transparent, face-only mark */}
<NixmacMark size={40} tile="#000000" face="#DBDBDB" />
```

- `size` (default 48): px width/height (square).
- `variant`: `tile` (default, rounded-square app tile) | `glyph` (transparent face only, for tight/monochrome spots).
- `tile` / `face`: override the tile and face colors. Defaults are the shipping dark tile `#262626` and light face `#DBDBDB`. To tint on-brand, pass a token-derived color via a resolved value; keep contrast high.
- Renders an accessible `<svg role="img" aria-label="nixmac">`.

### Other brand assets

Full logo/icon/mascot inventory (SVGs in `public/nixmac/`) is in `references/assets/index.md`. Use `NixmacMark` for the inline mark; use the `public/nixmac/logo.svg` / `icon*.svg` files when you need the raw asset (e.g. favicon, `<img>`).
