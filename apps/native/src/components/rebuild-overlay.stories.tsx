import type { Meta, StoryObj } from "@storybook/react-vite";
import { type RebuildLine, RebuildOverlay } from "./rebuild-overlay";

const meta = {
  title: "Components/RebuildOverlay",
  component: RebuildOverlay,
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#1a1a2e" }],
    },
  },
  tags: ["autodocs"],
  argTypes: {
    isRunning: {
      control: "boolean",
      description: "Whether the rebuild is currently in progress",
    },
    success: {
      control: "boolean",
      description: "Whether the rebuild succeeded (when complete)",
    },
    exitCode: {
      control: "number",
      description: "Exit code of the rebuild process",
    },
    lines: {
      control: "object",
      description: "Array of output lines to display",
    },
  },
} satisfies Meta<typeof RebuildOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

// =============================================================================
// Mock Data
// =============================================================================

const mockLinesInProgress: RebuildLine[] = [
  { id: 1, text: "Starting darwin-rebuild switch...", type: "info" },
  { id: 2, text: "building the system configuration...", type: "info" },
  {
    id: 3,
    text: "these 23 derivations will be built:",
    type: "stdout",
  },
  {
    id: 4,
    text: "  /nix/store/abc123-vim-9.0.2190.drv",
    type: "stdout",
  },
  {
    id: 5,
    text: "  /nix/store/def456-git-2.43.0.drv",
    type: "stdout",
  },
  {
    id: 6,
    text: "  /nix/store/ghi789-ripgrep-14.1.0.drv",
    type: "stdout",
  },
  {
    id: 7,
    text: "building '/nix/store/abc123-vim-9.0.2190.drv'...",
    type: "info",
  },
  {
    id: 8,
    text: "unpacking source archive /nix/store/vim-9.0.2190.tar.gz",
    type: "stdout",
  },
  { id: 9, text: "configuring", type: "stdout" },
  { id: 10, text: "building", type: "info" },
];

const mockLinesComplete: RebuildLine[] = [
  { id: 1, text: "Starting darwin-rebuild switch...", type: "info" },
  { id: 2, text: "building the system configuration...", type: "info" },
  {
    id: 3,
    text: "these 5 derivations will be built:",
    type: "stdout",
  },
  {
    id: 4,
    text: "  /nix/store/abc123-vim-9.0.2190.drv",
    type: "stdout",
  },
  {
    id: 5,
    text: "building '/nix/store/abc123-vim-9.0.2190.drv'...",
    type: "info",
  },
  { id: 6, text: "installing", type: "stdout" },
  { id: 7, text: "post-installation fixup", type: "stdout" },
  { id: 8, text: "shrinking RPATHs of ELF executables", type: "stdout" },
  { id: 9, text: "activating the configuration...", type: "info" },
  { id: 10, text: "setting up launchd services...", type: "stdout" },
  { id: 11, text: "reloading nix-daemon...", type: "stdout" },
  {
    id: 12,
    text: 'Log saved to: "/Users/demo/Library/Logs/nixmac/darwin-rebuild_2024-01-15.log"',
    type: "stdout",
  },
];

const mockLinesWithErrors: RebuildLine[] = [
  { id: 1, text: "Starting darwin-rebuild switch...", type: "info" },
  { id: 2, text: "building the system configuration...", type: "info" },
  {
    id: 3,
    text: "evaluating file '/nix/store/xyz-source/flake.nix'",
    type: "stdout",
  },
  {
    id: 4,
    text: "error: attribute 'nonExistentPackage' missing",
    type: "stderr",
  },
  {
    id: 5,
    text: "       at /Users/demo/.config/darwin/modules/packages.nix:15:5:",
    type: "stderr",
  },
  {
    id: 6,
    text: "           14|   environment.systemPackages = [",
    type: "stderr",
  },
  { id: 7, text: "           15|     pkgs.nonExistentPackage", type: "stderr" },
  { id: 8, text: "             |     ^", type: "stderr" },
  { id: 9, text: "           16|   ];", type: "stderr" },
  {
    id: 10,
    text: "error: build of '/nix/store/...-darwin-system.drv' failed",
    type: "stderr",
  },
];

const mockLinesWithWarnings: RebuildLine[] = [
  { id: 1, text: "Starting darwin-rebuild switch...", type: "info" },
  { id: 2, text: "building the system configuration...", type: "info" },
  {
    id: 3,
    text: "warning: Git tree '/Users/demo/.config/darwin' is dirty",
    type: "stderr",
  },
  {
    id: 4,
    text: "warning: not writing lock file of flake",
    type: "stderr",
  },
  {
    id: 5,
    text: "these 3 derivations will be built:",
    type: "stdout",
  },
  { id: 6, text: "building '/nix/store/abc-package.drv'...", type: "info" },
  { id: 7, text: "activating the configuration...", type: "info" },
  {
    id: 8,
    text: 'Log saved to: "/Users/demo/Library/Logs/nixmac/darwin-rebuild.log"',
    type: "stdout",
  },
];

const mockLinesManyLines: RebuildLine[] = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  text:
    i % 10 === 0
      ? `building '/nix/store/pkg-${i}.drv'...`
      : i % 5 === 0
        ? `copying path '/nix/store/result-${i}'`
        : `  processing step ${i}...`,
  type: (i % 10 === 0 ? "info" : "stdout") as "info" | "stdout",
}));

// =============================================================================
// Stories
// =============================================================================

/**
 * Rebuild in progress - shows spinning indicator
 */
export const InProgress: Story = {
  args: {
    isRunning: true,
    lines: mockLinesInProgress,
  },
};

/**
 * Rebuild completed successfully
 */
export const Success: Story = {
  args: {
    isRunning: false,
    success: true,
    exitCode: 0,
    lines: mockLinesComplete,
  },
};

/**
 * Rebuild failed with errors
 */
export const Failed: Story = {
  args: {
    isRunning: false,
    success: false,
    exitCode: 1,
    lines: mockLinesWithErrors,
  },
};

/**
 * Rebuild with warnings but successful
 */
export const WithWarnings: Story = {
  args: {
    isRunning: false,
    success: true,
    exitCode: 0,
    lines: mockLinesWithWarnings,
  },
};

/**
 * Empty state - waiting for output
 */
export const Empty: Story = {
  args: {
    isRunning: true,
    lines: [],
  },
};

/**
 * Many lines of output - tests scrolling
 */
export const ManyLines: Story = {
  args: {
    isRunning: true,
    lines: mockLinesManyLines,
  },
};

/**
 * Just started - single line
 */
export const JustStarted: Story = {
  args: {
    isRunning: true,
    lines: [{ id: 1, text: "Starting darwin-rebuild switch...", type: "info" }],
  },
};
