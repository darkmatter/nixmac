// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useWidgetStore } from "@/stores/widget-store";
import type { ChangeWithRichType } from "@/components/widget/utils";
import type { SemanticChangeMap } from "@/types/shared";
import { useEffect } from "react";
import { UnsummarizedChangesSection } from "./unsummarized-changes-section";

// Mock Tauri API for Storybook
if (typeof window !== "undefined") {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      console.log("Mock Tauri invoke:", cmd);
      return null;
    },
  };
}

const meta = preview.meta({
  title: "Widget/Summaries/UnsummarizedChangesSection",
  component: UnsummarizedChangesSection,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

// =============================================================================
// Mock data
// =============================================================================

function makeChange(
  id: number,
  filename: string,
  changeType: ChangeWithRichType["changeType"],
  oldFilename?: string,
): ChangeWithRichType {
  return {
    id,
    hash: `hash${id}`,
    filename,
    diff: "",
    lineCount: 4,
    createdAt: Date.now(),
    ownSummaryId: null,
    changeType,
    shortFilename: filename.split("/").at(-1) ?? filename,
    oldFilename,
  };
}

const mixedChanges: ChangeWithRichType[] = [
  makeChange(1, "modules/darwin/packages.nix", "edited"),
  makeChange(2, "modules/darwin/fonts.nix", "new"),
  makeChange(3, "modules/home/shell.nix", "removed"),
  makeChange(4, "modules/darwin/terminal.nix", "edited"),
];

const withRenameChanges: ChangeWithRichType[] = [
  makeChange(1, "modules/darwin/packages.nix", "edited"),
  makeChange(2, "modules/darwin/brew.nix", "renamed", "modules/darwin/homebrew.nix"),
  makeChange(3, "home.nix", "new"),
];

const emptyChangeMap: SemanticChangeMap = {
  groups: [],
  singles: [],
  unsummarizedHashes: ["hash1", "hash2", "hash3"],
};

const partialChangeMap: SemanticChangeMap = {
  groups: [{ summary: { id: 1, title: "Add fonts", description: "", status: "DONE", createdAt: 0 }, changes: [] as any }],
  singles: [],
  unsummarizedHashes: ["hash1"],
};

// =============================================================================
// Setup helper
// =============================================================================

function setup({
  changes,
  changeMap,
  configDir = "/Users/user/.config/nixpkgs",
}: {
  changes: ChangeWithRichType[];
  changeMap: SemanticChangeMap;
  configDir?: string;
}) {
  useEffect(() => {
    const store = useWidgetStore.getState();
    store.setChangeMap(changeMap);
    store.setConfigDir(configDir);
  }, []);

  return (
    <div className="w-[480px] rounded border border-border bg-background">
      <UnsummarizedChangesSection changes={changes} />
    </div>
  );
}

// =============================================================================
// Stories
// =============================================================================

/**
 * Mixed change types — no prior summaries ("Manual Changes found in").
 */
export const OnlyUnsummarized = meta.story({
  render: () => setup({ changes: mixedChanges, changeMap: emptyChangeMap }),
});

/**
 * Mixed types alongside existing summaries — header says "Also in".
 */
export const AlsoUnsummarized = meta.story({
  render: () => setup({ changes: mixedChanges, changeMap: partialChangeMap }),
});

/**
 * Includes a renamed file shown with old → new path arrow.
 */
export const WithRename = meta.story({
  render: () => setup({ changes: withRenameChanges, changeMap: emptyChangeMap }),
});

/**
 * Single change — minimal state.
 */
export const Single = meta.story({
  render: () =>
    setup({
      changes: [makeChange(1, "flake.nix", "edited")],
      changeMap: { ...emptyChangeMap, unsummarizedHashes: ["hash1"] },
    }),
});
