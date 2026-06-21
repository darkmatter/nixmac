// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type { ChangeWithRichType } from "@/components/widget/utils";
import { CollapsibleDiff } from "./collapsible-diff";

const meta = preview.meta({
  title: "Widget/Summaries/CollapsibleDiff",
  component: CollapsibleDiff,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

function makeChange(
  changeType: ChangeWithRichType["changeType"],
  filename: string,
): ChangeWithRichType {
  return {
    id: 1,
    hash: "abc123",
    filename,
    diff: "",
    lineCount: 4,
    createdAt: Date.now(),
    ownSummaryId: null,
    changeType,
    shortFilename: filename.split("/").pop() ?? filename,
  };
}

export const CollapsedEdited = meta.story({
  render: () => (
    <div className="w-[480px]">
      <CollapsibleDiff change={makeChange("edited", "modules/darwin/packages.nix")}>
        <div className="p-4 text-muted-foreground text-xs">Diff content here</div>
      </CollapsibleDiff>
    </div>
  ),
});

export const OpenNew = meta.story({
  render: () => (
    <div className="w-[480px]">
      <CollapsibleDiff change={makeChange("new", "modules/darwin/fonts.nix")} defaultOpen>
        <div className="p-4 text-muted-foreground text-xs">Diff content here</div>
      </CollapsibleDiff>
    </div>
  ),
});

export const Removed = meta.story({
  render: () => (
    <div className="w-[480px]">
      <CollapsibleDiff change={makeChange("removed", "modules/home/old-shell.nix")}>
        <div className="p-4 text-muted-foreground text-xs">Diff content here</div>
      </CollapsibleDiff>
    </div>
  ),
});

export const Renamed = meta.story({
  render: () => (
    <div className="w-[480px]">
      <CollapsibleDiff
        change={{
          ...makeChange("renamed", "modules/darwin/brew.nix"),
          oldFilename: "modules/darwin/homebrew.nix",
        }}
      >
        <div className="p-4 text-muted-foreground text-xs">Diff content here</div>
      </CollapsibleDiff>
    </div>
  ),
});

export const WithHeaderExtra = meta.story({
  render: () => (
    <div className="w-[480px]">
      <CollapsibleDiff
        change={makeChange("edited", "modules/darwin/packages.nix")}
        defaultOpen
        headerExtra={
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            +3 -1
          </span>
        }
      >
        <div className="p-4 text-muted-foreground text-xs">Diff content here</div>
      </CollapsibleDiff>
    </div>
  ),
});
