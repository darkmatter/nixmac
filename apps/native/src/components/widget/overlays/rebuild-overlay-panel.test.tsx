import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RebuildOverlayPanel } from "@/components/widget/overlays/rebuild-overlay-panel";
import { initialRebuildState, useWidgetStore, type RebuildState } from "@/stores/widget-store";

const mocks = vi.hoisted(() => ({
  handleRollback: vi.fn(),
  triggerRebuild: vi.fn(),
}));

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
    triggerRebuild: mocks.triggerRebuild,
  }),
}));

vi.mock("@/hooks/use-rollback", () => ({
  useRollback: () => ({
    handleRollback: mocks.handleRollback,
  }),
}));

const safetyMessage = "No changes were made to your system.";

async function renderWithRebuildState(rebuild: Partial<RebuildState>) {
  act(() => {
    useWidgetStore.setState({
      rebuild: {
        ...initialRebuildState,
        isRunning: false,
        context: "apply",
        lines: [{ id: 1, text: "Build failed", type: "stderr" }],
        success: false,
        errorType: "build_error",
        errorMessage: "darwin-rebuild build failed",
        ...rebuild,
      },
    });
  });

  const result = render(<RebuildOverlayPanel />);
  await act(async () => {});
  return result;
}

describe("<RebuildOverlayPanel>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.triggerRebuild.mockResolvedValue(undefined);
    act(() => {
      useWidgetStore.getState().clearRebuild();
    });
  });

  afterEach(() => {
    act(() => {
      useWidgetStore.getState().clearRebuild();
    });
  });

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
    await renderWithRebuildState({
      context: "rollback",
      errorType: "user_cancelled",
      errorMessage: "Activation cancelled by user",
      systemUntouched: true,
    });

    expect(screen.queryByText(safetyMessage)).not.toBeInTheDocument();
  });

  it("retries a failed rollback with its captured store path and finalization callbacks", async () => {
    const onSuccess = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onFailure = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await renderWithRebuildState({
      context: "rollback",
      errorType: "authorization_denied",
      errorMessage: "Activation denied",
      retryOptions: {
        storePath: "/nix/store/previous-system",
        onSuccess,
        onFailure,
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry rollback/i }));
    });

    expect(mocks.triggerRebuild).toHaveBeenCalledWith({
      context: "rollback",
      storePath: "/nix/store/previous-system",
      onSuccess,
      onFailure,
    });
  });
});
