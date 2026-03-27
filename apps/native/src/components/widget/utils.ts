import type {
  WidgetState,
  WidgetStep,
} from "@/stores/widget-store";

export function computeCurrentStep(state: WidgetState): WidgetStep {
  const hasConfigDir = !!state.configDir;
  const hasHost = !!state.host;
  const notMainBranch = !(state.gitStatus?.isMainBranch ?? true);
  const headIsClean = state.gitStatus?.cleanHead ?? false;
  const headIsBuilt = state.gitStatus?.headIsBuilt ?? false;
  const permissionsCheckedAndIncomplete =
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted;
  const isBootstrapping = state.isBootstrapping;

  if (permissionsCheckedAndIncomplete) {
    return "permissions";
  }

  if (state.nixInstalled !== true || state.darwinRebuildAvailable !== true) {
    return "nix-setup";
  }

  if (isBootstrapping) {
    return "setup";
  }

  if (!(hasConfigDir && hasHost)) {
    return "setup";
  }

  if (state.showHistory) {
    return "history";
  }

  if (notMainBranch && headIsBuilt && headIsClean) {
    return "merge";
  }

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
