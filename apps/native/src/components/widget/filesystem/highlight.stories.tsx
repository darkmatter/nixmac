// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { highlightNix, highlightNixLine } from "./highlight";

// `highlight` exports pure functions; the Storybook stories render a small
// host component so the syntax highlighting is visible.
function HighlightDemo({ src }: { src: string }) {
  return (
    <pre className="m-0 whitespace-pre rounded-md border border-border bg-card p-4 font-mono text-[12px] leading-[1.6]">
      {highlightNix(src)}
    </pre>
  );
}

function HighlightLineDemo({ line }: { line: string }) {
  return (
    <code className="rounded-md border border-border bg-card px-3 py-2 font-mono text-[12px]">
      {highlightNixLine(line)}
    </code>
  );
}

const meta = preview.meta({
  title: "Widget/Filesystem/Highlight",
  component: HighlightDemo,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

export const FlakeNix = meta.story({
  render: () => (
    <HighlightDemo
      src={`{
  description = "Farhan's nix-darwin systems";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = inputs@{ nix-darwin, ... }: {
    darwinConfigurations."Farhans-MacBook-Pro-26" =
      nix-darwin.lib.darwinSystem {
        modules = [
          ./modules/darwin/packages.nix
          ./modules/darwin/homebrew.nix    # casks, taps, formulae
        ];
      };
  };
}`}
    />
  ),
});

export const HomebrewModule = meta.story({
  render: () => (
    <HighlightDemo
      src={`{
  homebrew = {
    enable = true;
    onActivation.cleanup = "zap";
    casks = [
      "rectangle"
      "1password"
    ];
  };
}`}
    />
  ),
});

export const SingleAttrLine = meta.story({
  render: () => <HighlightLineDemo line='homebrew.casks = [ "docker" ];' />,
});
