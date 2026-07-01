import { RouterProvider, nav, router } from "@/router";
import { makeGlobalPreferences as makePrefs } from "@/utils/test-fixtures";
import { initialUiState, uiActions, viewModelActions } from "@nixmac/state";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DarwinWidget now reads router state (useIsOverlayActive), so tests must wrap
// it in the router provider. The router's root layout renders DarwinWidget
// itself, so we just render the provider.
function withRouter() {
  return <RouterProvider router={router} />;
}

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
    on: vi.fn().mockReturnValue(Promise.resolve(() => { })),
  },
}));

vi.mock("@/components/editor-panel", () => ({
  EditorPanel: () => null,
}));
vi.mock("@/components/widget/overlays/editor-panel", () => ({
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
    viewModelActions.setState({
      git: null,
      preferences: makePrefs({
        configDir: "/Users/test/nixmac",
        hostAttr: "Test-MacBook",
      }),
      hosts: ["Test-MacBook"],
      evolveEvents: [],
    });
    uiActions.setState({ ...initialUiState });
    // Reset router to the index route so no overlay is active
    nav.goHome();
  });

  it("renders without crashing", () => {
    const { container } = render(withRouter());
    expect(container).toBeTruthy();
  });

  it("renders setup step when no config", () => {
    viewModelActions.setState({
      preferences: makePrefs({ configDir: null, hostAttr: null }),
      hosts: [],
    });

    const { container } = render(withRouter());
    expect(container).toBeTruthy();
  });

  it("renders evolving step with git changes", () => {
    viewModelActions.setState({
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

    const { container } = render(withRouter());
    expect(container).toBeTruthy();
  });

});
