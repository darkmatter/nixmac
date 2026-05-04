import type { Meta, StoryObj } from "@storybook/react-vite";

interface StaticNixEditorProps {
  filePath: string;
}

function StaticNixEditor({ filePath }: StaticNixEditorProps) {
  const filename = filePath.split("/").pop() ?? filePath;

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      <div className="absolute top-2 right-3 z-10 flex items-center gap-2">
        <div className="rounded bg-muted px-2 py-0.5 text-muted-foreground text-xs">
          nixd
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-neutral-950 p-4 font-mono text-[13px] text-neutral-200">
        <div className="mb-3 text-neutral-500 text-xs">{filename}</div>
        <pre className="whitespace-pre-wrap">
          {`{ config, pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    git
    vim
  ];
}`}
        </pre>
      </div>
    </div>
  );
}

const meta: Meta<typeof StaticNixEditor> = {
  component: StaticNixEditor,
  title: "Components/NixEditor",
  decorators: [
    (Story) => (
      <div className="h-[500px] w-[700px] overflow-hidden rounded-lg border border-border bg-background">
        <Story />
      </div>
    ),
  ],
};

export default meta;

export const FlakeNix: StoryObj<typeof StaticNixEditor> = {
  args: {
    disableRuntime: true,
    filePath: "flake.nix",
  },
};

export const ConfigurationNix: StoryObj<typeof StaticNixEditor> = {
  args: {
    disableRuntime: true,
    filePath: "configuration.nix",
  },
};

export const UnknownFile: StoryObj<typeof StaticNixEditor> = {
  args: {
    disableRuntime: true,
    filePath: "modules/homebrew.nix",
  },
};
