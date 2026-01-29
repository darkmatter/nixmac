"use client";

import { Eye, GitCommit, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface PreviewIndicatorProps {
  /** Whether the indicator is visible */
  visible: boolean;
  /** Callback when the indicator is clicked */
  onClick?: () => void;
  /** Summary of changes (optional) */
  summary?: string;
  /** Number of files changed */
  filesChanged?: number;
  /** Number of lines added */
  additions?: number;
  /** Number of lines deleted */
  deletions?: number;
  /** Suggested commit message */
  commitMessage?: string;
  /** Callback to commit changes */
  onCommit?: (message: string) => void;
  /** Callback to discard changes */
  onDiscard?: () => void;
  /** Whether an action is in progress */
  isLoading?: boolean;
  /** Disable expansion behavior (for separate window context) */
  disableExpansion?: boolean;
}

/**
 * A floating indicator that appears in the bottom-right corner
 * when the app is in Preview mode (changes applied but not committed).
 *
 * Features:
 * - Glowing pulse animation to draw attention
 * - Expands on hover/click to show change summary
 * - Quick actions to commit or discard
 */
export function PreviewIndicator({
  visible,
  onClick,
  summary,
  filesChanged = 0,
  additions,
  deletions,
  commitMessage = "",
  onCommit,
  onDiscard,
  isLoading = false,
  disableExpansion = false,
}: PreviewIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editedMessage, setEditedMessage] = useState(commitMessage);

  // Update edited message when prop changes
  useEffect(() => {
    setEditedMessage(commitMessage);
  }, [commitMessage]);

  if (!visible) {
    return null;
  }

  const handleClick = () => {
    if (!disableExpansion) {
      setIsExpanded(!isExpanded);
    }
    onClick?.();
  };

  const handleCommit = () => {
    if (editedMessage.trim()) {
      onCommit?.(editedMessage.trim());
    }
  };

  const handleDiscard = () => {
    onDiscard?.();
    setIsExpanded(false);
  };

  return (
    <div className="fixed right-4 bottom-4 z-[100]">
      {/* Expanded panel */}
      {isExpanded && (
        <div className="fade-in slide-in-from-bottom-2 mb-3 w-80 animate-in duration-200">
          <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-zinc-900/95 shadow-2xl backdrop-blur-xl">
            {/* Header */}
            <div className="flex items-center gap-2 border-amber-500/20 border-b bg-amber-500/10 px-4 py-3">
              <Eye className="h-4 w-4 text-amber-400" />
              <span className="font-medium text-amber-200 text-sm">
                Preview Mode
              </span>
              <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300 text-xs">
                {filesChanged} file{filesChanged !== 1 ? "s" : ""} changed
              </span>
            </div>

            {/* Summary */}
            {summary && (
              <div className="border-zinc-700/50 border-b px-4 py-3">
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {summary}
                </p>
              </div>
            )}

            {/* Commit message input */}
            <div className="space-y-2 px-4 py-3">
              <label
                className="font-medium text-xs text-zinc-400"
                htmlFor="commit-msg"
              >
                Commit message
              </label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                disabled={isLoading}
                id="commit-msg"
                onChange={(e) => setEditedMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                placeholder="Describe your changes..."
                type="text"
                value={editedMessage}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 border-zinc-700/50 border-t bg-zinc-800/30 px-4 py-3">
              <button
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                  "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30",
                  isLoading && "cursor-not-allowed opacity-50"
                )}
                disabled={isLoading || !editedMessage.trim()}
                onClick={handleCommit}
                type="button"
              >
                <GitCommit className="h-4 w-4" />
                Commit
              </button>
              <button
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                  "bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700/70",
                  isLoading && "cursor-not-allowed opacity-50"
                )}
                disabled={isLoading}
                onClick={handleDiscard}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        className="relative inline-flex h-12 overflow-hidden rounded-full p-[1px] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50"
        onClick={handleClick}
        type="button"
      >
        <span className="absolute inset-[-35%] animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,#E2CBFF_0%,#393BB2_50%,#E2CBFF_100%)]" />
        <span className="inline-flex h-full w-full cursor-pointer items-center justify-center gap-3 rounded-full bg-slate-950 px-5 py-1 font-medium text-sm text-white backdrop-blur-3xl">
          {/* <span>Preview Active</span> */}
          {/* <img src="/icon.png" alt="Preview Active" width={20} height={20} /> */}
          {(additions !== undefined || deletions !== undefined) && (
            <span className="flex items-center gap-1.5 font-mono text-xs">
              {additions !== undefined && (
                <span className="text-green-400">+{additions}</span>
              )}
              {deletions !== undefined && (
                <span className="text-red-400">-{deletions}</span>
              )}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

// Export for Storybook
export type { PreviewIndicatorProps };
