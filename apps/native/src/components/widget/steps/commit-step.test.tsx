import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommitStep } from "@/components/widget/steps/commit-step";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { viewModelActions } from "@nixmac/state";

const handleRollback = vi.fn();

vi.mock("@/hooks/use-rollback", () => ({
  useRollback: () => ({ handleRollback }),
}));

vi.mock("@/components/widget/layout/merge-section", () => ({
  MergeSection: () => <div data-testid="merge-section" />,
}));

vi.mock("@/components/widget/summaries/summary-or-diff", () => ({
  SummaryOrDiff: () => <div data-testid="summary-or-diff" />,
}));

describe("CommitStep", () => {
  beforeEach(() => {
    handleRollback.mockReset();
    viewModelActions.setState({
      preferences: makeGlobalPreferences({ confirmRollback: true }),
    });
  });

  it("keeps the rollback confirmation dialog open after selecting Undo All", async () => {
    render(<CommitStep />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }));
    const undoAll = await screen.findByText("Undo All");

    fireEvent.click(undoAll);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("Discard changes and rebuild to previous commit?")).toBeInTheDocument();
    expect(handleRollback).not.toHaveBeenCalled();
  });

  it("runs rollback immediately when rollback confirmation is disabled", async () => {
    viewModelActions.setState({
      preferences: makeGlobalPreferences({ confirmRollback: false }),
    });
    render(<CommitStep />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }));
    const undoAll = await screen.findByText("Undo All");

    fireEvent.click(undoAll);

    expect(handleRollback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
