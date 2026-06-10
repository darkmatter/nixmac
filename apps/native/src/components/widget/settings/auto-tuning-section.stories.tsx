// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)

import preview from "#storybook/preview";
import { AutoTuningSection } from "@/components/widget/settings/auto-tuning-section";
import { tauriAPI } from "@/ipc/api";
import type { ConfigurableSnapshot } from "@/ipc/types";
import { waitFor, within } from "storybook/test";

const snapshots: ConfigurableSnapshot[] = [
  {
    schema: {
      name: "EvolutionLimits",
      displayName: "Evolution",
      description: "How long the agent will try before giving up.",
      fields: [
        {
          key: "maxTokenBudget",
          label: "Max token budget",
          help: "Provider-reported tokens before the agent stops. Lower is faster but may not finish complex changes.",
          ty: { kind: "number", min: 1000, max: 1000000, step: 1000 },
          default: 50000,
        },
        {
          key: "maxBuildAttempts",
          label: "Max build attempts",
          help: "Failed builds before giving up on a run.",
          ty: { kind: "number", min: 1, max: 20, step: 1 },
          default: 5,
        },
      ],
    },
    values: [
      { key: "maxTokenBudget", current: 50000 },
      { key: "maxBuildAttempts", current: 5 },
    ],
  },
];

function installDevConfigMock(next: ConfigurableSnapshot[] | Error) {
  tauriAPI.devConfigs = {
    list: async () => {
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    set: async () => undefined,
  };
}

const meta = preview.meta({
  title: "Settings/AutoTuningSection",
  component: AutoTuningSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
});

export default meta;

export const EvolutionSettings = meta.story({
  decorators: [
    (Story) => {
      installDevConfigMock(snapshots);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByLabelText("Max token budget"));
  },
});

export const LoadError = meta.story({
  decorators: [
    (Story) => {
      installDevConfigMock(new Error("Config registry unavailable"));
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText(/Failed to load settings schema/));
  },
});
