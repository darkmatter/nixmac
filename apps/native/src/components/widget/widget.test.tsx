import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SummaryState } from "@/stores/widget-store";
import { WidgetUI } from "./widget-ui";

// Mock data for testing
const mockSummary: SummaryState = {
  items: [
    { title: "Vim Installed", description: "Added vim to system packages" },
  ],
  instructions: "Run vim in terminal",
  commitMessage: "feat: add vim",
  filesChanged: 1,
  isLoading: false,
};

const baseProps = {
  step: "overview" as const,
  appState: "idle" as const,
  configDir: "/Users/test/nixmac",
  hosts: ["Test-MacBook"],
  host: "Test-MacBook",
  gitStatus: null,
  evolvePrompt: "",
  commitMsg: "",
  isProcessing: false,
  isGenerating: false,
  processingAction: null,
  evolveEvents: [],
  summary: mockSummary,
  consoleLogs: "",
  consoleExpanded: false,
  isExpanded: true,
  peekState: "expanded" as const,
  settingsOpen: false,
  error: null,
  onExpand: () => {},
  onCollapse: () => {},
  onPickDir: () => {},
  onSaveHost: () => {},
  onEvolve: () => {},
  onApply: () => {},
  onCommit: () => {},
  onCancel: () => {},
  onEvolvePromptChange: () => {},
  onCommitMsgChange: () => {},
  onConsoleExpandedChange: () => {},
  onSettingsOpenChange: () => {},
  onErrorDismiss: () => {},
  onHostsChange: () => {},
  onShowCommitScreen: () => {},
  onBackFromCommit: () => {},
};

describe("WidgetUI Snapshots", () => {
  it("overview step matches snapshot", () => {
    const { container } = render(<WidgetUI {...baseProps} step="overview" />);
    expect(container).toMatchSnapshot();
  });

  it("setup step matches snapshot", () => {
    const { container } = render(
      <WidgetUI {...baseProps} appState="onboarding" step="setup" />
    );
    expect(container).toMatchSnapshot();
  });

  it("evolving step matches snapshot", () => {
    const { container } = render(
      <WidgetUI
        {...baseProps}
        appState="preview"
        gitStatus={{
          hasChanges: true,
          files: [{ path: "test.nix", working_tree: "M" }],
        }}
        step="evolving"
      />
    );
    expect(container).toMatchSnapshot();
  });

  it("generating state matches snapshot", () => {
    const { container } = render(
      <WidgetUI
        {...baseProps}
        appState="generating"
        evolveEvents={[
          {
            eventType: "start",
            summary: "Starting...",
            raw: "",
            iteration: null,
            timestampMs: 0,
          },
        ]}
        isGenerating={true}
        step="evolving"
      />
    );
    expect(container).toMatchSnapshot();
  });
});
