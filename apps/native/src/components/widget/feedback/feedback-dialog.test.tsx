import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWidgetStore } from "@/stores/widget-store";
import { FeedbackType } from "@/types/feedback";
import { FeedbackDialog } from "./feedback-dialog";

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    feedback: {
      gatherMetadata: vi.fn<() => Promise<null>>(),
      submit: vi.fn<() => Promise<boolean>>(),
    },
    promptHistory: {
      get: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
    },
  },
}));

describe("FeedbackDialog focus ring buffers", () => {
  it("keeps focus-ring paint inside scrollable dialog containers", async () => {
    useWidgetStore.getState().openFeedback(FeedbackType.Issue);

    render(<FeedbackDialog />);

    const textarea = await screen.findByLabelText("DESCRIBE WHAT HAPPENED");
    const dialogBody = textarea.closest(".overflow-y-auto");

    expect(dialogBody).toHaveClass("pl-1", "py-1", "pr-3");

    const shareCheckbox = screen.getByRole("checkbox", { name: "Current app state" });
    const shareOptions = shareCheckbox.closest(".overflow-y-auto");

    expect(shareOptions).toHaveClass("pl-1", "py-1", "pr-2");
  });
});
