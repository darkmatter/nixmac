import { useState } from "react";
import type { HistoryItem, SummaryResponse } from "@/tauri-api";
import { cn } from "@/lib/utils";
import { AnalyzeHistoryItemButton } from "@/components/widget/analyze-history-item-button";
import { HistoryRestoreItemButton } from "@/components/widget/history-restore-item-button";

type CategoryStyle = {
  text: string;
  bg: string;
  dot: string;
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  packages: { text: "text-emerald-500", bg: "bg-emerald-500/[0.08]", dot: "bg-emerald-500" },
  settings: { text: "text-blue-500", bg: "bg-blue-500/[0.08]", dot: "bg-blue-500" },
  shell: { text: "text-amber-500", bg: "bg-amber-500/[0.08]", dot: "bg-amber-500" },
  home: { text: "text-violet-500", bg: "bg-violet-500/[0.08]", dot: "bg-violet-500" },
  system: { text: "text-gray-500", bg: "bg-gray-500/[0.08]", dot: "bg-gray-500" },
};

function getCategoryStyle(title: string): CategoryStyle {
  const key = title.toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_STYLES)) {
    if (key.includes(k)) return v;
  }
  return { text: "text-gray-500", bg: "bg-gray-500/[0.08]", dot: "bg-gray-500" };
}

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface HistoryItemCardProps {
  item: HistoryItem;
}

export function HistoryItemCard({ item }: HistoryItemCardProps) {
  const [expanded, setExpanded] = useState(false);

  const summary = item.summary
    ? (JSON.parse(item.summary.contentJson) as SummaryResponse)
    : null;

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div
      className={cn(
        "group rounded-[10px] border-2 bg-[#111111] px-[14px] py-3 mb-2 select-none transition-colors duration-150",
        item.isBuilt ? "border-teal-400/40" : "border-white/[0.12]",
        summary
          ? cn("cursor-pointer", !item.isBuilt && "hover:border-white/25 hover:bg-[#141414]")
          : "cursor-default",
        expanded && cn("bg-[#151515]", item.isBuilt ? "border-teal-400/50" : "border-white/35"),
      )}
      onClick={summary ? toggle : undefined}
      onKeyDown={summary ? (e) => {
        if (e.key === "Enter" || e.key === " ") toggle();
      } : undefined}
      role={summary ? "button" : undefined}
      tabIndex={summary ? 0 : undefined}
    >
      {/* Collapsed body: left content + right actions */}
      <div className="flex items-start justify-between gap-[10px]">
        {/* Left: message, meta, badges */}
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium leading-[1.4] text-white">
            {item.message ?? "(no message)"}
          </span>
          <div className="mt-[6px] flex w-fit flex-wrap items-center gap-2">
            <span className="rounded bg-teal-400/[0.08] px-[7px] py-0.5 font-mono text-[10px] text-teal-400">
              {item.hash.slice(0, 7)}
            </span>
            <span className="text-[10px] text-neutral-500">
              {formatRelativeTime(item.createdAt)}
            </span>
          </div>
          {summary && summary.items.length > 0 && (
            <div className="mt-[6px] flex flex-wrap gap-1">
              {summary.items.map((si) => {
                const style = getCategoryStyle(si.title);
                return (
                  <span
                    key={si.title}
                    className={cn(
                      "inline-flex items-center gap-[3px] rounded px-[7px] py-0.5 text-[10px]",
                      style.text,
                      style.bg,
                    )}
                  >
                    <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", style.dot)} />
                    {si.title}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: action buttons */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <HistoryRestoreItemButton hash={item.hash} isBuilt={item.isBuilt} />
          {!summary && (
            <AnalyzeHistoryItemButton
              hash={item.hash}
              className="group-hover:bg-accent group-hover:text-accent-foreground"
            />
          )}
        </div>
      </div>

      {/* Expanded detail lines */}
      {expanded && summary && (
        <div className="mt-[10px] border-t border-white/10 pt-[10px]">
          <p className="mb-[5px] text-[11px] font-medium text-neutral-400">Changes</p>
          {summary.items.map((si) => (
            <div
              key={si.title}
              className="my-[3px] rounded border-l-2 border-white/20 bg-white/[0.02] px-2 py-1 text-[11px] text-neutral-500"
            >
              {si.description}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
