import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { viewModelActions } from "@nixmac/state";
import type { HomebrewState } from "@/ipc/types";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { HomebrewBadge } from "./homebrew-badge";

const { applyDiff, useHomebrewDiffMock } = vi.hoisted(() => ({
  applyDiff: vi.fn(),
  useHomebrewDiffMock: vi.fn(),
}));

vi.mock("@/hooks/use-homebrew-diff", () => ({
  countDiffItems: (d: HomebrewState) => d.casks.length + d.brews.length + d.taps.length,
  useHomebrewDiff: () => useHomebrewDiffMock(),
}));

const beginState = {
  evolutionId: null,
  currentChangesetId: null,
  committable: false,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "begin" as const,
};

const diff: HomebrewState = {
  isInstalled: true,
  taps: ["homebrew/cask-fonts"],
  brews: ["jq", "ripgrep"],
  casks: ["rectangle"],
  writeTarget: ".nixmac/homebrew/data.json",
  lastChecked: 0,
};

function mockHook(overrides: Record<string, unknown> = {}) {
  useHomebrewDiffMock.mockReturnValue({
    diff,
    hasDiff: true,
    isLoading: false,
    isApplying: false,
    error: null,
    refresh: vi.fn(),
    applyDiff,
    ...overrides,
  });
}

describe("HomebrewBadge", () => {
  beforeEach(() => {
    applyDiff.mockReset();
    useHomebrewDiffMock.mockReset();
    viewModelActions.setState({
      evolve: beginState,
      preferences: makeGlobalPreferences({ scanHomebrewOnStartup: true }),
    });
    mockHook();
  });

  it("renders a checkbox per untracked item, all selected by default", () => {
    render(<HomebrewBadge />);
    fireEvent.click(screen.getByTestId("managed-homebrew-badge"));

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4); // 1 tap + 2 brews + 1 cask
    for (const cb of checkboxes) {
      expect(cb).toBeChecked();
    }
    // Fully selected → no warning, default button label.
    expect(screen.queryByTestId("managed-homebrew-partial-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("managed-homebrew-add-to-config")).toHaveTextContent("Add to config");
  });

  it("warns and adjusts the button when only a subset is selected", () => {
    render(<HomebrewBadge />);
    fireEvent.click(screen.getByTestId("managed-homebrew-badge"));

    // Uncheck "jq".
    fireEvent.click(screen.getByLabelText("jq"));

    expect(screen.getByTestId("managed-homebrew-partial-warning")).toBeInTheDocument();
    expect(screen.getByTestId("managed-homebrew-add-to-config")).toHaveTextContent("Add 3 to config");
  });

  it("applies only the selected items", () => {
    render(<HomebrewBadge />);
    fireEvent.click(screen.getByTestId("managed-homebrew-badge"));

    fireEvent.click(screen.getByLabelText("jq"));
    fireEvent.click(screen.getByTestId("managed-homebrew-add-to-config"));

    expect(applyDiff).toHaveBeenCalledTimes(1);
    expect(applyDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        taps: ["homebrew/cask-fonts"],
        brews: ["ripgrep"],
        casks: ["rectangle"],
      }),
    );
  });

  it("disables the apply button when nothing is selected", () => {
    render(<HomebrewBadge />);
    fireEvent.click(screen.getByTestId("managed-homebrew-badge"));

    for (const item of ["homebrew/cask-fonts", "jq", "ripgrep", "rectangle"]) {
      fireEvent.click(screen.getByLabelText(item));
    }

    expect(screen.getByTestId("managed-homebrew-add-to-config")).toBeDisabled();
  });
});
