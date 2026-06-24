import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { waitFor } from "storybook/test";
import { uiActions } from "@nixmac/state";
import { EditorPanel } from "@/components/widget/overlays/editor-panel";

function EditorPanelWithState({ filePath }: { filePath: string }) {
  useEffect(() => {
    uiActions.setState({ editingFile: filePath });
    return () => {
      uiActions.setState({ editingFile: null });
    };
  }, [filePath]);

  return <EditorPanel disableEditorRuntime />;
}

// The editor is React.lazy-loaded behind a Suspense "Loading editor..."
// fallback. The automatic afterEach snapshot fires as soon as the story body
// finishes, so without an explicit wait the captured DOM depends on whether
// the lazy chunk won the race — stable on a fast local machine, flaky on
// loaded CI runners. Gate the stories on the editor actually mounting.
const waitForEditor = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await waitFor(() => {
    if (!canvasElement.querySelector('[data-slot="nix-editor"]')) {
      throw new Error("nix-editor has not mounted yet");
    }
  });
};

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
  play: waitForEditor,
};

export const EditingConfiguration: StoryObj<typeof EditorPanelWithState> = {
  args: {
    filePath: "configuration.nix",
  },
  play: waitForEditor,
};
