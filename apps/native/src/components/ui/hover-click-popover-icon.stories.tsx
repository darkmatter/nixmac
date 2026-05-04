// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { AlertTriangle, Shield } from "lucide-react";
import { HoverClickPopoverIcon } from "./hover-click-popover-icon";

const meta = preview.meta({
  title: "UI/HoverClickPopoverIcon",
  component: HoverClickPopoverIcon,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

/** Default info icon with simple text content */
export const Default = meta.story({
  render: () => (
    <HoverClickPopoverIcon>
      <p>Hover or click to see this content.</p>
    </HoverClickPopoverIcon>
  ),
});

/** Custom icon */
export const CustomIcon = meta.story({
  render: () => (
    <HoverClickPopoverIcon icon={Shield}>
      <p className="font-medium mb-1">Privacy note</p>
      <p>Files listed in .gitignore are never touched by nixmac.</p>
    </HoverClickPopoverIcon>
  ),
});

/** Warning icon with richer content */
export const WithWarningIcon = meta.story({
  render: () => (
    <HoverClickPopoverIcon icon={AlertTriangle}>
      <p className="font-medium mb-1">Heads up</p>
      <p>This action cannot be undone. Make sure you have a backup.</p>
    </HoverClickPopoverIcon>
  ),
});

/** Shown inline next to text, as used in the directory picker */
export const InlineWithText = meta.story({
  render: () => (
    <p className="text-muted-foreground text-xs flex items-center gap-1">
      Content may be seen by your AI provider{" "}
      <HoverClickPopoverIcon>
        <p>Files listed in .gitignore are excluded from analysis and edits.</p>
      </HoverClickPopoverIcon>
    </p>
  ),
});
