"use client";

import { Button } from "@/components/ui/button";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { FeedbackType } from "@/types/feedback";

/**
 * Error message component - displays errors from store.
 * Filters out certain errors based on context (e.g., expected errors during setup).
 */
export function ErrorMessage() {
  const error = useWidgetStore((s) => s.error);
  const setError = useWidgetStore((s) => s.setError);
  const openFeedback = useWidgetStore((s) => s.openFeedback);
  const step = useCurrentStep();

  // Suppress expected errors during setup (no flake.nix yet)
  const isSupressedError =
    (step === "setup" && error?.includes("Failed to list hosts: path")) ||
    (step === "evolving" && error?.includes("cancelled by user"));

  if (!error || isSupressedError) {
    return null;
  }

  return (
    <div
      className="mx-auto max-w-2xl rounded-lg border
     border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
    >
      <div className="whitespace-pre-wrap break-words">{error}</div>{" "}
      <Button
        variant="link"
        size="sm"
        className="ml-2 h-auto p-0 text-red-300 underline text-xs -translate-y-[1px]"
        onClick={() => openFeedback(FeedbackType.Error, error)}
        type="button"
      >
        Report Error
      </Button>{" "}
      <Button
        variant="link"
        size="sm"
        className="ml-2 h-auto p-0 text-red-300 underline text-xs -translate-y-[1px]"
        onClick={() => setError(null)}
        type="button"
      >
        Dismiss
      </Button>
    </div>
  );
}
