// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type { FileDiffContents } from "@/types/shared";
import { FileView } from "./file-view";

const meta = preview.meta({
  title: "Widget/Summaries/FileView",
  component: FileView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const NIX_CONTENT = `{ config, pkgs, ... }:

{
  fonts.packages = with pkgs; [
    jetbrains-mono
  ];
}`;

const JSON_CONTENT = `{
  "editor.fontSize": 13,
  "editor.tabSize": 2,
  "editor.formatOnSave": true
}`;

export const NewNixFile = meta.story({
  render: () => (
    <div className="w-[560px]">
      <FileView
        contents={{ original: "", modified: NIX_CONTENT }}
        filename="modules/darwin/fonts.nix"
        changeType="new"
      />
    </div>
  ),
});

export const NewJsonFile = meta.story({
  render: () => (
    <div className="w-[560px]">
      <FileView
        contents={{ original: "", modified: JSON_CONTENT }}
        filename=".vscode/settings.json"
        changeType="new"
      />
    </div>
  ),
});

export const RemovedNixFile = meta.story({
  render: () => (
    <div className="w-[560px]">
      <FileView
        contents={{ original: NIX_CONTENT, modified: "" }}
        filename="modules/home/old-shell.nix"
        changeType="removed"
      />
    </div>
  ),
});
