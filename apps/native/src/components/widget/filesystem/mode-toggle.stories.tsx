// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useState } from "react";
import { ModeToggle, type FsMode } from "./mode-toggle";

const meta = preview.meta({
  title: "Widget/Filesystem/ModeToggle",
  component: ModeToggle,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Plain = meta.story({
  render: () => {
    const [mode, setMode] = useState<FsMode>("plain");
    return <ModeToggle mode={mode} setMode={setMode} />;
  },
});

export const Nix = meta.story({
  render: () => {
    const [mode, setMode] = useState<FsMode>("nix");
    return <ModeToggle mode={mode} setMode={setMode} />;
  },
});
