// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type React from "react";
import { FilesystemStep } from "./filesystem-step";

const meta = preview.meta({
  title: "Widget/Filesystem/FilesystemStep",
  component: FilesystemStep,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative m-2 h-[640px] w-[800px] overflow-hidden rounded-xl border border-border shadow-2xl">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
});

export default meta;

export const Default = meta.story({
  render: () => <FilesystemStep />,
});
