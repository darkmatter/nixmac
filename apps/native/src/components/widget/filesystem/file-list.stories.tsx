// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useState } from "react";
import { FILES } from "./data";
import { FileList } from "./file-list";

const meta = preview.meta({
  title: "Widget/Filesystem/FileList",
  component: FileList,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

export const DarwinSection = meta.story({
  render: () => {
    const files = FILES.darwin;
    const [selectedId, setSelectedId] = useState(files[0]?.id);
    return (
      <div className="h-[480px] w-[280px] border border-border">
        <FileList files={files} selectedId={selectedId} setSelected={setSelectedId} mode="plain" />
      </div>
    );
  },
});

export const NixMode = meta.story({
  render: () => {
    const files = FILES.darwin;
    const [selectedId, setSelectedId] = useState(files[0]?.id);
    return (
      <div className="h-[480px] w-[280px] border border-border">
        <FileList files={files} selectedId={selectedId} setSelected={setSelectedId} mode="nix" />
      </div>
    );
  },
});

export const UntrackedSection = meta.story({
  render: () => {
    const files = FILES.manage;
    const [selectedId, setSelectedId] = useState(files[0]?.id);
    return (
      <div className="h-[480px] w-[280px] border border-border">
        <FileList files={files} selectedId={selectedId} setSelected={setSelectedId} mode="plain" />
      </div>
    );
  },
});
