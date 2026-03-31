"use client";

import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useState } from "react";
import { GitStatusDebug } from "./git-status-debug";

/**
 * Debug overlay for development - shows current widget state
 */
export function DebugOverlay() {
  const evolveState = useWidgetStore((s) => s.evolveState);
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return (
      <div className="pointer-events-auto absolute top-2 right-4 z-50">
        <button
          className="rounded bg-black/80 px-2 py-1 font-mono text-xs text-yellow-400/60 hover:text-yellow-400"
          onClick={() => setVisible(true)}
          style={{ backdropFilter: "blur(4px)" }}
          type="button"
        >
          show
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute top-2 right-4 z-50 flex items-start gap-1">
      <div
        className="rounded bg-black/80 px-2 py-1 font-mono text-xs text-yellow-400"
        style={{ backdropFilter: "blur(4px)" }}
      >
        {evolveState && (
          <div className="mt-0.5 text-yellow-400/70">
            routing: {evolveState.step}
            {evolveState.committable && " ✓committable"}
            {!evolveState.committable && " ✗non-committable"}
            {evolveState.evolutionId !== null && ` eid:${evolveState.evolutionId}`}
          </div>
        )}
      </div>
      <div className="pointer-events-auto">
        <GitStatusDebug />
      </div>
      <button
        className="pointer-events-auto rounded bg-black/80 px-2 py-1 font-mono text-xs text-teal-400/60 hover:text-teal-400"
        onClick={() => darwinAPI.summarizedChanges.summarizeCurrent().then(() => console.log("[summarize_current] done"))}
        style={{ backdropFilter: "blur(4px)" }}
        type="button"
      >
        scm
      </button>
      <button
        className="pointer-events-auto rounded bg-black/80 px-2 py-1 font-mono text-xs text-yellow-400/60 hover:text-yellow-400"
        onClick={() => setVisible(false)}
        style={{ backdropFilter: "blur(4px)" }}
        type="button"
      >
        x
      </button>
    </div>
  );
}
