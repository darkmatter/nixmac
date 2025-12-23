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
  cleaned = cleaned.slice(0, 300); // Limit length
  return cleaned;
}

/**
 * Get the display type for a line based on content
 */
export function getLineType(text: string): "stdout" | "stderr" | "info" {
  const lower = text.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("warning")) {
    return "stderr";
  }
  if (lower.includes("building") || lower.includes("copying") || lower.includes("activating")) {
    return "info";
  }
  return "stdout";
}

// Line normalizer that throttles lines for smooth display animation.
// Uses an interval to progressively show lines rather than all at once.
function useNormalizedLines(
  lines: RebuildLine[],
  isComplete: boolean,
): { lines: RebuildLine[]; step: number } {
  const tailLength = 3;
  const [displayedCount, setDisplayedCount] = useState(0);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // Use interval to progressively reveal lines
  useEffect(() => {
    if (isComplete) {
      // When complete, show all lines immediately
      setDisplayedCount(linesRef.current.length);
      return;
    }

    const intervalMs = 300; // Show a new line every 300ms
    const timer = setInterval(() => {
      setDisplayedCount((prev) => {
        const total = linesRef.current.length;
        if (prev < total) {
          return prev + 1;
        }
        return prev;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isComplete]);

  // Also update when new lines arrive (in case we've caught up)
  useEffect(() => {
    if (displayedCount >= lines.length && lines.length > 0) {
      // We've caught up, stay at current count
    }
  }, [lines.length, displayedCount]);

  const normalizedLines = lines.slice(0, displayedCount).map((line) => ({
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
    step: Math.max(0, displayLines.length - tailLength),
  };
}

/**
 * Full-screen overlay displayed during nix-rebuild switch.
 * Shows a semi-transparent background with centered console output.
 */
export function RebuildOverlay({ isRunning, lines, className }: RebuildOverlayProps) {
  // const scrollRef = useRef<HTMLDivElement>(null);
  const { lines: normalizedLines, step } = useNormalizedLines(lines, !isRunning);

  return (
    <div className={cn("fixed inset-0 flex items-center justify-center bg-black/50", className)}>
      <MultiStepLoader
        duration={2000}
        loading={isRunning}
        loadingStates={normalizedLines}
        step={step}
      />
      {/* {isRunning && (
            <button
              className="fixed top-4 right-4 text-black dark:text-white z-[120]"
              onClick={() => setDismissed(true)}
            >
              <IconSquareRoundedX className="h-10 w-10" />
            </button>
          )} */}
      {/* {isRunning ? (
            <>
              <div className="relative">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
              <h1 className="font-semibold text-white text-xl">
                Rebuilding System...
              </h1>
            </>
          ) : success ? (
            <>
              <svg
                className="h-6 w-6 text-lime-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  clipRule="evenodd"
                  d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
                  fillRule="evenodd"
                />
              </svg>
              <h1 className="font-semibold text-white text-xl">
                Rebuild Complete
              </h1>
            </>
          ) : (
            <>
              <svg
                className="h-6 w-6 text-red-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  clipRule="evenodd"
                  d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z"
                  fillRule="evenodd"
                />
              </svg>
              <h1 className="font-semibold text-white text-xl">
                Rebuild Failed
              </h1>
            </>
          )} */}
      {/* Console output */}
      {/* <div
        className="max-h-32 w-full max-w-144 overflow-y-auto rounded-lg border border-white/10 bg-gray-950/60 p-4 font-mono text-xs opacity-80 backdrop-blur-sm"
        ref={scrollRef}
      >
        {lines.length === 0 ? (
          <div className="text-white/40">Waiting for output...</div>
        ) : (
          lines.map((line, i) => (
            <div
              className={cn(
                "leading-relaxed",
                line.type === "stderr" && "text-rose-400/50",
                line.type === "info" && "text-teal-400/50",
                line.type === "stdout" && "text-white/60",
                i === lines.length - 1 && "mt-2 mb-2 text-white"
              )}
              key={line.id}
            >
              {line.text}
            </div>
          ))
        )}
      </div> */}
      {/* <div className="mx-8 flex w-full max-w-2xl flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <MultiStepLoader loadingStates={normalizedLines} step={step} loading={isRunning && !dismissed} duration={2000} />

        </div>
      </div> */}
    </div>
  );
}
