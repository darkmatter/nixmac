# nixmac mascot — animated

An idle animation of the nixmac face (blink · smile breathe · circuit pulse) plus
an intermittent **hop + 360° spin**, built from the brand mark. Two render paths;
pick by your needs.

```
nixmac-mascot.svg      ← source of truth: logo.svg re-rigged, one <g id> per feature
build_lottie.py        ← SVG → Lottie generator (tune the motion here)
nixmac-mascot.json     ← generated, portable Lottie (committed)
NixmacMascotLottie.tsx ← React: real Lottie  (needs `lottie-react`)
NixmacMascot.tsx       ← React: pure SVG+CSS (zero deps, not a portable Lottie)
nixmac-mascot.css      ← the CSS-path animation
nixmac-mascot.stories.tsx ← Storybook (Brand/Nixmac Mascot)
```

## Option A — real Lottie (portable)

Plays anywhere Lottie does (web, iOS, Android, LottieFiles).

```bash
bun add lottie-react
```

```tsx
import { NixmacMascotLottie } from "@/components/nixmac-mascot/NixmacMascotLottie";
<NixmacMascotLottie size={160} />          // speed={2.5} to surface the hop quickly
```

## Option B — SVG + CSS (lightest)

No animation runtime, ~250 KB smaller than shipping lottie-web, fully React-native.
Best if you only need it in this app and don't need the portable .json.

```tsx
import { NixmacMascot } from "@/components/nixmac-mascot/NixmacMascot";
<NixmacMascot size={160} />
```

## Tuning the motion

The animation *is* the design decision — both paths expose a "personality" block:

- **Lottie:** edit the `PERSONALITY` constants at the top of `build_lottie.py`
  (`LOOP_S` = hop cadence, `JUMP_HEIGHT`, `SPIN_DEG`, `SQUASH`/`STRETCH`, …), then
  regenerate (no system install — uv uses an ephemeral env):
  ```bash
  uv run --python 3.12 --with lottie python build_lottie.py
  ```
  Keep `SPIN_DEG` a multiple of 360 so he lands upright and the loop stays seamless.
- **CSS:** edit the custom properties in `nixmac-mascot.css` (incl. `--hop-period`).

Both read the same `nixmac-mascot.svg`, so re-rig there if you change geometry.

## Variants

- **Compressed `.lottie` (dotLottie):** `uvx --from lottie lottie_convert.py nixmac-mascot.json nixmac-mascot.lottie`, then render with [`@lottiefiles/dotlottie-react`](https://www.npmjs.com/package/@lottiefiles/dotlottie-react) (`<DotLottieReact src="/nixmac-mascot.lottie" />`). This player officially supports React 19 and adds theming/segments.
- **Interactive (hover/click/loading states):** rebuild in [Rive](https://rive.app) with a state machine and render via `@rive-app/react-canvas`. Import `nixmac-mascot.svg` to start.
