import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DriftReviewActions } from "./drift-review-actions";

vi.mock("@/components/widget/controls/confirm-button", () => ({
  ConfirmButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

const props = {
  buildChecking: false,
  buildCheckFailed: false,
  buildReady: true,
  isApplyBusy: false,
  isManualDrift: false,
  onApply: vi.fn<() => void>(),
  onRefineWithAi: vi.fn<() => void>(),
  onRequestDiscard: vi.fn<() => void>(),
  rebuildRunning: false,
};

it("omits unsupported prompt navigation while keeping review actions", () => {
  render(<DriftReviewActions {...props} />);
  expect(screen.queryByRole("button", { name: "Back to Prompt" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Build & Test" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
});

it("preserves prompt navigation when the host supports it", () => {
  const onBackToPrompt = vi.fn<() => void>();
  render(<DriftReviewActions {...props} onBackToPrompt={onBackToPrompt} />);
  fireEvent.click(screen.getByRole("button", { name: "Back to Prompt" }));
  expect(onBackToPrompt).toHaveBeenCalledOnce();
});
