// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Search, SlidersHorizontal } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";

const meta = preview.meta({
  title: "UI/InputGroup",
  component: InputGroup,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const InlineAddons = meta.story({
  render: () => (
    <div className="w-[420px] space-y-4">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search packages" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Filter" size="icon-xs">
            <SlidersHorizontal />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>Host</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput defaultValue="Farhans-MacBook-Pro" />
      </InputGroup>
    </div>
  ),
});

export const BlockAddons = meta.story({
  render: () => (
    <InputGroup className="w-[420px]">
      <InputGroupAddon align="block-start">
        <InputGroupText>Change request</InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea defaultValue="Install ripgrep and enable Touch ID sudo." rows={4} />
    </InputGroup>
  ),
});
