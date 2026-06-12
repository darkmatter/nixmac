// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import preview from "#storybook/preview";
import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import type React from "react";
import { useEffect } from "react";
import { DeveloperTab } from "@/components/widget/settings/developer-tab";

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
        useViewModel.setState({ preferences: makeGlobalPreferences({ developerMode: true, pinnedVersion: null, updateChannel: "stable" }) });
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
        useViewModel.setState({ preferences: makeGlobalPreferences({ developerMode: true, pinnedVersion: "0.21.0", updateChannel: "develop" }) });
      }, []);
      return <Story />;
    },
  ],
});
