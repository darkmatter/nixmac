// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useWidgetStore } from "@/stores/widget-store";
import type React from "react";
import { useEffect } from "react";
import { SetupStep } from "./setup-step";

const meta = preview.meta({
  title: "Widget/Steps/SetupStep",
  component: SetupStep,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative m-2 h-[600px] w-[400px] overflow-hidden rounded-xl border border-border bg-background/90 p-4 shadow-2xl">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
});

export default meta;

function SetupStepStory({
  configDir = "",
  host = "",
  hosts,
}: {
  configDir?: string;
  host?: string;
  hosts?: string[];
}) {
  useEffect(() => {
    const store = useWidgetStore.getState();
    store.setConfigDir(configDir);
    store.setHost(host);
    store.setHosts(hosts ?? []);
    store.setBootstrapping(false);
    store.setError(null);
  }, [configDir, host, hosts]);

  return <SetupStep />;
}

export const Empty = meta.story({
  render: () => <SetupStepStory />,
});

export const DefaultDirectoryWithoutFlake = meta.story({
  render: () => <SetupStepStory configDir="/Users/demo/.darwin" />,
});
