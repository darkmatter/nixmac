import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { useUiStore } from "@/stores/ui-store";
import { EditorPanel } from "@/components/widget/overlays/editor-panel";

function EditorPanelWithState({ filePath }: { filePath: string }) {
  useEffect(() => {
    useUiStore.setState({ editingFile: filePath });
    return () => {
      useUiStore.setState({ editingFile: null });
    };
  }, [filePath]);

  return <EditorPanel disableEditorRuntime />;
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
