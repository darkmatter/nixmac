import { initialUiState, useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DarwinWidget } from "./widget";
import { makeGlobalPreferences as makePrefs } from "@/utils/test-fixtures";

// Mock Tauri API
vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    git: {
      status: vi.fn().mockResolvedValue({ hasChanges: false, files: [] }),
    },
    debug: {
      logBreadcrumb: vi.fn().mockResolvedValue(undefined),
      markBootStage: vi.fn().mockResolvedValue(undefined),
    },
    config: {
      read: vi.fn().mockResolvedValue({ configDir: "/Users/test/nixmac" }),
      listHosts: vi.fn().mockResolvedValue(["Test-MacBook"]),
    },
    evolveMascot: {
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
    },
    nix: {
      check: vi.fn().mockResolvedValue(undefined),
      installState: vi.fn().mockResolvedValue(undefined),
    },
  },
  ipcRenderer: {
    on: vi.fn().mockReturnValue(Promise.resolve(() => {})),
  },
}));

vi.mock("@/components/editor-panel", () => ({
  EditorPanel: () => null,
}));

vi.mock("@/components/widget/summaries/diff-section", () => ({
  DiffSection: () => null,
}));

// Mock hooks
vi.mock("@/hooks/use-widget-initialization", () => ({
  loadEvolveState: vi.fn().mockResolvedValue(undefined),
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
    fetchSummary: vi.fn(),
  }),
}));

describe("DarwinWidget", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useViewModel.setState({
      git: null,
      preferences: makePrefs({
        configDir: "/Users/test/nixmac",
        hostAttr: "Test-MacBook",
      }),
      hosts: ["Test-MacBook"],
      evolveEvents: [],
    });
    useUiState.setState({ ...initialUiState });
  });

  it("renders without crashing", () => {
    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });

  it("renders setup step when no config", () => {
    useViewModel.setState({
      preferences: makePrefs({ configDir: null, hostAttr: null }),
      hosts: [],
    });

    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });

  it("renders evolving step with git changes", () => {
    useViewModel.setState({
      git: {
        files: [{ path: "test.nix", changeType: "edited" }],
        branch: null,
        diff: "",
        additions: 0,
        deletions: 0,
        headCommitHash: null,
        cleanHead: false,
        changes: [],
      },
    });

    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });

  it("renders with error message", () => {
    useUiState.getState().setError("Test error message");

    const { container } = render(<DarwinWidget />);
    expect(container).toBeTruthy();
  });
});
