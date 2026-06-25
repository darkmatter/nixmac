import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import type { RebuildStatus } from "@/ipc/types";
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

function resetStores() {
  act(() => {
    viewModelActions.setState({
      rebuildStatus: null,
      rebuildLog: { lines: [], rawLines: [] },
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

  it("hides the panel once dismissed", async () => {
    await renderWithRebuildState({ systemUntouched: true });

    act(() => {
      uiActions.setRebuildPanelDismissed(true);
    });

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });
});
