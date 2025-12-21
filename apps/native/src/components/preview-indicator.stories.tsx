import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PreviewIndicator } from "./preview-indicator";

const meta = {
  title: "Components/PreviewIndicator",
  component: PreviewIndicator,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  argTypes: {
    visible: {
      control: "boolean",
      description: "Whether the indicator is visible",
    },
    summary: {
      control: "text",
      description: "Summary of the changes",
    },
    filesChanged: {
      control: "number",
      description: "Number of files changed",
    },
    commitMessage: {
      control: "text",
      description: "Suggested commit message",
    },
    isLoading: {
      control: "boolean",
      description: "Whether an action is in progress",
    },
  },
  args: {
    onClick: fn(),
    onCommit: fn(),
    onDiscard: fn(),
  },
} satisfies Meta<typeof PreviewIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state - indicator visible with glowing effect
 */
export const Default: Story = {
  args: {
    visible: true,
    filesChanged: 3,
    commitMessage: "feat(darwin): add vim and git configuration",
    summary:
      "Added vim to system packages with custom configuration. Updated git settings with user name and email.",
  },
};

/**
 * Hidden state - indicator not visible
 */
export const Hidden: Story = {
  args: {
    visible: false,
  },
};

/**
 * Single file changed
 */
export const SingleFile: Story = {
  args: {
    visible: true,
    filesChanged: 1,
    commitMessage: "chore: update flake inputs",
    summary: "Updated flake.lock with latest nixpkgs revision.",
  },
};

/**
 * Many files changed
 */
export const ManyFiles: Story = {
  args: {
    visible: true,
    filesChanged: 12,
    commitMessage: "feat(homebrew): add development tools",
    summary:
      "Added Rectangle, iTerm2, and VS Code to homebrew casks. Configured Rectangle for window management. Added development CLI tools including ripgrep, fd, and bat.",
  },
};

/**
 * Loading state - while committing or discarding
 */
export const Loading: Story = {
  args: {
    visible: true,
    filesChanged: 5,
    commitMessage: "feat: comprehensive system setup",
    summary: "Multiple configuration changes pending commit.",
    isLoading: true,
  },
};

/**
 * No commit message provided yet
 */
export const EmptyMessage: Story = {
  args: {
    visible: true,
    filesChanged: 2,
    commitMessage: "",
    summary: "Changes detected but no commit message suggested.",
  },
};

/**
 * Long summary text
 */
export const LongSummary: Story = {
  args: {
    visible: true,
    filesChanged: 8,
    commitMessage: "feat(darwin): comprehensive system configuration update",
    summary:
      "This update includes significant changes to the nix-darwin configuration. Added several new packages including vim, neovim, git, and ripgrep. Configured homebrew with Rectangle for window management and iTerm2 as the terminal emulator. Updated user home-manager configuration with custom shell aliases and environment variables. Modified system defaults for Dock and Finder preferences. Added SSH key generation and GPG signing configuration for git commits.",
  },
};
