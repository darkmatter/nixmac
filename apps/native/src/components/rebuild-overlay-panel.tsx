import {
  AlertTriangle,
  RotateCcw,
  X,
  Terminal,
  List,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useState, useRef, useEffect } from "react";
import { useRebuild } from "@/hooks/use-rebuild";
import {
  useWidgetStore,
  type RebuildLine,
  type RebuildErrorType,
} from "@/stores/widget-store";

/** Get a user-friendly title for the error type */
function getErrorTitle(errorType: RebuildErrorType | undefined): string {
  switch (errorType) {
    case "infinite_recursion":
      return "Infinite Recursion Detected";
    case "evaluation_error":
      return "Nix Evaluation Error";
    case "build_error":
      return "Build Failed";
    case "full_disk_access":
      return "Full Disk Access Required";
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
    case "full_disk_access":
      return "darwin-rebuild requires Full Disk Access to apply system changes. Grant access in System Settings → Privacy & Security → Full Disk Access.";
    default:
      return "The build encountered an error. You can rollback to your previous configuration or dismiss to investigate.";
  }
}

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={cn("h-5 w-5", className)}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const CheckFilled = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={cn("h-5 w-5", className)}
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
      fillRule="evenodd"
    />
  </svg>
);


const SkeletonLine = ({ width = "w-32" }: { width?: string }) => (
  <div className={cn("h-3 animate-pulse rounded bg-white/20", width)} />
);

function LoaderCore({
  loadingStates,
  value = 0,
  pendingCount = 3,
}: {
  loadingStates: RebuildLine[];
  value?: number;
  pendingCount?: number;
}) {
  const skeletonWidths = ["w-24", "w-32", "w-28"];
  const itemHeight = 36;

  // Find the index of the most recently completed step (one before current)
  const mostRecentlyCompletedIndex = value > 0 ? value - 1 : -1;

  // Calculate the center point for the gradient (current item position, shifted up by 1 to center the green item)
  const centerY = value * itemHeight + itemHeight / 2 - itemHeight;
  const gradientRange = itemHeight * 3; // How many items to show clearly

  return (
    <div className="relative flex w-full flex-col items-center">
      <div
        className="relative w-full max-w-xs"
        style={{
          minHeight: `${(loadingStates.length + pendingCount) * itemHeight}px`,
          maskImage: `linear-gradient(to bottom,
            transparent 0%,
            rgba(0,0,0,0.3) ${Math.max(0, centerY - gradientRange)}px,
            rgba(0,0,0,1) ${centerY}px,
            rgba(0,0,0,0.3) ${centerY + gradientRange}px,
            transparent 100%
          )`,
          WebkitMaskImage: `linear-gradient(to bottom,
            transparent 0%,
            rgba(0,0,0,0.3) ${Math.max(0, centerY - gradientRange)}px,
            rgba(0,0,0,1) ${centerY}px,
            rgba(0,0,0,0.3) ${centerY + gradientRange}px,
            transparent 100%
          )`,
        }}
      >
        {loadingStates.map((loadingState, index) => {
          const distance = index - value;
          const opacity =
            distance < 0
              ? Math.max(1 - Math.abs(distance) * 0.15, 0.4)
              : Math.max(1 - distance * 0.3, 0.25);

          const isCompleted = index < value;
          const isMostRecentlyCompleted = index === mostRecentlyCompletedIndex;

          // Only the most recently completed step gets green
          let checkClass = "text-white/40";
          if (isMostRecentlyCompleted) {
            checkClass = "text-lime-400";
          }

          // Text coloring: only most recently completed is green
          let textClass = "text-white/50";
          if (isMostRecentlyCompleted) {
            textClass = "text-lime-400 font-medium";
          }

          const y = index * itemHeight;

          return (
            <motion.div
              animate={{ opacity, y }}
              className="absolute right-0 left-0 flex items-center gap-3 px-2"
              initial={{ opacity: 0, y: y + 8 }}
              key={loadingState.id}
              transition={{
                y: {
                  type: "spring",
                  stiffness: 120,
                  damping: 20,
                  mass: 1,
                },
                opacity: {
                  duration: 0.4,
                  ease: [0.4, 0, 0.2, 1],
                },
              }}
            >
              <motion.div
                className="shrink-0"
                initial={false}
                animate={{
                  scale: isMostRecentlyCompleted ? 1.15 : 1,
                }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                }}
              >
                {isCompleted ? (
                  <CheckFilled className={checkClass} />
                ) : (
                  <CheckIcon className={checkClass} />
                )}
              </motion.div>
              <span
                className={cn(
                  textClass,
                  "block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-normal transition-colors duration-500",
                )}
              >
                {loadingState.text}
              </span>
            </motion.div>
          );
        })}

        {/* Skeleton placeholders for pending items */}
        {skeletonWidths.slice(0, pendingCount).map((width, i) => {
          const skeletonIndex = loadingStates.length + i;
          const distance = skeletonIndex - value;
          const opacity = Math.max(0.4 - distance * 0.06, 0.1);
          const y = skeletonIndex * itemHeight;

          return (
            <motion.div
              animate={{ opacity, y }}
              className="absolute right-0 left-0 flex items-center gap-3 px-2"
              initial={{ opacity: 0, y: y + 8 }}
              key={`skeleton-${width}`}
              transition={{
                y: {
                  type: "spring",
                  stiffness: 120,
                  damping: 20,
                  mass: 1,
                },
                opacity: {
                  duration: 0.4,
                  ease: [0.4, 0, 0.2, 1],
                },
              }}
            >
              <div className="shrink-0">
                <CheckIcon className="text-white/20" />
              </div>
              <SkeletonLine width={width} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function RawConsoleOutput({ lines }: { lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto rounded-lg bg-black/40 p-4 font-mono text-xs"
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre-wrap break-all leading-relaxed",
            line.toLowerCase().includes("error") ||
              line.toLowerCase().includes("failed")
              ? "text-red-400"
              : line.toLowerCase().includes("warning")
                ? "text-yellow-400"
                : "text-white/80",
          )}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
}

export function RebuildOverlayPanel() {
  const { handleRollback, handleDismiss } = useRebuild();
  const { isRunning, lines, rawLines, success, errorType, errorMessage } =
    useWidgetStore((state) => state.rebuild);

  const [showRawOutput, setShowRawOutput] = useState(false);
  const [hasAutoShownConsole, setHasAutoShownConsole] = useState(false);

  // Auto-show console on failure
  const showErrorPanel = !isRunning && success === false;
  if (showErrorPanel && !hasAutoShownConsole) {
    setShowRawOutput(true);
    setHasAutoShownConsole(true);
  }

  // Reset auto-show flag when a new build starts
  if (isRunning && hasAutoShownConsole) {
    setHasAutoShownConsole(false);
  }

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

  // Only show when rebuild is running or has completed
  const isVisible = isRunning || success !== undefined;
  if (!isVisible) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="h-full w-full max-h-[600px] max-w-[800px] p-5">
        <div
          className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 p-6"
          style={{
            background:
              "radial-gradient(ellipse at 50% 100%, rgba(30, 30, 30, 0.98) 0%, rgba(20, 20, 20, 0.95) 50%, rgba(15, 15, 15, 0.92) 100%)",
          }}
        >
      {/* Header with toggle */}
      <div className="mb-4 flex items-center justify-end">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs",
              showRawOutput
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/10 hover:text-white",
            )}
            onClick={() => setShowRawOutput(!showRawOutput)}
          >
            {showRawOutput ? (
              <>
                <List className="mr-1.5 h-3.5 w-3.5" />
                Summary
              </>
            ) : (
              <>
                <Terminal className="mr-1.5 h-3.5 w-3.5" />
                Console
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            onClick={handleDismiss}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Back
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="min-h-0 flex-1">
        <AnimatePresence mode="wait">
          {showErrorPanel && !showRawOutput ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full flex-col items-center justify-center gap-5"
            >
              {/* Error Icon */}
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20">
                <AlertTriangle className="h-7 w-7 text-red-400" />
              </div>

              {/* Error Title */}
              <h2 className="text-center font-semibold text-white text-lg">
                {getErrorTitle(errorType)}
              </h2>

              {/* Error Message */}
              {errorMessage && (
                <p className="max-h-24 w-full max-w-md overflow-y-auto rounded-lg bg-black/30 px-4 py-3 text-center font-mono text-xs text-zinc-400">
                  {errorMessage}
                </p>
              )}

              {/* Suggestion */}
              <p className="max-w-md text-center text-sm text-zinc-300">
                {getErrorSuggestion(errorType)}
              </p>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button
                  className="border-white/20 text-white/80 hover:bg-white/10"
                  onClick={handleDismiss}
                  variant="outline"
                  size="sm"
                >
                  <X className="mr-2 h-4 w-4" />
                  Dismiss
                </Button>
                <Button
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={handleRollback}
                  size="sm"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Rollback
                </Button>
              </div>
            </motion.div>
          ) : showRawOutput ? (
            <motion.div
              key="raw"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full"
            >
              <RawConsoleOutput
                lines={
                  rawLines.length > 0 ? rawLines : lines.map((l) => l.text)
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex h-full w-full flex-col items-center justify-center"
            >
              <div className="w-full max-w-xs">
                <LoaderCore
                  loadingStates={displayLines}
                  value={step}
                  pendingCount={isRunning ? 3 : 0}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer with dismiss button when complete and successful */}
      {!isRunning && success === true && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex justify-end"
        >
          <Button
            className="border-white/20 text-white/80 hover:bg-white/10"
            onClick={handleDismiss}
            variant="outline"
            size="sm"
          >
            <X className="mr-2 h-4 w-4" />
            Dismiss
          </Button>
        </motion.div>
      )}
        </div>
      </div>
    </div>
  );
}
