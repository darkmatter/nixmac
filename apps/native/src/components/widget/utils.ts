import { filesystemViewEnabled } from "@/lib/flags";
import type { EvolveState, PermissionsState } from "@/ipc/types";
import type { WidgetStep } from "@/types/widget";
import { FilePen, FilePlus, FileX, FileCode, type LucideIcon } from "lucide-react";

type CurrentStepState = {
  configDir: string;
  host: string;
  hosts: string[];
  permissionsChecked: boolean;
  permissionsState: PermissionsState | null;
  nixInstalled: boolean | null;
  darwinRebuildAvailable: boolean | null;
  isBootstrapping: boolean;
  showHistory: boolean;
  showFilesystem: boolean;
  evolveState: EvolveState | null;
};

export function computeCurrentStep(state: CurrentStepState): WidgetStep {
  const hasConfigDir = !!state.configDir;
  const hasHost = !!state.host && state.hosts.includes(state.host);
  const permissionsCheckedAndIncomplete =
    state.permissionsChecked &&
    state.permissionsState &&
    !state.permissionsState.allRequiredGranted;

  if (permissionsCheckedAndIncomplete) {
    return "permissions";
  }

  if (
    (state.nixInstalled !== true || state.darwinRebuildAvailable !== true) &&
    settings.NIX_INSTALLED_OVERRIDE !== true // bypass used for testing
  ) {
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

  if (state.showFilesystem && filesystemViewEnabled) {
    return "filesystem";
  }

  // Backend is the source of truth for evolve routing
  return state.evolveState?.step ?? "begin";
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

// =============================================================================
// SUMMARY CATEGORY COLORS
// =============================================================================

export type CategoryStyle = {
  text: string;
  bg: string;
  dot: string;
  border: string;
};

const EMERALD: CategoryStyle = {
  text: "text-emerald-500",
  bg: "bg-emerald-500/[0.08]",
  dot: "bg-emerald-500",
  border: "border-emerald-500/40",
};
const BLUE: CategoryStyle = {
  text: "text-blue-500",
  bg: "bg-blue-500/[0.08]",
  dot: "bg-blue-500",
  border: "border-blue-500/40",
};
const AMBER: CategoryStyle = {
  text: "text-amber-500",
  bg: "bg-amber-500/[0.08]",
  dot: "bg-amber-500",
  border: "border-amber-500/40",
};
const VIOLET: CategoryStyle = {
  text: "text-violet-500",
  bg: "bg-violet-500/[0.08]",
  dot: "bg-violet-500",
  border: "border-violet-500/40",
};
const GRAY: CategoryStyle = {
  text: "text-gray-500",
  bg: "bg-gray-500/[0.08]",
  dot: "bg-gray-500",
  border: "border-gray-500/40",
};

const CATEGORY_PALETTE: CategoryStyle[] = [EMERALD, BLUE, AMBER, VIOLET, GRAY];

const KEYWORD_STYLES: Array<{ keywords: string[]; style: CategoryStyle }> = [
  {
    keywords: ["config", "settings", "option", "nix", "darwin", "home", "profile"],
    style: EMERALD,
  },
  {
    keywords: ["service", "system", "network", "daemon", "module"],
    style: BLUE,
  },
  {
    keywords: ["package", "program", "install", "app", "plugin", "tool"],
    style: AMBER,
  },
  {
    keywords: ["theme", "visual", "color", "style", "font", "ui", "appearance"],
    style: VIOLET,
  },
];

export function getCategoryStyle(title: string): CategoryStyle {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

export type ColorMap = Map<string, CategoryStyle>;

import type { Change, ChangeType, SemanticChangeMap } from "@/ipc/types";
import { settings } from "@/lib/env";

export function buildColorMap(changeMap: SemanticChangeMap): ColorMap {
  const map: ColorMap = new Map();
  const used = new Set<CategoryStyle>();
  const assignable = [EMERALD, BLUE, AMBER, VIOLET];

  const assign = (key: string, title: string, forceColor: boolean) => {
    const lower = title.toLowerCase();
    const preferred =
      KEYWORD_STYLES.find(({ keywords }) => keywords.some((k) => lower.includes(k)))?.style ?? null;

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

// =============================================================================
// CHANGE CATEGORY COLORS
// =============================================================================

type ChangeTypeStyle = {
  icon: LucideIcon;
  bg: string;
  iconColor: string;
};

export const CHANGE_TYPE_STYLES: Record<ChangeType, ChangeTypeStyle> = {
  new: { icon: FilePlus, bg: "bg-emerald-300/[0.07]", iconColor: "text-emerald-400" },
  edited: { icon: FilePen, bg: "bg-white/[0.06]", iconColor: "text-neutral-400" },
  removed: { icon: FileX, bg: "bg-red-500/[0.07]", iconColor: "text-red-400" },
  renamed: { icon: FileCode, bg: "bg-white/[0.06]", iconColor: "text-neutral-400" },
};

export type ChangeWithRichType = Change & {
  changeType: ChangeType;
  oldFilename?: string;
  shortFilename?: string;
  hasMultipleHunks?: boolean;
};

export type ChangeFileSummary = ChangeWithRichType & {
  hunkCount: number;
};

export function inferChangeType(diff: string): ChangeType {
  if (/^@@ -0(?:,0)? \+/.test(diff)) return "new";
  if (/^@@ -\d+(?:,\d+)? \+0(?:,0)? @@/.test(diff)) return "removed";
  return "edited";
}

type RenamePair = {
  oldChange: ChangeWithRichType;
  newChange: ChangeWithRichType;
};

function findRenamePairs(changes: ChangeWithRichType[]): RenamePair[] {
  const pairs: RenamePair[] = [];
  const newFiles = changes.filter((c) => c.changeType === "new");
  for (const newFile of newFiles) {
    const removedFiles = changes.filter(
      (c) => c.shortFilename === newFile.shortFilename && c.changeType === "removed",
    );
    if (removedFiles.length === 1) {
      pairs.push({ oldChange: removedFiles[0], newChange: newFile });
    }
  }
  return pairs;
}

export function categorizeRenamed(changes: ChangeWithRichType[]): ChangeWithRichType[] {
  const pairs = findRenamePairs(changes);
  const consumedRemovals = new Set<string>();
  const renamedChanges: ChangeWithRichType[] = [];

  for (const { oldChange, newChange } of pairs) {
    newChange.oldFilename = oldChange.filename;
    newChange.changeType = "renamed";
    consumedRemovals.add(oldChange.diff);
    renamedChanges.push(newChange);
  }

  const remainingChanges = changes.filter(
    (c) => !renamedChanges.includes(c) && !consumedRemovals.has(c.diff),
  );
  return [...remainingChanges, ...renamedChanges];
}

function changeFileKey(change: ChangeWithRichType): string {
  return [change.oldFilename ?? "", change.filename].join("\0");
}

function combineChangeTypes(a: ChangeType, b: ChangeType): ChangeType {
  if (a === b) return a;
  if (a === "renamed" || b === "renamed") return "renamed";
  return "edited";
}

export function summarizeChangesByFile(changes: ChangeWithRichType[]): ChangeFileSummary[] {
  const byFile = new Map<string, ChangeFileSummary>();

  for (const change of changes) {
    const key = changeFileKey(change);
    const existing = byFile.get(key);

    if (!existing) {
      byFile.set(key, { ...change, hunkCount: 1 });
      continue;
    }

    existing.hunkCount += 1;
    existing.lineCount += change.lineCount;
    existing.changeType = combineChangeTypes(existing.changeType, change.changeType);
  }

  return Array.from(byFile.values());
}

export function getModStartLine(diff: string): number | null {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(diff);
  return match ? parseInt(match[1]) : null;
}

export function newFileContentFromDiffs(diffs: string[]): string | null {
  const lines: string[] = [];
  let sawNewFileHunk = false;

  for (const diff of diffs) {
    let inNewFileHunk = false;

    for (const line of diff.split("\n")) {
      if (/^@@ -0(?:,0)? \+/.test(line)) {
        sawNewFileHunk = true;
        inNewFileHunk = true;
        continue;
      }

      if (line.startsWith("@@ ")) {
        inNewFileHunk = false;
        continue;
      }

      if (!inNewFileHunk || line === "\\ No newline at end of file") {
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push(line.slice(1));
      }
    }
  }

  return sawNewFileHunk ? lines.join("\n") : null;
}

export function enrichChanges(changes: Change[]): ChangeWithRichType[] {
  return changes
    .map((c) => ({
      ...c,
      changeType: inferChangeType(c.diff),
    }))
    .map<ChangeWithRichType>((c) => ({
      ...c,
      shortFilename: getShortFilename(c.filename),
    }));
}
