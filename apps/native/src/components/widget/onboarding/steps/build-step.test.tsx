import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvolveState } from "@/ipc/types";
import { BuildStep } from "./build-step";

const { fixWithAi, readLog, writeText, model } = vi.hoisted(() => ({
  fixWithAi: vi.fn<() => Promise<void>>(),
  readLog: vi.fn<(input: { logFile: string }) => Promise<string>>(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
  model: {
    evolve: null as EvolveState | null,
    rebuildStatus: {
      isRunning: false,
      success: false,
      logFile: "/logs/failed.log" as string | null,
      systemUntouched: false as boolean | null,
      errorType: "generic_error" as string | null,
      errorMessage: "Homebrew reconciliation failed",
    },
    rebuildLog: { rawLines: [], notices: [] },
    preferences: null,
  },
}));
vi.mock("@nixmac/state", () => ({
  useUiState: (select: (state: { isGenerating: boolean; etcClobber: null }) => unknown) =>
    select({ isGenerating: false, etcClobber: null }),
  useViewModel: (select: (state: typeof model) => unknown) => select(model),
  useOnboarding: (select: (state: { celebrating: boolean }) => unknown) =>
    select({ celebrating: false }),
  onboardingActions: { setCelebrating: vi.fn<() => void>() },
}));
vi.mock("@/components/widget/steps/review-step", () => ({
  ReviewStep: () => <div>Review proposed fix</div>,
}));
vi.mock("@/components/widget/steps/commit-step", () => ({
  CommitStep: () => <div>Commit reviewed fix</div>,
}));
vi.mock("@/hooks/use-fix-with-ai", () => ({ useFixWithAi: () => ({ fixWithAi }) }));
vi.mock("@/hooks/use-apply", () => ({ useApply: () => ({ handleApply: vi.fn<() => void>() }) }));
vi.mock("@/lib/telemetry/instance", () => ({ getTelemetry: () => ({ captureEvent: vi.fn<() => void>() }) }));
vi.mock("@/ipc/api", () => ({ tauriAPI: {} }));
vi.mock("@/lib/orpc", () => ({ client: { darwin: { readRebuildLog: readLog } } }));
vi.mock("@/components/widget/onboarding/inference/inference-setup", () => ({
  InferenceSetup: () => null,
}));
vi.mock("@/components/widget/onboarding/step-shell", () => ({
  StepShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("first-build failure guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    model.rebuildStatus.systemUntouched = false;
    model.rebuildStatus.isRunning = false;
    model.rebuildStatus.logFile = "/logs/failed.log";
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });
  it("does not claim the system was untouched after partial activation", () => {
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    expect(screen.getByText("Activation failed")).toBeInTheDocument();
    expect(screen.queryByText(/Your Mac was not changed/)).not.toBeInTheDocument();
  });
  it("confirms no changes only when the backend reports that state", () => {
    model.rebuildStatus.systemUntouched = true;
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    expect(screen.getByText("No changes were made to your system.")).toBeInTheDocument();
  });
  it("describes uncertain system state without claiming success", () => {
    model.rebuildStatus.systemUntouched = null;
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    expect(screen.getByText(/could not confirm whether changes/)).toBeInTheDocument();
    expect(screen.queryByText("No changes were made to your system.")).not.toBeInTheDocument();
  });
  it("shows the actual failure instead of unrelated hardcoded suggestions", () => {
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    expect(screen.getByText("Homebrew reconciliation failed")).toBeInTheDocument();
    expect(screen.queryByText("Stale flake inputs")).not.toBeInTheDocument();
  });
});

describe("complete failed-run log copying", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    model.rebuildStatus.isRunning = false;
    model.rebuildStatus.logFile = "/logs/failed.log";
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });
  it("copies every line and preserves whitespace beyond the UI buffer", async () => {
    const contents = Array.from({ length: 750 }, (_, i) => `  line ${i}\t`).join("\n") + "\n";
    readLog.mockResolvedValue(contents);
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await screen.findByText("Complete build log copied.");
    expect(readLog).toHaveBeenCalledWith({ logFile: "/logs/failed.log" });
    expect(writeText).toHaveBeenCalledWith(contents);
  });
  it("copies the new failed run after a completed retry", async () => {
    readLog.mockResolvedValueOnce("first run").mockResolvedValueOnce("retry run");
    const { rerender } = render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await screen.findByText("Complete build log copied.");
    model.rebuildStatus = { ...model.rebuildStatus, logFile: "/logs/retry.log" };
    rerender(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await screen.findByText("Complete build log copied.");
    expect(readLog).toHaveBeenLastCalledWith({ logFile: "/logs/retry.log" });
    expect(writeText).toHaveBeenLastCalledWith("retry run");
  });
  it("reports clipboard failure without claiming success", async () => {
    readLog.mockResolvedValue("the transcript");
    writeText.mockRejectedValueOnce(new Error("Clipboard permission denied"));
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await screen.findByText("Clipboard permission denied");
    expect(screen.queryByText("Complete build log copied.")).not.toBeInTheDocument();
  });
  it("does not copy an old transcript when a retry starts during the read", async () => {
    let resolve!: (text: string) => void;
    readLog.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    const { rerender } = render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    model.rebuildStatus = { ...model.rebuildStatus, isRunning: true, logFile: null };
    rerender(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    resolve("old run");
    await screen.findByText("The build changed. Copy the log from the completed build again.");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("does not fall back to displayed lines if the saved log is missing", async () => {
    model.rebuildStatus.logFile = null;
    render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
    await screen.findByText("The complete build log is unavailable.");
    expect(readLog).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("AI recovery eligibility", () => {
  it.each([
    ["evaluation_error", true, true],
    ["app_management", true, false],
    ["evaluation_error", false, false],
    [null, true, true],
  ])("class %s with inference %s shows action %s", (errorType, hasInference, visible) => {
    model.rebuildStatus.isRunning = false;
    model.rebuildStatus.errorType = errorType;
    render(<BuildStep hasInference={hasInference} onConfigureInference={vi.fn<() => void>()} />);
    const button = screen.queryByRole("button", { name: "Fix with AI" });
    expect(Boolean(button)).toBe(visible);
    fixWithAi.mockClear();
    if (button) fireEvent.click(button);
    expect(fixWithAi).toHaveBeenCalledTimes(visible ? 1 : 0);
  });
});

it("makes the existing review gate available after an AI fix", () => {
  model.evolve = { evolutionId: 42, step: "evolve" } as EvolveState;
  render(<BuildStep hasInference onConfigureInference={vi.fn<() => void>()} />);
  expect(screen.getByText("Review proposed fix")).toBeInTheDocument();
  model.evolve = null;
});
