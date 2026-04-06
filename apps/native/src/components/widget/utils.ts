import type {
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";

export function computeCurrentStep(state: WidgetState): WidgetStep {
  const hasConfigDir = !!state.configDir;
  const hasHost = !!state.host && state.hosts.includes(state.host);
  const permissionsCheckedAndIncomplete =
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted;

  if (permissionsCheckedAndIncomplete) {
    return "permissions";
  }

  if (state.nixInstalled !== true || state.darwinRebuildAvailable !== true) {
    return "nix-setup";
  }

  if (state.isBootstrapping) {
    return "setup";
  }

  if (!(hasConfigDir && hasHost)) {
    return "setup";
  }

  if (state.showHistory) {
    return "history";
  }

  // Backend is the source of truth for evolve/merge routing.
  const routingStep = state.evolveState?.step;
  if (routingStep === "merge") return "merge";
  if (routingStep === "evolve") return "evolving";
  if (routingStep === "begin") return "begin";

  return "evolving";
}

export function getShortFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function getDirectory(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/**
 * Infer change type from diff chunk content.
 */
export function getChangeTypeFromChunks(chunks: string): "new" | "edited" | "removed" {
  const contentLines = chunks.split("\n").filter((l) => l.startsWith("+") || l.startsWith("-"));
  if (contentLines.length === 0) return "edited";
  const hasAdditions = contentLines.some((l) => l.startsWith("+"));
  const hasDeletions = contentLines.some((l) => l.startsWith("-"));
  if (hasAdditions && !hasDeletions) return "new";
  if (!hasAdditions && hasDeletions) return "removed";
  return "edited";
}


// =============================================================================
// CATEGORY COLORS
// =============================================================================

export type CategoryStyle = {
  text: string;
  bg: string;
  dot: string;
  border: string;
};

const CATEGORY_PALETTE: CategoryStyle[] = [
  { text: "text-emerald-500", bg: "bg-emerald-500/[0.08]", dot: "bg-emerald-500", border: "border-emerald-500/40" },
  { text: "text-blue-500",    bg: "bg-blue-500/[0.08]",    dot: "bg-blue-500",    border: "border-blue-500/40" },
  { text: "text-amber-500",   bg: "bg-amber-500/[0.08]",   dot: "bg-amber-500",   border: "border-amber-500/40" },
  { text: "text-violet-500",  bg: "bg-violet-500/[0.08]",  dot: "bg-violet-500",  border: "border-violet-500/40" },
  { text: "text-rose-500",    bg: "bg-rose-500/[0.08]",    dot: "bg-rose-500",    border: "border-rose-500/40" },
  { text: "text-cyan-500",    bg: "bg-cyan-500/[0.08]",    dot: "bg-cyan-500",    border: "border-cyan-500/40" },
  { text: "text-orange-400",  bg: "bg-orange-400/[0.08]",  dot: "bg-orange-400",  border: "border-orange-400/40" },
  { text: "text-teal-500",    bg: "bg-teal-500/[0.08]",    dot: "bg-teal-500",    border: "border-teal-500/40" },
];

export function getCategoryStyle(title: string): CategoryStyle {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

// =============================================================================
// HISTORY UTILS
// =============================================================================

import type { HistoryItem } from "@/tauri-api";

export interface HistoryDayGroup {
  label: string;
  items: HistoryItem[];
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function getDayLabel(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function groupByDay(items: HistoryItem[]): HistoryDayGroup[] {
  const historyByDay: HistoryDayGroup[] = [];
  const seen = new Map<string, number>();

  for (const item of items) {
    const label = getDayLabel(item.createdAt);
    const idx = seen.get(label);
    if (idx !== undefined) {
      historyByDay[idx].items.push(item);
    } else {
      seen.set(label, historyByDay.length);
      historyByDay.push({ label, items: [item] });
    }
  }

  return historyByDay;
}
