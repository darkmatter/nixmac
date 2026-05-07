// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FileText, History, Settings } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command";

const meta = preview.meta({
  title: "UI/Command",
  component: Command,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Palette = meta.story({
  render: () => (
    <Command className="w-[420px] rounded-lg border shadow-md">
      <CommandInput placeholder="Search nixmac actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem>
            <Settings />
            Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <History />
            History
            <CommandShortcut>⌘H</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Files">
          <CommandItem>
            <FileText />
            flake.nix
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
});
