import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiStepLoader } from "@/components/ui/multi-step-loader-overlay";
import { cn } from "@/lib/utils";

export type ErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "generic_error";

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
  /** Type of error if build failed */
  errorType?: ErrorType;
  /** Error message to display */
  errorMessage?: string;
  /** Callback when user clicks rollback */
  onRollback?: () => void;
  /** Callback when user dismisses the error */
  onDismiss?: () => void;
}

/** Get a user-friendly title for the error type */
function getErrorTitle(errorType: ErrorType | undefined): string {
  switch (errorType) {
    case "infinite_recursion":
      return "Infinite Recursion Detected";
    case "evaluation_error":
      return "Nix Evaluation Error";
    case "build_error":
      return "Build Failed";
    default:
      return "Build Failed";
  }
}

/** Get helpful suggestion text for the error type */
function getErrorSuggestion(errorType: ErrorType | undefined): string {
  switch (errorType) {
    case "infinite_recursion":
      return "Your configuration has a circular dependency. Rolling back will restore your previous working configuration.";
    case "evaluation_error":
      return "There's a syntax or evaluation error in your Nix files. Check the error message for details.";
    case "build_error":
      return "A package failed to build. You may need to update your flake or fix the package configuration.";
    default:
      return "The build encountered an error. You can rollback to your previous configuration or dismiss to investigate.";
  }
}

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
    "g"
  );
  return str.replace(pattern, "");
}

/**
 * Normalize console output for display
 * Note: With AI summarization, this is mostly a safety net
 */
export function normalizeOutput(raw: string): string {
  let cleaned = stripAnsi(raw);
  cleaned = cleaned.replace(/\r/g, "");
  cleaned = cleaned.trimEnd();
  return cleaned;
}

/**
 * Get the display type for a line based on content
 * Note: With AI summarization, most lines come as "info" type
 */
export function getLineType(text: string): "stdout" | "stderr" | "info" {
  const lower = text.toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("❌")
  ) {
    return "stderr";
  }
  if (
    lower.includes("building") ||
    lower.includes("copying") ||
    lower.includes("activating") ||
    lower.includes("🚀") ||
    lower.includes("📦") ||
    lower.includes("🔨") ||
    lower.includes("⚡") ||
    lower.includes("🔍") ||
    lower.includes("✅")
  ) {
    return "info";
  }
  return "stdout";
}

/**
 * Full-screen overlay displayed during nix-rebuild switch.
 * Shows a semi-transparent background with centered console output.
 *
 * Lines are now pre-summarized by the server-side AI at ~500ms intervals,
 * so no client-side rate limiting is needed.
 */
export function RebuildOverlay({
  isRunning,
  lines,
  className,
  success,
  errorType,
  errorMessage,
  onRollback,
  onDismiss,
}: RebuildOverlayProps) {
  // Ensure we always have at least one line to display
  const displayLines =
    lines.length > 0
      ? lines
      : [{ id: 0, text: "🚀 Starting rebuild...", type: "info" as const }];

  // Step points to the current (most recent) line
  // - While running: last line is "in progress", previous lines are "completed"
  // - When complete: all lines are "completed" (step past the end)
  const step = isRunning
    ? Math.max(0, displayLines.length - 1)
    : displayLines.length;

  // Show error panel when build failed
  const showErrorPanel = !isRunning && success === false;

  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-black/50",
        className
      )}
    >
      {showErrorPanel ? (
        <div className="mx-4 flex max-w-lg flex-col items-center gap-6 rounded-2xl border border-red-500/30 bg-zinc-900/95 p-8 shadow-2xl backdrop-blur-xl">
          {/* Error Icon */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>

          {/* Error Title */}
          <h2 className="font-semibold text-white text-xl">
            {getErrorTitle(errorType)}
          </h2>

          {/* Error Message */}
          {errorMessage && (
            <p className="max-h-32 w-full overflow-y-auto rounded-lg bg-zinc-800/50 px-4 py-3 text-center font-mono text-sm text-zinc-400">
              {errorMessage}
            </p>
          )}

          {/* Suggestion */}
          <p className="text-center text-sm text-zinc-300">
            {getErrorSuggestion(errorType)}
          </p>

          {/* Action Buttons */}
          <div className="flex w-full gap-3">
            <Button
              className="flex-1 border-zinc-600 text-zinc-300 hover:bg-zinc-800"
              onClick={onDismiss}
              variant="outline"
            >
              <X className="mr-2 h-4 w-4" />
              Dismiss
            </Button>
            <Button
              className="flex-1 bg-red-600 text-white hover:bg-red-700"
              onClick={onRollback}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Rollback Changes
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <MultiStepLoader
            loading={isRunning}
            loadingStates={displayLines}
            step={step}
          />
        </div>
      )}
    </div>
  );
}
