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

const EMERALD: CategoryStyle = { text: "text-emerald-500", bg: "bg-emerald-500/[0.08]", dot: "bg-emerald-500", border: "border-emerald-500/40" };
const BLUE: CategoryStyle    = { text: "text-blue-500",    bg: "bg-blue-500/[0.08]",    dot: "bg-blue-500",    border: "border-blue-500/40" };
const AMBER: CategoryStyle   = { text: "text-amber-500",   bg: "bg-amber-500/[0.08]",   dot: "bg-amber-500",   border: "border-amber-500/40" };
const VIOLET: CategoryStyle  = { text: "text-violet-500",  bg: "bg-violet-500/[0.08]",  dot: "bg-violet-500",  border: "border-violet-500/40" };
const GRAY: CategoryStyle    = { text: "text-gray-500",    bg: "bg-gray-500/[0.08]",    dot: "bg-gray-500",    border: "border-gray-500/40" };

const CATEGORY_PALETTE: CategoryStyle[] = [EMERALD, BLUE, AMBER, VIOLET, GRAY];

const KEYWORD_STYLES: Array<{ keywords: string[]; style: CategoryStyle }> = [
  { keywords: ["config", "settings", "option", "nix", "darwin", "home", "profile"], style: EMERALD },
  { keywords: ["service", "system", "network", "daemon", "module"],                 style: BLUE },
  { keywords: ["package", "program", "install", "app", "plugin", "tool"],           style: AMBER },
  { keywords: ["theme", "visual", "color", "style", "font", "ui", "appearance"],    style: VIOLET },
];

export function getCategoryStyle(title: string): CategoryStyle {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

export type ColorMap = Map<string, CategoryStyle>;

import type { SemanticChangeMap } from "@/types/shared";

export function buildColorMap(changeMap: SemanticChangeMap): ColorMap {
  const map: ColorMap = new Map();
  const used = new Set<CategoryStyle>();
  const assignable = [EMERALD, BLUE, AMBER, VIOLET];

  const assign = (key: string, title: string, forceColor: boolean) => {
    const lower = title.toLowerCase();
    const preferred = KEYWORD_STYLES.find(({ keywords }) => keywords.some((k) => lower.includes(k)))?.style ?? null;

    if (preferred && !used.has(preferred)) {
      map.set(key, preferred);
      used.add(preferred);
    } else {
      const next = assignable.find((s) => !used.has(s));
      if (next) {
        map.set(key, next);
        used.add(next);
      } else {
        map.set(key, forceColor ? (preferred ?? GRAY) : GRAY);
      }
    }
  };

  for (const g of changeMap.groups) assign(String(g.summary.id), g.summary.title, true);
  for (const s of changeMap.singles) assign(s.hash, s.title, false);

  return map;
}

export function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
