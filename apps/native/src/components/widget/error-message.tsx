"use client";

import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";

/**
 * Error message component - displays errors from store.
 * Filters out certain errors based on context (e.g., expected errors during setup).
 */
export function ErrorMessage() {
  const error = useWidgetStore((s) => s.error);
  const setError = useWidgetStore((s) => s.setError);
  const step = useCurrentStep();

  // Suppress expected errors during setup (no flake.nix yet)
  const isSupressedError =
    step === "setup" && error?.includes("Failed to list hosts: path") ||
    step === "evolving" && error?.includes("cancelled by user");

  if (!error || isSupressedError) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-400 text-sm">
      {error}
      <button
        className="ml-2 text-red-300 underline"
        onClick={() => setError(null)}
        type="button"
      >
        dismiss
      </button>
    </div>
  );
}
