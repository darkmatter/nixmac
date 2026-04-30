// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { GitignoreBadge } from "./gitignore-badge";

const meta = preview.meta({
  title: "Widget/GitignoreBadge",
  component: GitignoreBadge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Default = meta.story({
  render: () => <GitignoreBadge />,
});

/** Shown inline in a sentence, as used in the privacy note */
export const InlineInText = meta.story({
  render: () => (
    <p className="text-muted-foreground text-xs flex items-center gap-1 flex-wrap">
      Add sensitive files to <GitignoreBadge /> to exclude them from analysis.
    </p>
  ),
});
