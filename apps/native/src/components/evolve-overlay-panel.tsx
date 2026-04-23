"use client";

import { EvolveProgress } from "@/components/evolve-progress";
import { isE2eProofMode } from "@/utils/e2e-proof-mode";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";

/**
 * Overlay panel that shows evolution progress.
 * Appears when isGenerating is true and dismisses when evolution completes.
 */
export function EvolveOverlayPanel() {
  const isGenerating = useWidgetStore((s) => s.isGenerating);
  const evolveEvents = useWidgetStore((s) => s.evolveEvents);

  const handleStopEvolution = async () => {
    try {
      await darwinAPI.darwin.evolveCancel();
      useWidgetStore.setState({ isGenerating: false, evolveEvents: [] });
    } catch (e) {
      console.error("Failed to cancel evolution:", e);
    }
  };

  // Only show when actively generating
  if (!isGenerating) {
    return null;
  }

  return (
    <div
      className={
        isE2eProofMode
          ? "fixed inset-y-8 w-full max-w-[100vw] z-10 flex items-center justify-center bg-background"
          : "fixed inset-y-8 w-full max-w-[100vw] z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm"
      }
    >
      <div className="h-full w-full max-h-[600px] max-w-[800px]">
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-2xl p-6"
        >
          {/* Progress */}
          <div className="min-h-0 flex-1">
            <EvolveProgress
              className="h-full rounded-lg border border-border bg-muted/20"
              events={evolveEvents}
              isGenerating={isGenerating}
              onStop={handleStopEvolution}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
