// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type { Change, SemanticChangeMap } from "@/ipc/types";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { viewModelActions } from "@nixmac/state";
import { useEffect } from "react";
import { DriftReview } from "./drift-review";

// Mock Tauri API for Storybook (buildCheck etc. resolve to a no-op).
if (typeof window !== "undefined") {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      console.log("Mock Tauri invoke:", cmd);
      return null;
    },
  };
}

const meta = preview.meta({
  title: "Widget/Drift/DriftReview",
  component: DriftReview,
  parameters: { layout: "padded" },
});

export default meta;

// =============================================================================
// Mock data
// =============================================================================

function makeChange(id: number, filename: string, diff: string): Change {
  return {
    id,
    hash: `hash-${id}`,
    filename,
    diff,
    lineCount: diff.split("\n").length,
    createdAt: Date.now(),
    ownSummaryId: null as unknown as number,
  };
}

const EDITED_DIFF = `@@ -1,4 +1,6 @@
 { pkgs, ... }:
-  enable = false;
+  enable = true;
+  extraConfig = "fast";
 unchanged`;

const ADDED_DIFF = `@@ -0,0 +1,5 @@
+{ pkgs, ... }:
+{
+  imports = [ ];
+  system.stateVersion = 5;
+}`;

const REMOVED_DIFF = `@@ -1,3 +0,0 @@
-{ pkgs, ... }:
-  legacyOption = true;
-  retired = 1;`;

const driftChanges: Change[] = [
  makeChange(1, "hello", EDITED_DIFF),
  makeChange(2, "hosts/manual-new.nix", ADDED_DIFF),
  makeChange(3, "modules/home/shell.nix", REMOVED_DIFF),
];

const emptyChangeMap: SemanticChangeMap = {
  groups: [],
  singles: [],
  unsummarizedHashes: ["hash-1", "hash-2", "hash-3"],
};

const summarizedChangeMap: SemanticChangeMap = {
  groups: [],
  singles: [
    {
      hash: "hash-1",
      filename: "hello",
      title: "Changed an app's settings",
      description: "You enabled the “hello” app and switched it to fast mode.",
      status: "DONE",
    } as never,
    {
      hash: "hash-2",
      filename: "hosts/manual-new.nix",
      title: "Added a new machine setup",
      description: "A brand-new configuration named “manual-new” was created for this Mac.",
      status: "DONE",
    } as never,
  ],
  unsummarizedHashes: ["hash-3"],
};

// One group of three files → collapses to "hello, manual-new.nix, +1".
const groupedChangeMap: SemanticChangeMap = {
  groups: [
    {
      summary: {
        id: 1,
        title: "Switched the shell setup to a new host",
        description: "",
        status: "DONE",
        createdAt: 0,
      },
      changes: [
        { ...makeChange(1, "hello", EDITED_DIFF), title: "", description: "" },
        { ...makeChange(2, "hosts/manual-new.nix", ADDED_DIFF), title: "", description: "" },
        { ...makeChange(3, "modules/home/shell.nix", REMOVED_DIFF), title: "", description: "" },
      ] as never,
    },
  ],
  singles: [],
  unsummarizedHashes: [],
};

// An active AI session (evolutionId set) → DriftReview hides the drift banner
// and the adopt-into-AI affordances, and titles the card "Proposed changes".
const aiSession = {
  evolutionId: 1,
  currentChangesetId: 1,
  committable: false,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "evolve",
  lastEvolutionState: null,
} as never;

function setup({
  changes,
  changeMap,
  configDir = "/Users/user/darwin",
  evolve = null,
  rebuildNeeded = false,
}: {
  changes: Change[];
  changeMap: SemanticChangeMap;
  configDir?: string;
  evolve?: unknown;
  rebuildNeeded?: boolean;
}) {
  useEffect(() => {
    viewModelActions.setState({
      git: { files: [], branch: "main", diff: "", changes } as never,
      changeMap,
      preferences: makeGlobalPreferences({ configDir }),
      rebuildStatus: null,
      evolve: evolve as never,
      build: {
        externalBuildDetected: false,
        upstreamUpdateAvailable: false,
        rebuildNeeded,
      },
    });
  }, []);

  return (
    <div className="w-[640px]">
      <DriftReview />
    </div>
  );
}

// =============================================================================
// Stories
// =============================================================================

/**
 * Fresh drift with no AI summaries yet: the "Summary" view falls back to the
 * Analyze header + per-file rows; switch to "File changes" for the technical list.
 */
export const Unsummarized = meta.story({
  render: () => setup({ changes: driftChanges, changeMap: emptyChangeMap }),
});

/**
 * Drift after analysis: the "Summary" view renders the AI summaries.
 */
export const Summarized = meta.story({
  render: () => setup({ changes: driftChanges, changeMap: summarizedChangeMap }),
});

/**
 * A grouped summary: the three files collapse onto one line as
 * "hello, manual-new.nix, +1" with the summary beneath.
 */
export const Grouped = meta.story({
  render: () => setup({ changes: driftChanges, changeMap: groupedChangeMap }),
});

/**
 * Active AI session: same review card, but no drift banner and no
 * adopt-into-AI dropdown — the card reads "Proposed changes".
 */
export const AiSession = meta.story({
  render: () =>
    setup({ changes: driftChanges, changeMap: summarizedChangeMap, evolve: aiSession }),
});

/**
 * Saved configuration is newer than the running system, while the working
 * tree itself is clean. Only the explanation and applicable build action show.
 */
export const SavedUpdatesReady = meta.story({
  render: () =>
    setup({ changes: [], changeMap: emptyChangeMap, rebuildNeeded: true }),
});

/**
 * A single manual change — minimal state, singular copy in the banner.
 */
export const SingleChange = meta.story({
  render: () =>
    setup({
      changes: [makeChange(1, "flake.nix", EDITED_DIFF)],
      changeMap: { groups: [], singles: [], unsummarizedHashes: ["hash-1"] },
    }),
});
