import { useState } from "react";
import type { HistoryItem } from "@/tauri-api";
import type { SemanticChangeMap } from "@/types/shared";
import { cn } from "@/lib/utils";
import { AnalyzeHistoryItemButton } from "@/components/widget/analyze-history-item-button";
import { HistoryRestoreItemButton } from "@/components/widget/history-restore-item-button";
import { getCategoryStyle } from "@/components/widget/utils";

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface SummaryBadge {
  title: string;
  description: string;
}

function getSummaryBadges(changeMap: SemanticChangeMap): SummaryBadge[] {
  const badges: SummaryBadge[] = [];
  for (const group of changeMap.groups) {
    badges.push({ title: group.summary.title, description: group.summary.description });
  }
  for (const single of changeMap.singles) {
    badges.push({ title: single.title, description: single.description });
  }
  return badges;
}

interface HistoryItemCardProps {
  item: HistoryItem;
  isRestoring: boolean;
  onRequestRestore: (hash: string) => void;
}

export function HistoryItemCard({ item, isRestoring, onRequestRestore }: HistoryItemCardProps) {
  const [expanded, setExpanded] = useState(false);

  const changeMap = item.changeMap;
  const badges = changeMap ? getSummaryBadges(changeMap) : [];
  const showAnalyze = (!changeMap || item.missedHashes.length > 0) && !item.isBase;

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div
      className={cn(
        "group rounded-[10px] border-2 bg-[#111111] px-[14px] py-3 mb-2 select-none transition-colors duration-150",
        item.isBuilt ? "border-teal-400/40" : "border-white/[0.12]",
        changeMap
          ? cn("cursor-pointer", !item.isBuilt && "hover:border-white/25 hover:bg-[#141414]")
          : "cursor-default",
        expanded && cn("bg-[#151515]", item.isBuilt ? "border-teal-400/50" : "border-white/35"),
      )}
      onClick={changeMap ? toggle : undefined}
      onKeyDown={changeMap ? (e) => {
        if (e.key === "Enter" || e.key === " ") toggle();
      } : undefined}
      role={changeMap ? "button" : undefined}
      tabIndex={changeMap ? 0 : undefined}
    >
      {/* Collapsed body: left content + right actions */}
      <div className="flex items-start justify-between gap-[10px]">
        {/* Left: message, meta, badges */}
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium leading-[1.4] text-white">
            {item.message ?? "(no message)"}
          </span>
          {item.originMessage && (
            <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
              {item.originMessage}
            </p>
          )}
          <div className="mt-[6px] flex w-fit flex-wrap items-center gap-2">
            <span className="rounded bg-teal-400/[0.08] px-[7px] py-0.5 font-mono text-[10px] text-teal-400">
              {item.hash.slice(0, 7)}
            </span>
            <span className="text-[10px] text-neutral-500">
              {formatRelativeTime(item.createdAt)}
            </span>
            {item.fileCount > 0 && (
              <span className="inline-flex items-center gap-[3px] text-[10px] text-neutral-500">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="relative -top-px">
                  <path d="M4 2h5l4 4v8H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                {item.fileCount} {item.fileCount === 1 ? "file" : "files"}
              </span>
            )}
            {item.isExternal && (
              <span className="rounded bg-violet-400/10 px-[7px] py-0.5 font-mono text-[10px] italic text-violet-400">
                External commit
              </span>
            )}
            {showAnalyze && (
              <AnalyzeHistoryItemButton
                hash={item.hash}
                isPartial={!!(changeMap && item.missedHashes.length > 0)}
              />
            )}
          </div>
          {!changeMap && item.rawChanges.length > 0 && (
            <div className="mt-[6px] flex flex-wrap gap-1">
              {[...new Set(item.rawChanges.map((c) => c.filename))].map((filename) => {
                const basename = filename.split("/").pop() ?? filename;
                return (
                  <span
                    key={filename}
                    className="inline-flex items-center rounded bg-white/[0.04] px-[7px] py-0.5 text-[10px] text-neutral-400"
                  >
                    {basename}
                  </span>
                );
              })}
            </div>
          )}
          {badges.length > 0 && (
            <div className="mt-[6px] flex flex-wrap gap-1">
              {badges.map((badge, i) => {
                if (!badge.title) {
                  return (
                    <span
                      key={i}
                      className="inline-block h-[18px] w-12 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.03] via-white/[0.065] to-white/[0.03]"
                      style={{ width: `${[48, 56, 44][i % 3]}px` }}
                    />
                  );
                }
                const style = getCategoryStyle(badge.title);
                return (
                  <span
                    key={badge.title}
                    className={cn(
                      "inline-flex items-center gap-[3px] rounded px-[7px] py-0.5 text-[10px]",
                      style.text,
                      style.bg,
                    )}
                  >
                    <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", style.dot)} />
                    {badge.title}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: restore button */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <HistoryRestoreItemButton
            hash={item.hash}
            isBuilt={item.isBuilt}
            isBase={item.isBase}
            isRestoring={isRestoring}
            onRequestRestore={onRequestRestore}
          />
        </div>
      </div>

      {/* Expanded detail lines */}
      {expanded && badges.length > 0 && (
        <div className="mt-[10px] border-t border-white/10 pt-[10px]">
          <p className="mb-[5px] text-[11px] font-medium text-neutral-400">Changes</p>
          {badges.map((badge) => (
            <div
              key={badge.title}
              className="my-[3px] rounded border-l-2 border-white/20 bg-white/[0.02] px-2 py-1 text-[11px] text-neutral-500"
            >
              {badge.description}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
