"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { usePrefs } from "@/hooks/use-prefs";
import { useSummary } from "@/hooks/use-summary";
import { useUiState, useViewModel } from "@nixmac/state";
import { Loader2 } from "lucide-react";

/**
 * "Analyze automatically" toggle. Bound to the `autoSummarizeOnFocus`
 * preference: when enabled, changes are summarized automatically (and we kick
 * one off immediately) so the user doesn't have to click Analyze each time.
 */
export function AnalyzeCheckbox() {
  const autoAnalyze = useViewModel((s) => s.preferences?.autoSummarizeOnFocus ?? false);
  const isSummarizing = useUiState((s) => s.isSummarizing);
  const { setPref } = usePrefs();
  const { generateCurrentSummary } = useSummary();

  const handleToggle = (checked: boolean) => {
    void setPref("autoSummarizeOnFocus", checked);
    // Enabling should analyze the current changes right away, not just future ones.
    if (checked) void generateCurrentSummary();
  };

  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-300">
      <Checkbox
        checked={autoAnalyze}
        onCheckedChange={(v) => handleToggle(v === true)}
        disabled={isSummarizing}
        className="size-3.5"
      />
      {isSummarizing ? (
        <span className="flex items-center gap-1">
          <Loader2 className="h-[10px] w-[10px] animate-spin" />
          Analyzing…
        </span>
      ) : (
        "Analyze automatically"
      )}
    </label>
  );
}
