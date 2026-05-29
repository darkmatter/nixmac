// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import type { ChangeWithRichType } from "@/components/widget/utils";
import type { SemanticChangeMap } from "@/ipc/types";
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

const repeatedHunkChanges: ChangeWithRichType[] = [
  ...Array.from({ length: 18 }, (_, i) =>
    makeChange(i + 1, "flake.lock", i % 5 === 0 ? "removed" : "edited"),
  ),
  makeChange(19, "hosts/common/home.nix", "edited"),
  makeChange(20, "flake.nix", "new"),
  makeChange(21, "lib/mkHost.nix", "new"),
  makeChange(22, "files/config/zed/settings.json", "edited"),
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

const repeatedHunkChangeMap: SemanticChangeMap = {
  groups: [],
  singles: [],
  unsummarizedHashes: repeatedHunkChanges.map((change) => change.hash),
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
    useViewModel.setState({ changeMap });
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
 * Regression case for Review screens where one file has many diff hunks.
 * The file should render once with an x18 badge, not flood the panel.
 */
export const RepeatedFileHunks = meta.story({
  render: () =>
    setup({
      changes: repeatedHunkChanges,
      changeMap: repeatedHunkChangeMap,
      configDir: "/Users/user/darwin",
    }),
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
