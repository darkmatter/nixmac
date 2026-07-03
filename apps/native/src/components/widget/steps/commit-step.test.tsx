import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitStep } from "@/components/widget/steps/commit-step";

vi.mock("@/components/widget/layout/merge-section", () => ({
  MergeSection: () => <div data-testid="merge-section" />,
}));

vi.mock("@/components/widget/promptinput/prompt-input-section", () => ({
  PromptInputSection: () => <div data-testid="prompt-input-section" />,
}));

vi.mock("@/components/widget/summaries/summary-or-diff", () => ({
  SummaryOrDiff: ({
    actionSlot,
    onKeepChanges,
    onRefineFurther,
    undoLabel,
  }: {
    actionSlot: ReactNode;
    onKeepChanges: () => void;
    onRefineFurther: () => void;
    undoLabel: string;
  }) => (
    <div data-testid="summary-or-diff">
      <span>{undoLabel}</span>
      <button type="button" onClick={onKeepChanges}>
        Keep Changes
      </button>
      <button type="button" onClick={onRefineFurther}>
        Refine further
      </button>
      {actionSlot}
    </div>
  ),
}));

describe("CommitStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render the old activated-success header", () => {
    render(<CommitStep />);

    expect(screen.queryByText(/your changes have been activated successfully/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("summary-or-diff")).toBeInTheDocument();
  });

  it("hides the commit message section until selecting Keep Changes", () => {
    render(<CommitStep />);

    expect(screen.queryByTestId("merge-section")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /keep changes/i }));

    expect(screen.getByTestId("merge-section")).toBeInTheDocument();
  });

  it("shows the refine prompt after selecting Refine further", () => {
    render(<CommitStep />);

    fireEvent.click(screen.getByRole("button", { name: /refine further/i }));

    expect(screen.getByTestId("prompt-input-section")).toBeInTheDocument();
    expect(screen.queryByTestId("merge-section")).not.toBeInTheDocument();
  });

  it("uses the manual rollback label for manual commits", () => {
    render(<CommitStep isManual />);

    expect(screen.getByText("Undo last build")).toBeInTheDocument();
  });
});
