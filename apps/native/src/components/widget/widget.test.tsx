import { useWidgetStore } from "@/stores/widget-store";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DarwinWidget } from "./widget";

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
    scanner: {
      getRecommendedPrompt: vi.fn().mockResolvedValue(null),
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
  loadConfig: vi.fn().mockResolvedValue(undefined),
  loadHosts: vi.fn().mockResolvedValue(undefined),
  recoverFromGitState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-git-operations", () => ({
  prefetchFileDiffContents: vi.fn(),
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
    findChangeMap: vi.fn().mockResolvedValue(undefined),
    summarizeOnFocus: vi.fn(),
  }),
}));

describe("DarwinWidget", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/test/nixmac");
    store.setHosts(["Test-MacBook"]);
    store.setHost("Test-MacBook");
    store.setNixInstalled(true);
    store.setDarwinRebuildAvailable(true);
    store.setPermissionsChecked(false);
    store.setPermissionsState(null);
    store.setEvolveState(null);
    store.setGitStatus(null);
    store.setEvolvePrompt("");
    store.setProcessing(false);
    store.setGenerating(false);
    store.setError(null);
    store.clearEvolveEvents();
    store.clearLogs();
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
      files: [{ path: "test.nix", changeType: "edited" }],
      branch: null,
      diff: "",
      additions: 0,
      deletions: 0,
      headCommitHash: null,
      cleanHead: false,
      changes: [],
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

  it("shows an enabled discard action with the required confirmation on evolve review", () => {
    const store = useWidgetStore.getState();
    store.setEvolveState({
      evolutionId: 1,
      currentChangesetId: 1,
      committable: false,
      backupBranch: "backup/pre-evolve-1",
      rollbackBranch: "rollback/pre-evolve-1",
      rollbackStorePath: null,
      rollbackChangesetId: null,
      step: "evolve",
    });
    store.setGitStatus({
      files: [{ path: "test.nix", changeType: "edited" }],
      branch: null,
      diff: "@@ -1 +1 @@\n-old\n+new",
      additions: 1,
      deletions: 1,
      headCommitHash: null,
      cleanHead: false,
      changes: [
        {
          id: 1,
          hash: "change-1",
          filename: "test.nix",
          diff: "@@ -1 +1 @@\n-old\n+new",
          lineCount: 2,
          createdAt: 0,
          ownSummaryId: null,
        },
      ],
    });

    render(<DarwinWidget />);

    const discardButton = screen.getByTestId("evolve-discard-button");
    expect(discardButton).toBeEnabled();
    expect(screen.getByRole("button", { name: /Build & Test/i })).toBeInTheDocument();

    fireEvent.click(discardButton);

    expect(
      screen.getByText("Discard these changes? Your Nix config will not be modified."),
    ).toBeInTheDocument();
  });
});
