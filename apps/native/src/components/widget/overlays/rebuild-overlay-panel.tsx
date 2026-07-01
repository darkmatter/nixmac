import { Button } from "@/components/ui/button";
import { EtcClobberConflictList } from "@/components/widget/overlays/etc-clobber-conflict-list";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { useRollback } from "@/hooks/use-rollback";
import { tauriAPI } from "@/ipc/api";
import {
  getRebuildErrorSuggestion,
  getRebuildErrorTitle,
  getRebuildSystemSafetyMessage,
} from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { RebuildErrorType, RebuildLine, RebuildNotice } from "@/types/rebuild";
import { uiActions, useUiState, useViewModel } from "@nixmac/state";
import {
  AlertTriangle,
  AppWindow,
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
import { Activity, useEffect, useRef, useState } from "react";

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
  pendingCount = 6,
  children,
}: {
  loadingStates: RebuildLine[];
  value?: number;
  pendingCount?: number;
  children?: React.ReactNode;
}) {
  const skeletonWidths = ["w-24", "w-32", "w-28", "w-20", "w-36", "w-30", "w-22", "w-40"];
  const itemHeight = 36;

  // Find the index of the most recently completed step (one before current)
  const mostRecentlyCompletedIndex = value > 0 ? value - 1 : -1;

  // Calculate the center point for the gradient (current item position, shifted up by 1 to center the green item)
  const centerY = value * itemHeight + itemHeight / 2 - itemHeight;
  const gradientRange = itemHeight * 6; // How many items to show clearly

  return (
    <div className="flex h-full w-full flex-col">
      {children}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="mx-auto w-full max-w-2xl">
          <div className="relative flex w-full flex-col items-start">
            <div
              className="relative w-full"
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
                // Softer falloff so more lines remain visible
                const opacity =
                  distance < 0
                    ? Math.max(1 - Math.abs(distance) * 0.08, 0.28)
                    : Math.max(1 - distance * 0.12, 0.12);

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
                    className="absolute left-0 right-0 flex items-center gap-3 px-6"
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
                              "block whitespace-pre-wrap wrap-break-word text-sm font-normal transition-colors duration-500",
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
                const opacity = Math.max(0.6 - distance * 0.08, 0.08);
                const y = skeletonIndex * itemHeight;

                return (
                  <motion.div
                    animate={{ opacity, y }}
                    className="absolute left-0 right-0 flex items-center gap-3 px-6"
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

function RebuildNoticeList({ notices }: { notices: RebuildNotice[] }) {
  const [requestingPermission, setRequestingPermission] = useState<string | null>(null);

  if (notices.length === 0) {
    return null;
  }

  async function handlePermissionAction(permissionId: string) {
    setRequestingPermission(permissionId);
    try {
      await tauriAPI.permissions.request(permissionId);
      await tauriAPI.permissions.refresh();
    } finally {
      setRequestingPermission(null);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      {notices.map((notice) => {
        const permissionId = notice.permissionId;
        const isRequestingPermission = requestingPermission === permissionId;

        return (
          <div
            key={notice.id}
            className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-amber-50 shadow-lg shadow-amber-950/20"
          >
            <div className="flex gap-3">
              <AppWindow className="mt-0.5 size-5 shrink-0 text-amber-200" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-amber-100">{notice.title}</p>
                <p className="mt-1 text-amber-50/85 text-xs leading-relaxed">{notice.body}</p>
                {permissionId ? (
                  <Button
                    className="mt-3 border-amber-200/30 text-amber-50 hover:bg-amber-200/10"
                    disabled={isRequestingPermission}
                    onClick={() => handlePermissionAction(permissionId)}
                    size="sm"
                    variant="outline"
                  >
                    {isRequestingPermission
                      ? "Opening…"
                      : (notice.actionLabel ?? "Open System Settings")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
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
        className="min-h-0 flex-1 overflow-auto rounded-lg bg-black/40 p-6 font-mono text-xs"
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
  const { triggerRebuild } = useRebuildStream();
  const status = useViewModel((state) => state.rebuildStatus);
  const lines = useViewModel((state) => state.rebuildLog.lines);
  const rawLines = useViewModel((state) => state.rebuildLog.rawLines);
  const notices = useViewModel((state) => state.rebuildLog.notices);
  const context = useUiState((state) => state.rebuildContext);
  const dismissed = useUiState((state) => state.rebuildPanelDismissed);
  const etcClobber = useUiState((state) => state.etcClobber);

  const isRunning = status?.isRunning ?? false;
  const success = status?.success ?? undefined;
  const errorType = (status?.errorType ?? undefined) as RebuildErrorType | undefined;
  const errorMessage = status?.errorMessage ?? undefined;
  const systemUntouched = status?.systemUntouched ?? undefined;

  const isRollback = context === "rollback";
  const systemSafetyMessage = getRebuildSystemSafetyMessage(systemUntouched, context);

  const handleRetry = async () => {
    uiActions.setProcessing(true, "cancel");
    await triggerRebuild({ context: "rollback" });
  };

  const handleDismiss = () => {
    uiActions.setRebuildPanelDismissed(true);
  };

  const [showConsole, setShowConsole] = useState(false);

  const showErrorPanel = !isRunning && success === false;

  // Reset to summary view when new build starts
  useEffect(() => {
    if (isRunning) {
      setShowConsole((current) => (current ? false : current));
    }
  }, [isRunning]);

  // On failure, switch from console to error panel (if console was shown)
  useEffect(() => {
    if (showErrorPanel) {
      setShowConsole((current) => (current ? false : current));
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

  // Only show when rebuild is running or has completed (and the completed
  // run's panel hasn't been dismissed)
  const isVisible = isRunning || (success !== undefined && !dismissed);
  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-y-8 z-10 w-full max-w-[100vw] flex items-center justify-center bg-background/95 backdrop-blur-sm">
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
            {/* Build-log-triggered guidance lives above the active running view;
                failure panels render it inline to avoid duplicate mounted copies. */}
            {(!showErrorPanel || showConsole) && <RebuildNoticeList notices={notices} />}

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
                    {getRebuildErrorTitle(errorType)}
                  </h2>

                  <div className="w-full max-w-xl">
                    <RebuildNoticeList notices={notices} />
                  </div>

                  {systemSafetyMessage && (
                    <p className="max-w-xl rounded-lg border border-teal-400/30 bg-teal-400/10 px-4 py-2 text-center font-medium text-sm text-teal-200">
                      {systemSafetyMessage}
                    </p>
                  )}

                  {errorType === "etc_clobber" && etcClobber && (
                    <EtcClobberConflictList result={etcClobber} />
                  )}

                  {/* Error Message */}
                  {errorMessage && errorType !== "etc_clobber" && (
                    <p className="max-h-48 w-full max-w-xl overflow-y-auto rounded-lg bg-black/30 px-6 py-3 text-center font-mono text-xs text-zinc-400">
                      {errorMessage}
                    </p>
                  )}

                  {/* Suggestion */}
                  <p className="max-w-xl text-center text-sm text-zinc-300">
                    {getRebuildErrorSuggestion(errorType)}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Summary view - stays mounted via Activity to preserve animation state */}
            <Activity mode={showConsole || showErrorPanel ? "hidden" : "visible"}>
              <LoaderCore
                loadingStates={displayLines}
                value={step}
                pendingCount={isRunning ? 8 : 0}
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
                  onClick={isRollback ? handleRetry : () => handleRollback()}
                  size="sm"
                  // only implemented for rollback
                  disabled={!isRollback}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {isRollback ? "Retry Rollback" : "Rollback"}
                </Button>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
