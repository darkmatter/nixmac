// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import type React from "react";
import { useEffect } from "react";
import { SetupStep } from "./setup-step";

const meta = preview.meta({
  title: "Widget/Steps/SetupStep",
  component: SetupStep,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative m-2 h-[760px] w-[400px] overflow-auto rounded-xl border border-border bg-background shadow-2xl">
        <Story />
      </div>
    ),
  ],
});

export default meta;

function installSetupMocks() {
  if (typeof window === "undefined") return;

  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "path_normalize") {
        const input = String(args?.input ?? "");
        return input.startsWith("~/") ? `/Users/demo/${input.slice(2)}` : input;
      }

      if (cmd === "config_prepare_new_dir") {
        return {
          dir: String(args?.dir ?? "/Users/demo/.darwin"),
          evolveState: null,
          hosts: [],
        };
      }

      if (cmd === "flake_exists_at" || cmd === "flake_exists") {
        return false;
      }

      if (cmd === "path_exists") {
        return true;
      }

      if (cmd === "config_set_host_attr" || cmd === "bootstrap_default_config") {
        return { ok: true };
      }

      return null;
    },
  };
}

type SetupStoryProps = {
  configDir: string;
  hosts: string[];
  host?: string;
};

function SetupStory({ configDir, hosts, host = "" }: SetupStoryProps) {
  installSetupMocks();

  useEffect(() => {
    useViewModel.setState({
      preferences: makeGlobalPreferences({ configDir, hostAttr: host }),
      hosts,
    });
    useUiState.getState().setBootstrapping(false);
    useUiState.getState().setError(null);
  }, [configDir, host, hosts]);

  return <SetupStep />;
}

export const DefaultConfigRequired = meta.story({
  render: () => (
    <SetupStory
      configDir="/Users/demo/.darwin"
      hosts={[]}
    />
  ),
});
