import type { Meta, StoryObj } from "@storybook/react-vite";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StaticEditorPanelProps {
  filePath: string;
}

function StaticEditorPanel({ filePath }: StaticEditorPanelProps) {
  const filename = filePath.split("/").pop() ?? filePath;

  return (
    <div className="fixed inset-y-8 w-full max-w-[100vw] z-20 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Editing</span>
          <span className="font-mono font-medium">{filename}</span>
          <span className="text-muted-foreground text-xs">({filePath})</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
          <div className="rounded bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            nixd
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-neutral-950 p-4 font-mono text-[13px] text-neutral-200">
          <pre className="whitespace-pre-wrap">
            {`{ config, pkgs, ... }:

{
  programs.zsh.enable = true;
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof StaticEditorPanel> = {
  component: StaticEditorPanel,
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

export const EditingFlake: StoryObj<typeof StaticEditorPanel> = {
  args: {
    filePath: "flake.nix",
  },
};

export const EditingConfiguration: StoryObj<typeof StaticEditorPanel> = {
  args: {
    filePath: "configuration.nix",
  },
};
