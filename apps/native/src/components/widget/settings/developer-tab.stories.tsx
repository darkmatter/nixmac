// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import preview from "#storybook/preview";
import { useWidgetStore } from "@/stores/widget-store";
import type React from "react";
import { useEffect } from "react";
import { DeveloperTab } from "./developer-tab";

const meta = preview.meta({
  title: "Settings/DeveloperTab",
  component: DeveloperTab,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
});

export default meta;

/** Default state — developer mode on, no version pinned. */
export const Unpinned = {
  decorators: [
    (Story: React.ComponentType) => {
      useEffect(() => {
        useWidgetStore.setState({ developerMode: true, pinnedVersion: null });
      }, []);
      return <Story />;
    },
  ],
};

/** A past release is pinned — silent auto-update is suppressed; "Resume auto-update" appears. */
export const PinnedToPastVersion = {
  decorators: [
    (Story: React.ComponentType) => {
      useEffect(() => {
        useWidgetStore.setState({ developerMode: true, pinnedVersion: "0.21.0" });
      }, []);
      return <Story />;
    },
  ],
};
