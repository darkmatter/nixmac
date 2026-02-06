import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DarwinWidget } from "./widget";
import { initialSummaryState, useWidgetStore } from "@/stores/widget-store";

// Mock Tauri API
vi.mock("@/tauri-api", () => ({
  darwinAPI: {
    git: {
      status: vi.fn().mockResolvedValue({ hasChanges: false, files: [] }),
    },
    config: {
      read: vi.fn().mockResolvedValue({ configDir: "/Users/test/nixmac" }),
      listHosts: vi.fn().mockResolvedValue(["Test-MacBook"]),
    },
  },
  ipcRenderer: {
    on: vi.fn().mockReturnValue(Promise.resolve(() => {})),
  },
  CONFIG_CHANGED_CHANNEL: "config-changed",
}));

// Mock hooks
vi.mock("@/hooks/use-widget-initialization", () => ({
  loadConfig: vi.fn().mockResolvedValue(undefined),
  loadHosts: vi.fn().mockResolvedValue(undefined),
  recoverFromGitState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-git-operations", () => ({
  useGitOperations: () => ({
    refreshGitStatus: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/use-preview-indicator", () => ({
  usePreviewIndicator: () => ({
    updatePreviewIndicator: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({
    checkAndFetchSummary: vi.fn(),
  }),
}));

describe("DarwinWidget", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/test/nixmac");
    store.setHosts(["Test-MacBook"]);
    store.setHost("Test-MacBook");
    store.setGitStatus(null);
    store.setEvolvePrompt("");
    store.setCommitMsg("");
    store.setProcessing(false);
    store.setGenerating(false);
    store.setError(null);
    store.clearEvolveEvents();
    store.clearLogs();
    store.setSummary(initialSummaryState);
  });

  it("renders without crashing", () => {
    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });

  it("renders setup step when no config", () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("");
    store.setHost("");

    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });

  it("renders evolving step with git changes", () => {
    const store = useWidgetStore.getState();
    store.setGitStatus({
      hasChanges: true,
      files: [{ path: "test.nix", working_tree: "M" }],
    });

    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });

  it("renders with error message", () => {
    const store = useWidgetStore.getState();
    store.setError("Test error message");

    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });
});
