import type { Meta, StoryObj } from "@storybook/react-vite";
import React, { useEffect } from "react";
import { RebuildOverlayPanel } from "./rebuild-overlay-panel";
import {
  useWidgetStore,
  type RebuildLine,
  type RebuildState,
} from "@/stores/widget-store";

/**
 * Decorator that sets the widget store's rebuild state before rendering.
 */
const withRebuildState = (rebuildState: Partial<RebuildState>) => {
  const defaults: RebuildState = {
    isRunning: false,
    context: "apply",
    lines: [],
    rawLines: [],
    exitCode: undefined,
    success: undefined,
    errorType: undefined,
    errorMessage: undefined,
  };

  return (Story: () => React.ReactNode) => {
    useEffect(() => {
      useWidgetStore.setState({ rebuild: { ...defaults, ...rebuildState } });
      return () => {
        useWidgetStore.setState({ rebuild: defaults });
      };
    }, []);

    return (
      <div style={{ width: 280, height: 400, position: "relative" }}>
        <Story />
      </div>
    );
  };
};

const meta = {
  title: "Components/RebuildOverlayPanel",
  component: RebuildOverlayPanel,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#1a1a2e" }],
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof RebuildOverlayPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sample rebuild lines for different states
const startingLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
];

const buildingLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 12 packages", type: "info" },
];

const midBuildLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 12 packages", type: "info" },
  { id: 4, text: "📥 Fetching dependencies from cache", type: "info" },
  { id: 5, text: "⚡ Compiling neovim plugins", type: "info" },
];

const completedLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "🔨 Building 12 packages", type: "info" },
  { id: 4, text: "📥 Fetching dependencies from cache", type: "info" },
  { id: 5, text: "⚡ Compiling neovim plugins", type: "info" },
  { id: 6, text: "🔧 Activating system configuration", type: "info" },
  { id: 7, text: "✅ Rebuild complete!", type: "info" },
];

const errorLines: RebuildLine[] = [
  { id: 1, text: "🚀 Starting rebuild...", type: "info" },
  { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
  { id: 3, text: "❌ Build failed: infinite recursion", type: "stderr" },
];

/**
 * Initial state when rebuild just started
 */
export const Starting: Story = {
  decorators: [
    withRebuildState({ isRunning: true, lines: startingLines }),
  ],
};

/**
 * Building state with a few progress lines
 */
export const Building: Story = {
  decorators: [
    withRebuildState({ isRunning: true, lines: buildingLines }),
  ],
};

/**
 * Mid-build state with more progress
 */
export const MidBuild: Story = {
  decorators: [
    withRebuildState({ isRunning: true, lines: midBuildLines }),
  ],
};

/**
 * Successfully completed rebuild
 */
export const Success: Story = {
  decorators: [
    withRebuildState({ isRunning: false, lines: completedLines, success: true }),
  ],
};

/**
 * Failed with infinite recursion error
 */
export const InfiniteRecursionError: Story = {
  decorators: [
    withRebuildState({
      isRunning: false,
      lines: errorLines,
      success: false,
      errorType: "infinite_recursion",
      errorMessage:
        "error: infinite recursion encountered at /nix/store/...-source/flake.nix:42",
    }),
  ],
};

/**
 * Failed with evaluation error
 */
export const EvaluationError: Story = {
  decorators: [
    withRebuildState({
      isRunning: false,
      lines: errorLines,
      success: false,
      errorType: "evaluation_error",
      errorMessage:
        "error: attribute 'missing-package' not found at /nix/store/...-source/configuration.nix:15",
    }),
  ],
};

/**
 * Failed with build error
 */
export const BuildError: Story = {
  decorators: [
    withRebuildState({
      isRunning: false,
      lines: [
        { id: 1, text: "🚀 Starting rebuild...", type: "info" },
        { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
        { id: 3, text: "🔨 Building packages...", type: "info" },
        { id: 4, text: "❌ Package build failed", type: "stderr" },
      ],
      success: false,
      errorType: "build_error",
      errorMessage:
        "builder for '/nix/store/abc123-some-package.drv' failed with exit code 1",
    }),
  ],
};

/**
 * Failed with generic error
 */
export const GenericError: Story = {
  decorators: [
    withRebuildState({
      isRunning: false,
      lines: errorLines,
      success: false,
      errorType: "generic_error",
      errorMessage: "An unexpected error occurred during the rebuild process",
    }),
  ],
};

/**
 * Many lines to test scrolling behavior
 */
export const ManyLines: Story = {
  decorators: [
    withRebuildState({
      isRunning: true,
      lines: [
        { id: 1, text: "🚀 Starting rebuild...", type: "info" },
        { id: 2, text: "📦 Evaluating flake configuration", type: "info" },
        { id: 3, text: "🔨 Building 24 packages", type: "info" },
        { id: 4, text: "📥 Fetching from binary cache", type: "info" },
        { id: 5, text: "⚡ Compiling neovim", type: "info" },
        { id: 6, text: "🔧 Building home-manager", type: "info" },
        { id: 7, text: "📦 Installing ripgrep", type: "info" },
        { id: 8, text: "🎯 Configuring git", type: "info" },
        { id: 9, text: "✨ Setting up zsh plugins", type: "info" },
        { id: 10, text: "🔨 Building starship prompt", type: "info" },
      ],
    }),
  ],
};
