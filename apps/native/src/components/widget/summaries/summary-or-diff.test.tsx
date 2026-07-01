import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SummaryOrDiff } from "@/components/widget/summaries/summary-or-diff";
import type { EvolveState, GitStatus } from "@/ipc/types";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { initialViewModelState, viewModelActions } from "@nixmac/state";

const handleRollback = vi.fn();

vi.mock("@/hooks/use-rollback", () => ({
  useRollback: () => ({ handleRollback }),
}));

vi.mock("@/hooks/use-git-operations", () => ({
  prefetchFileDiffContents: vi.fn(),
}));

vi.mock("@/components/widget/drift/drift-summary-view", () => ({
  DriftSummaryView: () => <div data-testid="drift-summary-view" />,
}));

vi.mock("@/components/widget/drift/drift-file-row", () => ({
  DriftFileRow: ({ file, included }: { file: { filename: string }; included: boolean }) => (
    <li data-testid="drift-file-row" data-filename={file.filename} data-included={included} />
  ),
}));

const commitEvolveState: EvolveState = {
  evolutionId: 1,
  currentChangesetId: 2,
  committable: true,
  backupBranch: "backup",
  rollbackBranch: "rollback",
  rollbackStorePath: "/nix/store/old",
  rollbackChangesetId: 1,
  step: "commit",
  lastEvolutionState: null,
};

const gitWithChanges: GitStatus = {
  files: [],
  branch: "main",
  diff: "",
  additions: 1,
  deletions: 0,
  headCommitHash: null,
  cleanHead: false,
  changes: [
    { id: 1, hash: "h1", filename: "configuration.nix", diff: "", lineCount: 1, createdAt: 0, ownSummaryId: 0 },
  ],
};

function seedState(confirmRollback: boolean) {
  viewModelActions.setState({
    ...initialViewModelState,
    evolve: commitEvolveState,
    git: gitWithChanges,
    preferences: makeGlobalPreferences({ confirmRollback }),
  });
}

describe("SummaryOrDiff", () => {
  beforeEach(() => {
    handleRollback.mockReset();
  });

  it("opens the rollback confirmation dialog from the split-button menu", async () => {
    seedState(true);
    render(<SummaryOrDiff />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More change options" }));
    fireEvent.click(await screen.findByText("Undo Changes"));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText("Discard changes and rebuild to previous commit?")).toBeInTheDocument();
    expect(handleRollback).not.toHaveBeenCalled();
  });

  it("rolls back immediately when confirmation is disabled", async () => {
    seedState(false);
    render(<SummaryOrDiff undoLabel="Undo All" />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More change options" }));
    fireEvent.click(await screen.findByText("Undo All"));

    expect(handleRollback).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("invokes onKeepChanges from the primary CTA", () => {
    seedState(true);
    const onKeepChanges = vi.fn();
    render(<SummaryOrDiff onKeepChanges={onKeepChanges} />);

    fireEvent.click(screen.getByRole("button", { name: /keep changes/i }));

    expect(onKeepChanges).toHaveBeenCalledTimes(1);
  });

  it("replaces the CTA with the provided action slot", () => {
    seedState(true);
    render(<SummaryOrDiff actionSlot={<div data-testid="commit-message-slot" />} />);

    expect(screen.getByTestId("commit-message-slot")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /keep changes/i })).not.toBeInTheDocument();
  });

  it("invokes onRefineFurther from the menu", async () => {
    seedState(true);
    const onRefineFurther = vi.fn();
    render(<SummaryOrDiff onRefineFurther={onRefineFurther} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More change options" }));
    fireEvent.click(await screen.findByText("Refine further"));

    expect(onRefineFurther).toHaveBeenCalledTimes(1);
  });

  it("hides the actions when showActions is false", () => {
    seedState(true);
    render(<SummaryOrDiff showActions={false} />);

    expect(screen.queryByRole("button", { name: "More change options" })).not.toBeInTheDocument();
    expect(screen.queryByText("Keep Changes")).not.toBeInTheDocument();
  });
});
