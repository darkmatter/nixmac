import { Button } from "@/components/ui/button";
import { useRollback } from "@/hooks/use-rollback";
import { cn } from "@/lib/utils";
import { useWidgetStore, type RebuildErrorType, type RebuildLine } from "@/stores/widget-store";
import {
  AlertTriangle,
  Brain,
  CheckCircle,
  Download,
  Hammer,
  List,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, useCallback, useEffect, useRef, useState } from "react";

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
    case "user_cancelled":
      return "Activation Cancelled";
    case "authorization_denied":
      return "Authorization Denied";
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
    case "user_cancelled":
      return "The activation was cancelled. You can retry the operation.";
    case "authorization_denied":
      return "The activation was denied due to insufficient permissions. You can adjust your settings and retry.";
    default:
      return "The build encountered an error. You can rollback to your previous configuration or dismiss to investigate.";
  }
}

/** Map backend emoji to icon component and strip from text */
const EMOJI_MAP: Record<string, (className: string) => React.ReactNode> = {
  "🚀": (c) => <Play className={c} />,
  "🔍": (c) => <Brain className={c} />,
  "📦": (c) => <Download className={c} />,
  "🔨": (c) => <Hammer className={c} />,
  "⚡": (c) => <Sparkles className={c} />,
  "✅": (c) => <CheckCircle className={c} />,
  "❌": (c) => <AlertTriangle className={c} />,
};

/** Convert emoji prefix to icon and clean text */
function convertEmoji(
  text: string,
  className: string,
): { icon: React.ReactNode; cleanText: string } {
  for (const [emoji, iconFn] of Object.entries(EMOJI_MAP)) {
    if (text.startsWith(emoji)) {
      return {
        icon: iconFn(className),
        cleanText: text.slice(emoji.length).trimStart(),
      };
    }
  }
  // Default: no emoji found
  return {
    icon: <CheckCircle className={className} />,
    cleanText: text,
  };
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

const SkeletonLine = ({ width = "w-32" }: { width?: string }) => (
  <div className={cn("h-3 animate-pulse rounded bg-white/20", width)} />
);

const ViewToggleButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <div className="mb-4 flex items-center justify-end">
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-3 text-xs text-white/60 hover:bg-white/10 hover:text-white"
      onClick={onClick}
    >
      {children}
    </Button>
  </div>
);

function LoaderCore({
  loadingStates,
  value = 0,
  pendingCount = 3,
  children,
}: {
  loadingStates: RebuildLine[];
  value?: number;
  pendingCount?: number;
  children?: React.ReactNode;
}) {
  const skeletonWidths = ["w-24", "w-32", "w-28"];
  const itemHeight = 36;

  // Find the index of the most recently completed step (one before current)
  const mostRecentlyCompletedIndex = value > 0 ? value - 1 : -1;

  // Calculate the center point for the gradient (current item position, shifted up by 1 to center the green item)
  const centerY = value * itemHeight + itemHeight / 2 - itemHeight;
  const gradientRange = itemHeight * 3; // How many items to show clearly

  return (
    <div className="flex h-full w-full flex-col">
      {children}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full max-w-xs">
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

                const isMostRecentlyCompleted = index === mostRecentlyCompletedIndex;

                // Only the most recently completed step gets highlighted
                let checkClass = "text-white/40";
                if (isMostRecentlyCompleted) {
                  checkClass = "text-teal-400";
                }

                // Text coloring: only most recently completed is highlighted
                let textClass = "text-white/50";
                if (isMostRecentlyCompleted) {
                  textClass = "text-teal-400 font-medium";
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
                    {(() => {
                      const { icon, cleanText } = convertEmoji(
                        loadingState.text,
                        cn("h-5 w-5", checkClass),
                      );
                      return (
                        <>
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
                            {icon}
                          </motion.div>
                          <span
                            className={cn(
                              textClass,
                              "block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-normal transition-colors duration-500",
                            )}
                          >
                            {cleanText}
                          </span>
                        </>
                      );
                    })()}
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
        </div>
      </div>
    </div>
  );
}

function RawConsoleOutput({ lines, children }: { lines: string[]; children?: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="flex h-full flex-col">
      {children}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg bg-black/40 p-4 font-mono text-xs"
      >
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "whitespace-pre-wrap break-all leading-relaxed",
              line.toLowerCase().includes("error") || line.toLowerCase().includes("failed")
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
    </div>
  );
}

export function RebuildOverlayPanel() {
  const { handleRollback } = useRollback();
  const { isRunning, lines, rawLines, success, errorType, errorMessage } = useWidgetStore(
    (state) => state.rebuild,
  );
  const processingAction = useWidgetStore((state) => state.processingAction);
  const isRollback = processingAction === "cancel";

  const handleDismiss = useCallback(() => {
    useWidgetStore.getState().clearRebuild();
  }, []);

  const [showConsole, setShowConsole] = useState(false);

  const showErrorPanel = !isRunning && success === false;

  // Reset to summary view when new build starts
  useEffect(() => {
    if (isRunning) {
      setShowConsole(false);
    }
  }, [isRunning]);

  // On failure, switch from console to error panel (if console was shown)
  useEffect(() => {
    if (showErrorPanel) {
      setShowConsole(false);
    }
  }, [showErrorPanel]);

  const displayLines =
    lines.length > 0
      ? lines
      : [
          {
            id: 0,
            text: isRollback ? "Rolling back..." : "Starting rebuild...",
            type: "info" as const,
          },
        ];

  // Step points to the current (most recent) line
  // - While running: last line is "in progress", previous lines are "completed"
  // - When complete: all lines are "completed" (step past the end)
  const step = isRunning ? Math.max(0, displayLines.length - 1) : displayLines.length;

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
          {/* Main content */}
          <div className="min-h-0 flex-1">
            {/* Error panel - conditional, only on failure when not viewing console */}
            <AnimatePresence>
              {showErrorPanel && !showConsole && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex h-full flex-col items-center justify-center gap-5"
                >
                  {/* Error Icon */}
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-300/10">
                    <AlertTriangle className="h-7 w-7 text-rose-300" />
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
                </motion.div>
              )}
            </AnimatePresence>

            {/* Summary view - stays mounted via Activity to preserve animation state */}
            <Activity mode={showConsole || showErrorPanel ? "hidden" : "visible"}>
              <LoaderCore
                loadingStates={displayLines}
                value={step}
                pendingCount={isRunning ? 3 : 0}
              >
                <ViewToggleButton onClick={() => setShowConsole(true)}>
                  <Terminal className="mr-1.5 h-3.5 w-3.5" />
                  Console
                </ViewToggleButton>
              </LoaderCore>
            </Activity>

            {/* Console view - stays mounted via Activity to preserve scroll position */}
            <Activity mode={showConsole ? "visible" : "hidden"}>
              <RawConsoleOutput lines={rawLines.length > 0 ? rawLines : lines.map((l) => l.text)}>
                <ViewToggleButton onClick={() => setShowConsole(false)}>
                  <List className="mr-1.5 h-3.5 w-3.5" />
                  Summary
                </ViewToggleButton>
              </RawConsoleOutput>
            </Activity>
          </div>

          {/* Footer with action buttons when complete */}
          {!isRunning && success !== undefined && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex justify-end gap-3"
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
              {success === false && (
                <Button
                  className="bg-rose-300/10 text-rose-300 hover:bg-rose-300/20"
                  onClick={() => handleRollback()}
                  size="sm"
                  // NOT IMPLEMENTED
                  disabled={true}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Rollback
                </Button>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
