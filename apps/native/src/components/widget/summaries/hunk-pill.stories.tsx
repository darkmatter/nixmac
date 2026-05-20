// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useWidgetStore } from "@/stores/widget-store";
import type { ChangeWithRichType } from "@/components/widget/utils";
import type { SemanticChangeMap } from "@/types/shared";
import { useEffect } from "react";
import { HunkPill } from "./hunk-pill";

const meta = preview.meta({
  title: "Widget/Summaries/HunkPill",
  component: HunkPill,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

function makeChange(overrides: Partial<ChangeWithRichType> & { diff: string }): ChangeWithRichType {
  return {
    id: 1,
    hash: "abc123",
    filename: "modules/darwin/packages.nix",
    lineCount: 4,
    createdAt: Date.now(),
    ownSummaryId: null,
    changeType: "edited",
    shortFilename: "packages.nix",
    ...overrides,
  };
}

const changeMap: SemanticChangeMap = {
  groups: [{
    summary: { id: 1, title: "Add system packages", description: "", status: "DONE", createdAt: 0 },
    changes: [{ hash: "with-summary", title: "Add vim and git", description: "", id: 1, filename: "", diff: "", lineCount: 0, createdAt: 0, ownSummaryId: null }],
  }],
  singles: [],
  unsummarizedHashes: [],
};

function WithStore({ change, map }: { change: ChangeWithRichType; map?: SemanticChangeMap }) {
  useEffect(() => {
    if (map) useWidgetStore.getState().setChangeMap(map);
  }, []);
  return <HunkPill change={change} onClick={() => {}} />;
}

export const AdditionsOnly = meta.story({
  render: () => (
    <WithStore change={makeChange({ diff: "@@ -1,3 +1,6 @@\n context\n+added1\n+added2\n+added3\n" })} />
  ),
});

export const DeletionsOnly = meta.story({
  render: () => (
    <WithStore change={makeChange({ diff: "@@ -1,6 +1,3 @@\n context\n-removed1\n-removed2\n-removed3\n" })} />
  ),
});

export const Mixed = meta.story({
  render: () => (
    <WithStore change={makeChange({ diff: "@@ -1,4 +1,5 @@\n context\n-old\n+new1\n+new2\n" })} />
  ),
});

export const WithSummaryTitle = meta.story({
  render: () => (
    <WithStore
      change={makeChange({ hash: "with-summary", diff: "@@ -1,3 +1,5 @@\n ctx\n+a\n+b\n" })}
      map={changeMap}
    />
  ),
});
