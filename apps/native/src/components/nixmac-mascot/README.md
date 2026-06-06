# nixmac mascot — animated

An idle animation of the nixmac face (blink · smile breathe · circuit pulse) plus
an intermittent **hop + spin**, built from the brand mark. Three render paths.

```
nixmac-mascot.svg          ← source of truth: logo.svg re-rigged, one <g id> per feature
build_lottie.py            ← SVG → Lottie generator (tune the motion here)
nixmac-mascot.json         ← generated, portable Lottie (committed)
NixmacMascotLottie.tsx     ← React: real Lottie  (needs `lottie-react`)
NixmacMascot.tsx           ← React: pure SVG+CSS (zero deps; 2D hop + Z-spin)
nixmac-mascot.css          ← the CSS-path animation
NixmacMascotCube.tsx       ← React: CSS 3D cube — hops + Y-axis spin, real back face
nixmac-mascot-cube.css     ← the cube's 3D animation
nixmac-mascot-back.svg     ← the cube's device-style back face
nixmac-mascot.stories.tsx  ← Storybook (Brand/Nixmac Mascot)
```

## Option A — real Lottie (portable, 2D)

Plays anywhere Lottie does (web, iOS, Android, LottieFiles). 2D: hop + in-plane spin.

```bash
bun add lottie-react
```

```tsx
import { NixmacMascotLottie } from "@/components/nixmac-mascot/NixmacMascotLottie";
<NixmacMascotLottie size={160} />; // speed={2.5} to surface the hop quickly
```

## Option B — SVG + CSS (lightest, 2D)

No animation runtime, ~250 KB smaller than lottie-web. Same hop + Z-spin as the Lottie.

```tsx
import { NixmacMascot } from "@/components/nixmac-mascot/NixmacMascot";
<NixmacMascot size={160} />;
```

## Option C — CSS 3D cube (true 3D)

A real cube (`perspective` + `preserve-3d`). Hops and turns on its **Y axis** to
reveal a device-style back face + the dark side edges. Front face is the animated
mascot. Not Lottie — Lottie is 2D and can't represent a cube.

```tsx
import { NixmacMascotCube } from "@/components/nixmac-mascot/NixmacMascotCube";
<NixmacMascotCube size={200} />;
```

## Tuning the motion

- **Lottie:** edit `PERSONALITY` in `build_lottie.py` (`LOOP_S`, `JUMP_HEIGHT`,
  `SPIN_DEG`, …), then `uv run --python 3.12 --with lottie python build_lottie.py`.
  Keep `SPIN_DEG` a multiple of 360 so the loop stays seamless.
- **CSS / cube:** edit the custom properties + `@keyframes` in `nixmac-mascot.css`
  / `nixmac-mascot-cube.css` (`--hop-period`, the cube's back/side colours, etc.).

All paths read the same `nixmac-mascot.svg`, so re-rig geometry there.

## Heavier alternative

For real lighting / materials / perspective beyond flat faces, rebuild in
[React Three Fiber](https://r3f.docs.pmnd.rs) (`three` + `@react-three/fiber`) and
load a GLB. Bigger dependency; only worth it if you want shading, not flat faces.
