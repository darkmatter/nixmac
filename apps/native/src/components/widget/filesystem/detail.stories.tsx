// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useState } from "react";
import { FILES } from "./data";
import { Detail } from "./detail";
import type { FsMode } from "./mode-toggle";

const meta = preview.meta({
  title: "Widget/Filesystem/Detail",
  component: Detail,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const wrap = (child: React.ReactNode) => (
  <div className="h-[520px] w-[660px] border border-border">{child}</div>
);

export const PlainToggles = meta.story({
  render: () => {
    const file = FILES.darwin.find((f) => f.id === "defaults");
    const [mode, setMode] = useState<FsMode>("plain");
    return wrap(<Detail file={file} mode={mode} setMode={setMode} />);
  },
});

export const PlainList = meta.story({
  render: () => {
    const file = FILES.darwin.find((f) => f.id === "homebrew");
    const [mode, setMode] = useState<FsMode>("plain");
    return wrap(<Detail file={file} mode={mode} setMode={setMode} />);
  },
});

export const PlainSummary = meta.story({
  render: () => {
    const file = FILES.home.find((f) => f.id === "dotfiles");
    const [mode, setMode] = useState<FsMode>("plain");
    return wrap(<Detail file={file} mode={mode} setMode={setMode} />);
  },
});

export const NixSource = meta.story({
  render: () => {
    const file = FILES.entry.find((f) => f.id === "flake");
    const [mode, setMode] = useState<FsMode>("nix");
    return wrap(<Detail file={file} mode={mode} setMode={setMode} />);
  },
});

export const UntrackedCandidatePlain = meta.story({
  render: () => {
    const file = FILES.manage.find((f) => f.id === "untracked-brew");
    const [mode, setMode] = useState<FsMode>("plain");
    return wrap(<Detail file={file} mode={mode} setMode={setMode} />);
  },
});

export const UntrackedCandidateNix = meta.story({
  render: () => {
    const file = FILES.manage.find((f) => f.id === "untracked-brew");
    const [mode, setMode] = useState<FsMode>("nix");
    return wrap(<Detail file={file} mode={mode} setMode={setMode} />);
  },
});
