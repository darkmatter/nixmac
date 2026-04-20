import type { Meta, StoryObj } from "@storybook/react-vite";
import { NixEditor } from "./index";

const meta: Meta<typeof NixEditor> = {
  component: NixEditor,
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

export const FlakeNix: StoryObj<typeof NixEditor> = {
  args: {
    filePath: "flake.nix",
  },
};

export const ConfigurationNix: StoryObj<typeof NixEditor> = {
  args: {
    filePath: "configuration.nix",
  },
};

export const UnknownFile: StoryObj<typeof NixEditor> = {
  args: {
    filePath: "modules/homebrew.nix",
  },
};
