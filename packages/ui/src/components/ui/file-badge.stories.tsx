// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FolderOpen, File, Lock, Shield } from "lucide-react";
import { FileBadge } from "./file-badge";

const meta = preview.meta({
  title: "UI/FileBadge",
  component: FileBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const WithFolderIcon = meta.story({
  render: () => <FileBadge icon={FolderOpen}>.darwin</FileBadge>,
});

export const WithFileIcon = meta.story({
  render: () => <FileBadge icon={File}>.gitignore</FileBadge>,
});

export const NoIcon = meta.story({
  render: () => <FileBadge>flake.nix</FileBadge>,
});

export const AllVariants = meta.story({
  render: () => (
    <div className="flex items-center gap-3">
      <FileBadge icon={FolderOpen}>.darwin</FileBadge>
      <FileBadge icon={File}>.gitignore</FileBadge>
      <FileBadge icon={Lock}>secrets</FileBadge>
      <FileBadge icon={Shield}>flake.nix</FileBadge>
      <FileBadge>result</FileBadge>
    </div>
  ),
});
