import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { useWidgetStore } from "@/stores/widget-store";
import { EditorPanel } from "./editor-panel";

function EditorPanelWithState({ filePath }: { filePath: string }) {
  useEffect(() => {
    useWidgetStore.setState({ editingFile: filePath });
    return () => {
      useWidgetStore.setState({ editingFile: null });
    };
  }, [filePath]);

  return <EditorPanel />;
}

const meta: Meta<typeof EditorPanelWithState> = {
  component: EditorPanelWithState,
  title: "Components/EditorPanel",
  decorators: [
    (Story) => (
      <div className="relative h-[600px] w-[800px] overflow-hidden rounded-lg border border-border bg-background">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const EditingFlake: StoryObj<typeof EditorPanelWithState> = {
  args: {
    filePath: "flake.nix",
  },
};

export const EditingConfiguration: StoryObj<typeof EditorPanelWithState> = {
  args: {
    filePath: "configuration.nix",
  },
};
