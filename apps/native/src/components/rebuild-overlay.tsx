import { useEffect, useRef, useState } from "react";
import { MultiStepLoader } from "@/components/ui/multi-step-loader-overlay";
import { cn } from "@/lib/utils";

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

export interface RebuildOverlayProps {
  /** Whether the rebuild is currently running */
  isRunning: boolean;
  /** Lines of output to display */
  lines: RebuildLine[];
  /** Exit code when complete */
  exitCode?: number;
  /** Whether the rebuild succeeded */
  success?: boolean;
  /** Optional className for the container */
  className?: string;
}

// ============================================================================
// CONFIGURABLE CONSTANTS
// ============================================================================

/** Minimum interval between displaying new lines (in ms) - rate limiting */
const RATE_LIMIT_INTERVAL_MS = 250;

/** Number of characters to compare for duplicate detection */
const DUPLICATE_PREFIX_LENGTH = 30;

/** Maximum characters to display per line */
const MAX_LINE_LENGTH = 300;

/** Number of lines to show as "pending" below current */
const TAIL_LENGTH = 5;

// ============================================================================

/**
 * Strip ANSI escape codes from a string.
 * ESC (0x1B) and CSI (0x9B) are the start of ANSI sequences.
 */
export function stripAnsi(str: string): string {
  const ESC = String.fromCharCode(0x1b);
  const CSI = String.fromCharCode(0x9b);
  const pattern = new RegExp(
    `[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]`,
    "g",
  );
  return str.replace(pattern, "");
}

/**
 * Normalize console output for display
 */
export function normalizeOutput(raw: string): string {
  let cleaned = stripAnsi(raw);
  cleaned = cleaned.replace(/\r/g, "");
  cleaned = cleaned.trimEnd();
  cleaned = cleaned.slice(0, MAX_LINE_LENGTH);
  return cleaned;
}

/**
 * Get the display type for a line based on content
 */
export function getLineType(text: string): "stdout" | "stderr" | "info" {
  const lower = text.toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("warning")
  ) {
    return "stderr";
  }
  if (
    lower.includes("building") ||
    lower.includes("copying") ||
    lower.includes("activating")
  ) {
    return "info";
  }
  return "stdout";
}

/**
 * Check if two lines are duplicates based on their first N characters
 */
function isDuplicateLine(
  line1: string,
  line2: string,
  prefixLength: number,
): boolean {
  const prefix1 = line1.slice(0, prefixLength);
  const prefix2 = line2.slice(0, prefixLength);
  return prefix1 === prefix2;
}

/**
 * Filter out duplicate lines based on prefix comparison
 */
function deduplicateLines(
  lines: RebuildLine[],
  prefixLength: number,
): RebuildLine[] {
  if (lines.length === 0) return lines;

  const result: RebuildLine[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const currentText = normalizeOutput(lines[i].text);
    const previousText = normalizeOutput(lines[i - 1].text);

    if (!isDuplicateLine(currentText, previousText, prefixLength)) {
      result.push(lines[i]);
    }
  }

  return result;
}

// Line normalizer that throttles lines for smooth display animation.
// Uses an interval to progressively show lines rather than all at once.
// Includes rate limiting and duplicate detection.
function useNormalizedLines(
  lines: RebuildLine[],
  isComplete: boolean,
): { lines: RebuildLine[]; step: number } {
  const [displayedCount, setDisplayedCount] = useState(0);
  const linesRef = useRef(lines);
  const lastUpdateTimeRef = useRef(0);
  const pendingUpdateRef = useRef<NodeJS.Timeout | null>(null);

  // First deduplicate the lines based on prefix
  const deduplicatedLines = deduplicateLines(lines, DUPLICATE_PREFIX_LENGTH);
  linesRef.current = deduplicatedLines;

  // Rate-limited interval to progressively reveal lines
  useEffect(() => {
    if (isComplete) {
      // When complete, show all lines immediately
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
      setDisplayedCount(linesRef.current.length);
      return;
    }

    const scheduleUpdate = () => {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

      if (timeSinceLastUpdate >= RATE_LIMIT_INTERVAL_MS) {
        // Enough time has passed, update immediately
        setDisplayedCount((prev) => {
          const total = linesRef.current.length;
          if (prev < total) {
            lastUpdateTimeRef.current = now;
            return prev + 1;
          }
          return prev;
        });
      } else {
        // Schedule update for when rate limit allows
        if (pendingUpdateRef.current) {
          clearTimeout(pendingUpdateRef.current);
        }
        const delay = RATE_LIMIT_INTERVAL_MS - timeSinceLastUpdate;
        pendingUpdateRef.current = setTimeout(() => {
          pendingUpdateRef.current = null;
          lastUpdateTimeRef.current = Date.now();
          setDisplayedCount((prev) => {
            const total = linesRef.current.length;
            if (prev < total) {
              return prev + 1;
            }
            return prev;
          });
        }, delay);
      }
    };

    // Check periodically if we have more lines to display
    const timer = setInterval(() => {
      const total = linesRef.current.length;
      if (displayedCount < total) {
        scheduleUpdate();
      }
    }, RATE_LIMIT_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      if (pendingUpdateRef.current) {
        clearTimeout(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, [isComplete, displayedCount]);

  // Reset displayed count when lines change significantly (e.g., new rebuild)
  useEffect(() => {
    if (deduplicatedLines.length === 0) {
      setDisplayedCount(0);
    }
  }, [deduplicatedLines.length]);

  const normalizedLines = deduplicatedLines
    .slice(0, displayedCount)
    .map((line) => ({
      ...line,
      text: normalizeOutput(line.text),
    }));

  // Always show at least a "starting" message so the loader has something to display
  const displayLines =
    normalizedLines.length > 0
      ? normalizedLines
      : [{ id: 0, text: "Starting rebuild...", type: "info" as const }];

  if (isComplete) {
    return { lines: displayLines, step: displayLines.length };
  }
  return {
    lines: displayLines,
    step: Math.max(0, displayLines.length - TAIL_LENGTH),
  };
}

/**
 * Full-screen overlay displayed during nix-rebuild switch.
 * Shows a semi-transparent background with centered console output.
 */
export function RebuildOverlay({
  isRunning,
  lines,
  className,
}: RebuildOverlayProps) {
  const { lines: normalizedLines, step } = useNormalizedLines(
    lines,
    !isRunning,
  );

  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-black/50",
        className,
      )}
    >
      <div className="flex items-center justify-center w-full h-full">
        <MultiStepLoader
          duration={2000}
          loading={isRunning}
          loadingStates={normalizedLines}
          step={step}
        />
      </div>
    </div>
  );
}
