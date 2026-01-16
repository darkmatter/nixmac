"use client";

import { AlertTriangle, CheckCircle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiStepLoaderInline } from "@/components/ui/multi-step-loader-overlay";
import type { RebuildErrorType, RebuildLine } from "@/stores/widget-store";

export interface RebuildStepProps {
  /** Whether the rebuild is currently running */
  isRunning: boolean;
  /** Lines of output to display */
  lines: RebuildLine[];
  /** Whether the rebuild succeeded */
  success?: boolean;
  /** Type of error if build failed */
  errorType?: RebuildErrorType;
  /** Error message to display */
  errorMessage?: string;
  /** Callback when user clicks rollback */
  onRollback?: () => void;
  /** Callback when user dismisses the error/success */
  onDismiss?: () => void;
}

/** Get a user-friendly title for the error type */
function getErrorTitle(errorType: RebuildErrorType | undefined): string {
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
function getErrorSuggestion(errorType: RebuildErrorType | undefined): string {
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

/**
 * Rebuild step shown inline in the widget during nix-rebuild switch.
 * Shows progress, success, or error states.
 */
export function RebuildStep({
  isRunning,
  lines,
  success,
  errorType,
  errorMessage,
  onRollback,
  onDismiss,
}: RebuildStepProps) {
  // Ensure we always have at least one line to display
  const displayLines =
    lines.length > 0
      ? lines
      : [{ id: 0, text: "🚀 Starting rebuild...", type: "info" as const }];

  // Step points to the current (most recent) line
  const step = isRunning
    ? Math.max(0, displayLines.length - 1)
    : displayLines.length;

  // Show error panel when build failed
  const showErrorPanel = !isRunning && success === false;
  // Show success panel when build succeeded
  const showSuccessPanel = !isRunning && success === true;

  if (showErrorPanel) {
    return (
      <div className="flex flex-col items-center gap-5 py-6">
        {/* Error Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
          <AlertTriangle className="h-7 w-7 text-red-400" />
        </div>

        {/* Error Title */}
        <h2 className="font-semibold text-lg text-white">
          {getErrorTitle(errorType)}
        </h2>

        {/* Error Message */}
        {errorMessage && (
          <p className="max-h-24 w-full overflow-y-auto rounded-lg bg-zinc-800/50 px-4 py-3 text-center font-mono text-xs text-zinc-400">
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
            size="sm"
            variant="outline"
          >
            <X className="mr-2 h-4 w-4" />
            Dismiss
          </Button>
          <Button
            className="flex-1 bg-red-600 text-white hover:bg-red-700"
            onClick={onRollback}
            size="sm"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Rollback
          </Button>
        </div>
      </div>
    );
  }

  if (showSuccessPanel) {
    return (
      <div className="flex flex-col items-center gap-5 py-6">
        {/* Success Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-lime-500/20">
          <CheckCircle className="h-7 w-7 text-lime-400" />
        </div>

        {/* Success Title */}
        <h2 className="font-semibold text-lg text-white">Rebuild Successful</h2>

        {/* Success Message */}
        <p className="text-center text-sm text-zinc-300">
          Your system configuration has been applied successfully.
        </p>

        {/* Dismiss Button */}
        <Button
          className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
          onClick={onDismiss}
          size="sm"
          variant="outline"
        >
          Continue
        </Button>
      </div>
    );
  }

  // Show loading state
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-4">
      <MultiStepLoaderInline
        className="min-h-[180px]"
        loadingStates={displayLines}
        step={step}
      />
    </div>
  );
}
