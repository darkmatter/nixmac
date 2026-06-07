// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { NixmacMascot } from "./NixmacMascot";
import { NixmacMascotLottie } from "./NixmacMascotLottie";

const meta = preview.meta({
  title: "Brand/Nixmac Mascot",
  component: NixmacMascotLottie,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: { control: { type: "range", min: 48, max: 320, step: 8 } },
    loop: { control: "boolean" },
    autoplay: { control: "boolean" },
    speed: { control: { type: "range", min: 0.25, max: 4, step: 0.25 } },
  },
  args: { size: 200, loop: true, autoplay: true },
});

export default meta;

/** The portable Lottie (nixmac-mascot.json) playing through lottie-web. */
export const Lottie = meta.story({});

/**
 * The intermittent hop + 360° spin. Sped up 2.5× here so it's easy to catch —
 * the default loop fires the hop about once every 8 seconds.
 */
export const HopAndSpin = meta.story({
  name: "Hop & Spin",
  args: { size: 220, speed: 2.5 },
});

/** Renders crisply at any size — it's vector all the way down. */
export const Sizes = meta.story({
  render: () => (
    <div className="flex items-end gap-8">
      {[48, 96, 160, 240].map((s) => (
        <div key={s} className="flex flex-col items-center gap-2">
          <NixmacMascotLottie size={s} />
          <span className="text-xs text-zinc-400">{s}px</span>
        </div>
      ))}
    </div>
  ),
});

/**
 * Same source SVG, two render paths. Left ships a portable `.json` (plays on
 * web/iOS/Android); right is pure SVG+CSS (no runtime, ~250 KB smaller).
 */
export const LottieVsCss = meta.story({
  render: () => (
    <div className="flex items-center gap-12">
      <div className="flex flex-col items-center gap-2">
        <NixmacMascotLottie size={160} />
        <span className="text-xs text-zinc-400">Lottie (.json)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <NixmacMascot size={160} />
        <span className="text-xs text-zinc-400">SVG + CSS</span>
      </div>
    </div>
  ),
});
