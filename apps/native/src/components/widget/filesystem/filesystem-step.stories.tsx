// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type React from "react";
import { FilesystemStep } from "./filesystem-step";
import { SeedDisplay } from "./seed-display";

const meta = preview.meta({
  title: "Widget/Filesystem/FilesystemStep",
  component: FilesystemStep,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
});

export default meta;

const widgetFrame =
  "relative m-2 h-[640px] w-[800px] overflow-hidden rounded-xl border border-border shadow-2xl bg-background";

/**
 * Full Filesystem step inside a widget-shaped frame. Click any "Edit
 * with a prompt" / "Track these" button — the seed that would land in
 * the prompt textarea appears in the side panel. This story is enough
 * to exercise the entire UX without running the live app.
 */
export const Default = meta.story({
  render: () => (
    <SeedDisplay title="Seed pushed to PromptInput · BeginStep would open next">
      {(push) => (
        <div className={widgetFrame}>
          <FilesystemStep onSeedPrompt={push} />
        </div>
      )}
    </SeedDisplay>
  ),
});

/** Standalone — no seed-display panel, useful for visual regression / layout review. */
export const Standalone = meta.story({
  decorators: [
    (Story: React.ComponentType) => (
      <div className={widgetFrame}>
        <Story />
      </div>
    ),
  ],
  render: () => <FilesystemStep onSeedPrompt={() => undefined} />,
});

/** Tight, mobile-ish width to verify the row layout doesn't break. */
export const NarrowWidget = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="relative m-2 h-[640px] w-[420px] overflow-hidden rounded-xl border border-border shadow-2xl bg-background">
          <FilesystemStep onSeedPrompt={push} />
        </div>
      )}
    </SeedDisplay>
  ),
});
