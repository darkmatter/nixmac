// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import { fn } from "@storybook/test";
import preview from "#storybook/preview";
import { BackupNotificationScreen } from "./backup-notification-screen";

const meta = preview.meta({
  title: "Onboarding/BackupNotificationScreen",
  component: BackupNotificationScreen,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    compact: {
      control: "boolean",
      description:
        "When true, renders a compact version suitable for embedding in a widget",
    },
  },
});

export default meta;

export const Default = meta.story({
  args: {
    onComplete: fn(),
  },
});

export const Compact = meta.story({
  args: {
    compact: true,
    onComplete: fn(),
  },
});
