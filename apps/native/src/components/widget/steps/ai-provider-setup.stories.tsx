// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { tauriAPI } from "@/ipc/api";
import { useWidgetStore } from "@/stores/widget-store";
import type React from "react";
import { useEffect } from "react";
import { AiProviderSetup } from "./ai-provider-setup";

const meta = preview.meta({
  title: "Widget/Steps/AiProviderSetup",
  component: AiProviderSetup,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="w-[400px] rounded-xl border border-border bg-background p-4 shadow-2xl">
        <Story />
      </div>
    ),
  ],
});

export default meta;

function installAiProviderMocks() {
  tauriAPI.cli.checkTools = async () => ({
    claude: true,
    codex: true,
    opencode: false,
  });
  tauriAPI.ui.getPrefs = async () => ({
    openrouterApiKey: "",
    openaiApiKey: "",
    vllmApiBaseUrl: "",
    vllmApiKey: "",
    evolveProvider: "",
    evolveModel: "",
    summaryProvider: "",
    summaryModel: "",
    aiProviderOnboardingComplete: false,
    aiProviderOnboardingSkipped: false,
    developerMode: false,
  });
  tauriAPI.ui.setPrefs = async () => ({ ok: true });
}

function AiProviderSetupStory() {
  installAiProviderMocks();

  useEffect(() => {
    const store = useWidgetStore.getState();
    store.setSettingsOpen(false);
    store.setAiProviderOnboardingComplete(false);
  }, []);

  return <AiProviderSetup />;
}

export const Default = meta.story({
  render: () => <AiProviderSetupStory />,
});
