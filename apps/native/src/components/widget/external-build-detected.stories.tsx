// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type { EvolveState } from "@/stores/widget-store";
import { useWidgetStore } from "@/stores/widget-store";
import { fn } from "@storybook/test";
import { useEffect } from "react";
import { ExternalBuildDetected } from "./external-build-detected";

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
  title: "Widget/ExternalBuildDetected",
  component: ExternalBuildDetected,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
});

export default meta;

// =============================================================================
// Helpers
// =============================================================================

const mockEvolveState: EvolveState = {
  evolutionId: 42,
  currentChangesetId: null,
  committable: false,
  backupBranch: null,
  step: "evolve",
};

function setup({
  externalBuildDetected,
  evolveState,
}: {
  externalBuildDetected: boolean;
  evolveState: EvolveState | null;
}) {
  useEffect(() => {
    const store = useWidgetStore.getState();
    store.setExternalBuildDetected(externalBuildDetected);
    store.setEvolveState(evolveState);
  }, [externalBuildDetected, evolveState]);

  return (
    <div className="w-[400px] border border-border rounded">
      <ExternalBuildDetected />
    </div>
  );
}

// =============================================================================
// Stories
// =============================================================================

/**
 * Default — banner is visible: external build detected during an active evolution.
 */
export const Visible = meta.story({
  render: () =>
    setup({ externalBuildDetected: true, evolveState: mockEvolveState }),
});

/**
 * Hidden — no external build detected, component renders nothing.
 */
export const HiddenNoBuild = meta.story({
  render: () =>
    setup({ externalBuildDetected: false, evolveState: mockEvolveState }),
});

/**
 * Hidden — external build detected but no active evolution, component renders nothing.
 */
export const HiddenNoEvolution = meta.story({
  render: () =>
    setup({ externalBuildDetected: true, evolveState: null }),
});
