// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import preview from "#storybook/preview";
import { DeveloperTab } from "@/components/widget/settings/developer-tab";
import { usePrefStore } from "@/stores/pref-store";
import type React from "react";
import { useEffect } from "react";

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
export const Unpinned = meta.story({
  decorators: [
    (Story: React.ComponentType) => {
      useEffect(() => {
        usePrefStore.setState({
          developerMode: true,
          pinnedVersion: null,
          updateChannel: "stable",
        });
      }, []);
      return <Story />;
    },
  ],
});

/** A past release is pinned — silent auto-update is suppressed; "Resume auto-update" appears. */
export const PinnedToPastVersion = meta.story({
  decorators: [
    (Story: React.ComponentType) => {
      useEffect(() => {
        usePrefStore.setState({
          developerMode: true,
          pinnedVersion: "0.21.0",
          updateChannel: "develop",
        });
      }, []);
      return <Story />;
    },
  ],
});
