"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useWidgetStore } from "@/stores/widget-store";
import { DebugOverlay } from "./debug-overlay";

/**
 * Console component that displays logs from operations.
 */
export function Console() {
  const [expanded, setExpanded] = useState(false);
  const logs = useWidgetStore((s) => s.consoleLogs);

  return (
    <div className="flex flex-col border-border border-t">
      <button
        className="flex items-center justify-between px-4 py-2 text-muted-foreground text-xs transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="font-medium">Console</span>
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>

      {expanded && (
        <div className="flex max-h-40 flex-col bg-black/40">
          {/* Debug Info */}
          <div className="relative border-yellow-500/30 border-b">
            <DebugOverlay />
          </div>

          {/* Logs */}
          <div className="flex-1 overflow-auto p-3 pt-6">
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-green-300/90">
              {logs || "No output yet..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
