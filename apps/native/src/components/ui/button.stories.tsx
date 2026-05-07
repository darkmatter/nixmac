// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Check, Download, Settings } from "lucide-react";
import { Button } from "./button";

const meta = preview.meta({
  title: "UI/Button",
  component: Button,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Variants = meta.story({
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
});

export const SizesAndIcons = meta.story({
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">
        <Check />
        Save
      </Button>
      <Button>
        <Download />
        Download
      </Button>
      <Button size="lg">Large Action</Button>
      <Button aria-label="Settings" size="icon" variant="outline">
        <Settings />
      </Button>
    </div>
  ),
});

export const Disabled = meta.story({
  render: () => (
    <div className="flex items-center gap-3">
      <Button disabled>Default</Button>
      <Button disabled variant="outline">
        Outline
      </Button>
    </div>
  ),
});
