// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const meta = preview.meta({
  title: "UI/Popover",
  component: Popover,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Open = meta.story({
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">Open details</Button>
      </PopoverTrigger>
      <PopoverContent className="space-y-2">
        <p className="font-medium text-sm">Build gate</p>
        <p className="text-muted-foreground text-sm">
          The native lane waits for a successful app artifact before touching the remote Mac.
        </p>
      </PopoverContent>
    </Popover>
  ),
});
