import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import type { RebuildStatus } from "@/ipc/types";
import { initialUiState, useUiState } from "@nixmac/state";
import { useViewModel } from "@nixmac/state";
import type { RebuildContext } from "@/types/rebuild";
import { makeRebuildStatus } from "@/utils/test-fixtures";

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
    useViewModel.setState({
      rebuildStatus: null,
      rebuildLog: { lines: [], rawLines: [] },
    });
    useUiState.setState({ ...initialUiState });
  });
}

async function renderWithRebuildState(
  status: Partial<RebuildStatus>,
  context: RebuildContext = "apply",
) {
  act(() => {
    useViewModel.setState({
      rebuildStatus: makeRebuildStatus({
        isRunning: false,
        success: false,
        errorType: "build_error",
        errorMessage: "darwin-rebuild build failed",
        ...status,
      }),
      rebuildLog: {
        lines: [{ id: 1, text: "Build failed", type: "stderr" }],
        rawLines: [],
      },
    });
    useUiState.setState({ rebuildContext: context, rebuildPanelDismissed: false });
  });

  const result = render(<RebuildOverlayPanel />);
  await act(async () => {});
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
      errorType: "generic_error",
      errorMessage: "Activation failed",
      systemUntouched: false,
    });

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });

  it("does not show apply reassurance while rollback is failing", async () => {
    await renderWithRebuildState(
      {
        errorType: "user_cancelled",
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
      useUiState.getState().setRebuildPanelDismissed(true);
    });

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });
});
