// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useState } from "react";
import { HOSTS } from "./data";
import { HostsCombobox } from "./hosts-combobox";

const meta = preview.meta({
  title: "Widget/Filesystem/HostsCombobox",
  component: HostsCombobox,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const AllHosts = meta.story({
  render: () => {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(HOSTS.map((h) => h.id)));
    return <HostsCombobox hosts={HOSTS} selected={selected} setSelected={setSelected} />;
  },
});

export const JustThisMac = meta.story({
  render: () => {
    const cur = HOSTS.find((h) => h.current);
    const [selected, setSelected] = useState<Set<string>>(() => new Set(cur ? [cur.id] : []));
    return <HostsCombobox hosts={HOSTS} selected={selected} setSelected={setSelected} />;
  },
});

export const SubsetSelected = meta.story({
  render: () => {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(["fp26", "mini"]));
    return <HostsCombobox hosts={HOSTS} selected={selected} setSelected={setSelected} />;
  },
});

export const InlineVariant = meta.story({
  render: () => {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(HOSTS.map((h) => h.id)));
    return <HostsCombobox hosts={HOSTS} selected={selected} setSelected={setSelected} variant="inline" />;
  },
});
