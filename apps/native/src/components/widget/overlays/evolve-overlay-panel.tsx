"use client";

import { useEffect, useRef, useState } from "react";
import { EvolveProgress } from "@/components/widget/overlays/evolve-progress";
import { uiActions, useUiState } from "@nixmac/state";
import { useViewModel } from "@nixmac/state";
import { clearEvolveEvents } from "@/viewmodel/evolution";
import { client } from "@/lib/orpc";

/** How long the completed view lingers before the overlay dismisses. */
export const COMPLETION_BEAT_MS = 800;

/**
 * Overlay panel that shows evolution progress.
 * Appears when isGenerating is true and dismisses when evolution completes,
 * lingering briefly on the completed state so success registers before the
 * review step appears.
 */
export function EvolveOverlayPanel() {
  const isGenerating = useUiState((s) => s.isGenerating);
  const evolveEvents = useViewModel((s) => s.evolveEvents);

  // Completion beat (design §4.3): when the run ends with a terminal
  // `complete` event, hold the green-check header for a moment instead of
  // vanishing the instant isGenerating flips. Cancellations clear the event
  // buffer, so they still dismiss immediately, as does prefers-reduced-motion.
  const completed = evolveEvents[evolveEvents.length - 1]?.eventType === "complete";
  const [lingering, setLingering] = useState(false);
  const wasGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    wasGeneratingRef.current = isGenerating;
    if (!wasGenerating || isGenerating || !completed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setLingering(true);
    const id = setTimeout(() => setLingering(false), COMPLETION_BEAT_MS);
    return () => clearTimeout(id);
  }, [isGenerating, completed]);

  const handleStopEvolution = async () => {
    try {
      await client.darwin.evolveCancel();
      uiActions.setState({ isGenerating: false });
      clearEvolveEvents();
    } catch (e) {
      console.error("Failed to cancel evolution:", e);
    }
  };

  if (!isGenerating && !lingering) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="h-full w-full max-h-[600px] max-w-[800px]">
        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl p-6">
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
