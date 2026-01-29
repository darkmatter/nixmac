"use client";

import { useWidgetStore } from "@/stores/widget-store";

/**
 * Error message component - displays errors from store.
 */
export function ErrorMessage() {
  const error = useWidgetStore((s) => s.error);
  const setError = useWidgetStore((s) => s.setError);

  if (!error) {
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
