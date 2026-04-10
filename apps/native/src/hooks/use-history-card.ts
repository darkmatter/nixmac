import { useCallback, useState } from "react";
import type { KeyboardEvent } from "react";
import type { HistoryItem } from "@/tauri-api";
import { cn } from "@/lib/utils";
import { buildColorMap } from "@/components/widget/utils";
import type { ColorMap } from "@/components/widget/utils";
import { useWidgetStore } from "@/stores/widget-store";

export type ActionType = "current" | "base" | "build" | "restore";

interface UseHistoryCardResult {
  expanded: boolean;
  colorMap: ColorMap;
  cardClassName: string;
  actionType: ActionType;
  handleCardClick: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
}

export function useHistoryCard(item: HistoryItem): UseHistoryCardResult {
  const [expanded, setExpanded] = useState(false);
  const isHead = useWidgetStore((s) => s.gitStatus?.headCommitHash === item.hash);

  const colorMap = item.changeMap ? buildColorMap(item.changeMap) : new Map();

  const handleCardClick = useCallback(() => {
    if (window.getSelection()?.toString()) return;
    if (!item.changeMap) return;
    setExpanded((prev) => !prev);
  }, [item.changeMap]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") setExpanded((prev) => !prev);
  }, []);

  const borderColor = item.isBuilt ? "border-teal-400/40" : "border-white/[0.12]";
  const interactivity = item.changeMap
    ? cn("cursor-pointer", !item.isBuilt && "hover:border-white/25 hover:bg-[#141414]")
    : "cursor-default";
  const expandedStyles = expanded
    ? cn("bg-[#151515]", item.isBuilt ? "border-teal-400/50" : "border-white/35")
    : undefined;

  const cardClassName = cn(
    "group rounded-[10px] border-2 bg-[#111111] px-[14px] py-3 mb-2 transition-colors duration-150",
    borderColor,
    interactivity,
    expandedStyles,
  );

  const actionType: ActionType = item.isBuilt
    ? "current"
    : item.isBase
      ? "base"
      : isHead
        ? "build"
        : "restore";

  return { expanded, colorMap, cardClassName, actionType, handleCardClick, handleKeyDown };
}
