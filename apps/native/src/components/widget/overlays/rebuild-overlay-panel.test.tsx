import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import type { EtcClobberCheckResult, RebuildStatus } from "@/ipc/types";
import { REBUILD_ERROR_CODES } from "@/lib/errors";
import type { RebuildContext } from "@/types/rebuild";
import { makeRebuildStatus } from "@/utils/test-fixtures";
import { initialUiState, uiActions, viewModelActions } from "@nixmac/state";

vi.mock("motion/react", async () => {
  const React = await import("react");

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: React.forwardRef<
        HTMLDivElement,
        React.HTMLAttributes<HTMLDivElement> & {
          animate?: unknown;
          exit?: unknown;
          initial?: unknown;
        }
      >(({ animate: _animate, exit: _exit, initial: _initial, ...props }, ref) => (
        <div ref={ref} {...props} />
      )),
    },
  };
});

vi.mock("@/hooks/use-rebuild-stream", () => ({
  useRebuildStream: () => ({
    triggerRebuild: vi.fn<() => void>(),
  }),
}));

vi.mock("@/hooks/use-rollback", () => ({
  useRollback: () => ({
    handleRollback: vi.fn<() => void>(),
  }),
}));

const safetyMessage = "No changes were made to your system.";

function makeEtcClobberResult(): EtcClobberCheckResult {
  return {
    ok: false,
    checked: 12,
    conflicts: [
      {
        path: "/etc/nix/github-token.conf",
        target: "nix/github-token.conf",
        expectedStaticPath: "/etc/static/nix/github-token.conf",
        currentLinkTarget: null,
        knownSha256Hashes: [],
        kind: "unrecognized_content",
      },
    ],
    warnings: [],
  };
}

function resetStores() {
  act(() => {
    viewModelActions.setState({
      rebuildStatus: null,
      rebuildLog: { lines: [], rawLines: [], notices: [] },
    });
    uiActions.setState({ ...initialUiState });
  });
}

async function renderWithRebuildState(
  status: Partial<RebuildStatus>,
  context: RebuildContext = "apply",
) {
  act(() => {
    viewModelActions.setState({
      rebuildStatus: makeRebuildStatus({
        isRunning: false,
        success: false,
        errorType: REBUILD_ERROR_CODES.BUILD_ERROR,
        errorMessage: "darwin-rebuild build failed",
        ...status,
      }),
      rebuildLog: {
        lines: [{ id: 1, text: "Build failed", type: "stderr" }],
        rawLines: [],
        notices: [],
      },
    });
    uiActions.setState({ rebuildContext: context, rebuildPanelDismissed: false });
  });

  const result = render(<RebuildOverlayPanel />);
  await act(async () => { });
  return result;
}

describe("<RebuildOverlayPanel>", () => {
  beforeEach(resetStores);

  afterEach(resetStores);

  it("prominently reassures users when the backend says the failed apply left the system untouched", async () => {
    await renderWithRebuildState({ systemUntouched: true });

    expect(screen.getByText(safetyMessage)).toBeInTheDocument();
  });

  it("does not reassure when the backend cannot prove the system was untouched", async () => {
    await renderWithRebuildState({
      errorType: REBUILD_ERROR_CODES.GENERIC_ERROR,
      errorMessage: "Activation failed",
      systemUntouched: false,
    });

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });

  it("does not show apply reassurance while rollback is failing", async () => {
    await renderWithRebuildState(
      {
        errorType: REBUILD_ERROR_CODES.USER_CANCELLED,
        errorMessage: "Activation cancelled by user",
        systemUntouched: true,
      },
      "rollback",
    );

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });

  it("shows App Management guidance for managed app update failures", async () => {
    await renderWithRebuildState({
      errorType: REBUILD_ERROR_CODES.APP_MANAGEMENT,
      errorMessage: "permission denied when trying to update apps",
      systemUntouched: false,
    });

    expect(screen.getByText("App Management is required to update managed app bundles")).toBeInTheDocument();
    expect(
      screen.getByText(/Privacy & Security → App Management/),
    ).toBeInTheDocument();
  });

  it("renders build-log-triggered notices while a rebuild is running", async () => {
    act(() => {
      viewModelActions.setState({
        rebuildStatus: makeRebuildStatus({
          isRunning: true,
          success: null,
          errorType: null,
          errorMessage: null,
          systemUntouched: null,
        }),
        rebuildLog: {
          lines: [{ id: 1, text: "Requesting admin privileges", type: "info" }],
          rawLines: ["darwin-rebuild requires permission to update your apps"],
          notices: [
            {
              id: "app-management-permission",
              title: "App Management permission required",
              body: "Open System Settings → Privacy & Security → App Management and enable nixmac.",
              permissionId: "app-management",
              actionLabel: "Open App Management",
            },
          ],
        },
      });
      uiActions.setState({ rebuildContext: "apply", rebuildPanelDismissed: false });
    });

    render(<RebuildOverlayPanel />);

    expect(screen.getByText("App Management permission required")).toBeInTheDocument();
    expect(screen.getByText(/enable nixmac/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open App Management" })).toBeInTheDocument();
  });

  it("lists the structured /etc clobber conflicts on an etc_clobber failure", async () => {
    act(() => {
      uiActions.setState({ etcClobber: makeEtcClobberResult() });
    });

    await renderWithRebuildState({
      errorType: REBUILD_ERROR_CODES.ETC_CLOBBER,
      errorMessage: "Unexpected files in /etc would be overwritten",
      systemUntouched: true,
    });

    expect(screen.getByText("/etc/nix/github-token.conf")).toBeInTheDocument();
    expect(screen.getByText("Unrecognized content")).toBeInTheDocument();
  });

  it("hides the panel once dismissed", async () => {
    await renderWithRebuildState({ systemUntouched: true });

    act(() => {
      uiActions.setRebuildPanelDismissed(true);
    });

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });
});
