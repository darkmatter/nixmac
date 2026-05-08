// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useState } from "react";
import { FILES, SECTIONS, type SectionId } from "./data";
import { SectionTabs } from "./section-tabs";

const meta = preview.meta({
  title: "Widget/Filesystem/SectionTabs",
  component: SectionTabs,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

export const SystemActive = meta.story({
  render: () => {
    const [active, setActive] = useState<SectionId>("darwin");
    return (
      <div className="w-[660px]">
        <SectionTabs sections={SECTIONS} active={active} setActive={setActive} files={FILES} />
      </div>
    );
  },
});

export const UntrackedActive = meta.story({
  render: () => {
    const [active, setActive] = useState<SectionId>("manage");
    return (
      <div className="w-[660px]">
        <SectionTabs sections={SECTIONS} active={active} setActive={setActive} files={FILES} />
      </div>
    );
  },
});
