// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Info } from "lucide-react";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const meta = preview.meta({
  title: "UI/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Open = meta.story({
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button aria-label="More info" size="icon" variant="outline">
          <Info />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">API calls before stopping.</TooltipContent>
    </Tooltip>
  ),
});
