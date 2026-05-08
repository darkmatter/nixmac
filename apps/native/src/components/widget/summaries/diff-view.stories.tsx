// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type { FileDiffContents } from "@/types/shared";
import { DiffView } from "./diff-view";

const meta = preview.meta({
  title: "Widget/Summaries/DiffView",
  component: DiffView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const ORIGINAL = `{ config, pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    vim
    git
  ];
}`;

const MODIFIED = `{ config, pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    vim
    git
    ripgrep
    fd
    jq
  ];
}`;

const mockContents: FileDiffContents = {
  original: ORIGINAL,
  modified: MODIFIED,
};

export const Default = meta.story({
  render: () => (
    <div className="w-[560px]">
      <DiffView contents={mockContents} filename="configuration.nix" onMount={() => {}} />
    </div>
  ),
});

export const Identical = meta.story({
  render: () => (
    <div className="w-[560px]">
      <DiffView
        contents={{ original: ORIGINAL, modified: ORIGINAL }}
        filename="configuration.nix"
        onMount={() => {}}
      />
    </div>
  ),
});
