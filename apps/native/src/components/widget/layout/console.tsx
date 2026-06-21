"use client";

import { ChevronDown, ChevronUp, GripHorizontal } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { useUiState } from "@nixmac/state";
import { DebugOverlay } from "@/components/widget/layout/debug-overlay";

/** Minimum console height in pixels. */
const CONSOLE_MIN_HEIGHT = 32;
/** Default console height when first expanded (px). */
const CONSOLE_DEFAULT_HEIGHT = 160;
/** Maximum console height as fraction of parent (0.0 – 1.0). */
const CONSOLE_MAX_RATIO = 0.7;
/** Movement beyond this threshold (px) counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

/**
 * Console component that displays logs from operations.
 *
 * When collapsed, only the header bar is visible. When expanded, the
 * console area can be resized by dragging the header bar up or down.
 */
export function Console() {
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(CONSOLE_DEFAULT_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const logs = useUiState((s) => s.consoleLogs);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!expanded) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = height;
      didDragRef.current = false;

      const container = containerRef.current?.parentElement;
      const maxH = container
        ? Math.floor(container.getBoundingClientRect().height * CONSOLE_MAX_RATIO)
        : 600;

      const onMove = (ev: PointerEvent) => {
        if (Math.abs(ev.clientY - startY) > DRAG_THRESHOLD) {
          didDragRef.current = true;
        }
        // Dragging UP increases height (startY - ev.clientY > 0)
        const next = Math.min(maxH, Math.max(CONSOLE_MIN_HEIGHT, startH + (startY - ev.clientY)));
        setHeight(next);
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [expanded, height],
  );

  const handleClick = useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div ref={containerRef} className="flex shrink-0 flex-col border-border border-t">
      <div
        className={`flex items-center justify-between px-4 py-2 text-muted-foreground text-xs transition-colors hover:bg-muted/50 hover:text-foreground ${expanded ? "cursor-row-resize" : "cursor-pointer"}`}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <span className="flex items-center gap-1.5 font-medium">
          {expanded && <GripHorizontal className="h-3 w-3 opacity-40" />}
          Console
        </span>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </div>

      {expanded && (
        <div className="flex flex-col bg-black/40" style={{ height }}>
          {/* Debug Info */}
          <div className="relative shrink-0 border-b border-yellow-500/30">
            <DebugOverlay />
          </div>

          {/* Logs */}
          <div className="min-h-0 flex-1 overflow-auto p-3 pt-6">
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-green-300/90">
              {logs || "No output yet..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
