// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { ScrollArea } from "./scroll-area";

const meta = preview.meta({
  title: "UI/ScrollArea",
  component: ScrollArea,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

const files = [
  "flake.nix",
  "darwin-configuration.nix",
  "homebrew.nix",
  "modules/security.nix",
  "modules/packages.nix",
  "modules/development.nix",
  "modules/fonts.nix",
  "modules/system-defaults.nix",
  "secrets/example.age",
  "README.md",
];

export const VerticalList = meta.story({
  render: () => (
    <ScrollArea className="h-56 w-72 rounded-md border">
      <div className="p-3">
        {files.map((file) => (
          <div className="border-b py-2 text-sm last:border-b-0" key={file}>
            {file}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
});
