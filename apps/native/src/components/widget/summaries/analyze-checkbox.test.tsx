import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeCheckbox } from "@/components/widget/summaries/analyze-checkbox";
import type { BoolPrefKey } from "@/types/preferences";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { initialUiState, initialViewModelState, uiActions, viewModelActions } from "@nixmac/state";

const generateCurrentSummary = vi.fn<() => Promise<void>>();
const setPref = vi.fn<(key: BoolPrefKey, value: boolean) => Promise<void>>();

vi.mock("@/hooks/use-prefs", () => ({
  usePrefs: () => ({ setPref }),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({ generateCurrentSummary }),
}));

function setAutoAnalyze(autoSummarizeOnFocus: boolean) {
  viewModelActions.setState({
    ...initialViewModelState,
    preferences: makeGlobalPreferences({ autoSummarizeOnFocus }),
  });
}

describe("AnalyzeCheckbox", () => {
  beforeEach(() => {
    generateCurrentSummary.mockReset();
    setPref.mockReset();
    setPref.mockResolvedValue(undefined);
    uiActions.setState({ ...initialUiState });
  });

  it("analyzes when the drift review first loads with automatic analysis enabled", async () => {
    setAutoAnalyze(true);
    const { rerender } = render(<AnalyzeCheckbox />);

    await waitFor(() => expect(generateCurrentSummary).toHaveBeenCalledTimes(1));

    rerender(<AnalyzeCheckbox />);
    expect(generateCurrentSummary).toHaveBeenCalledTimes(1);
  });

  it("does not analyze a second time when enabling the preference is synchronized back to the view model", async () => {
    setAutoAnalyze(false);
    render(<AnalyzeCheckbox />);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(setPref).toHaveBeenCalledWith("autoSummarizeOnFocus", true);
    expect(generateCurrentSummary).toHaveBeenCalledTimes(1);

    await act(async () => setAutoAnalyze(true));
    await waitFor(() => expect(generateCurrentSummary).toHaveBeenCalledTimes(1));
  });
});
