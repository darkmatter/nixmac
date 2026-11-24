import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFixWithAi } from "./use-fix-with-ai";

const { rpc, model, ui } = vi.hoisted(() => ({
  rpc: vi.fn<(input: { error: string; errorType: string | null; logFile: string | null }) => Promise<void>>(),
  model: {
    rebuildStatus: {
      isRunning: false,
      errorMessage: "evaluation failed",
      errorType: "evaluation_error",
      logFile: "/logs/displayed-run.log",
    },
    preferences: null,
  },
  ui: { isGenerating: false },
}));
vi.mock("@/lib/orpc", () => ({ client: { darwin: { fixWithAi: rpc } } }));
vi.mock("@/lib/telemetry/instance", () => ({ getTelemetry: () => ({ captureEvent: vi.fn<() => void>() }) }));
vi.mock("@nixmac/state", () => ({
  viewModelActions: { getState: () => model },
  useUiState: { getState: () => ui },
  uiActions: {
    setProcessing: vi.fn<() => void>(),
    setGenerating: vi.fn<() => void>(),
    setError: vi.fn<() => void>(),
    clearLogs: vi.fn<() => void>(),
    setConversationalResponse: vi.fn<() => void>(),
    setEvolutionTelemetry: vi.fn<() => void>(),
    setActiveStepOverride: vi.fn<() => void>(),
    setRebuildPanelDismissed: vi.fn<() => void>(),
    appendLog: vi.fn<() => void>(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  model.rebuildStatus.isRunning = false;
  ui.isGenerating = false;
  rpc.mockResolvedValue(undefined);
});
it("passes the displayed failed run to the existing evolve endpoint", async () => {
  const { result } = renderHook(() => useFixWithAi());
  await result.current.fixWithAi();
  expect(rpc).toHaveBeenCalledWith({
    error: "evaluation failed",
    errorType: "evaluation_error",
    logFile: "/logs/displayed-run.log",
  });
});
it("retains run context for per-line fixes", async () => {
  const { result } = renderHook(() => useFixWithAi());
  await result.current.fixWithAi("specific line");
  expect(rpc).toHaveBeenCalledWith(
    expect.objectContaining({ error: "specific line", logFile: "/logs/displayed-run.log" }),
  );
});
it("does not start a fix during a retry", async () => {
  model.rebuildStatus.isRunning = true;
  const { result } = renderHook(() => useFixWithAi());
  await result.current.fixWithAi();
  expect(rpc).not.toHaveBeenCalled();
});
it("does not start a second evolution", async () => {
  ui.isGenerating = true;
  const { result } = renderHook(() => useFixWithAi());
  await result.current.fixWithAi();
  expect(rpc).not.toHaveBeenCalled();
});
