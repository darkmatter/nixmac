// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { ConfigDirBadge } from "./config-dir-badge";

const meta = preview.meta({
  title: "Widget/ConfigDirBadge",
  component: ConfigDirBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Default = meta.story({
  render: () => <ConfigDirBadge configDir="/Users/alice/.darwin" />,
});

export const CustomDir = meta.story({
  render: () => <ConfigDirBadge configDir="/Users/alice/nixos-config" />,
});

/** Shown inline in a sentence, as used in the privacy note */
export const InlineInText = meta.story({
  render: () => (
    <p className="text-muted-foreground text-xs flex items-center gap-1 flex-wrap">
      Content of <ConfigDirBadge configDir="/Users/alice/.darwin" /> may be seen by your AI provider.
    </p>
  ),
});
