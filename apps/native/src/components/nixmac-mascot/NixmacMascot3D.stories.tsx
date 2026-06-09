// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { NixmacMascot3D } from "./NixmacMascot3D";

const meta = preview.meta({
  title: "Brand/Nixmac Mascot/3D Indicator",
  component: NixmacMascot3D,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    size: { control: { type: "range", min: 48, max: 320, step: 8 } },
    spinning: { control: "boolean" },
  },
  args: { size: 200, spinning: true },
});

export default meta;

export const Spinning = meta.story({});

export const Static = meta.story({
  args: { spinning: false },
});
