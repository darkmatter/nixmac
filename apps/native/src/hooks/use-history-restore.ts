import { useCallback, useMemo, useState } from "react";
import { useWidgetStore } from "@/stores/widget-store";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { useHistory } from "@/hooks/use-history";
import { darwinAPI } from "@/tauri-api";
import type { HistoryItem } from "@/tauri-api";

// Sentinel hash used to identify the frontend-only preview item.
export const PREVIEW_ITEM_HASH = "n1xm4c0";

// ---------------------------------------------------------------------------
// Date / flat-list helpers
// ---------------------------------------------------------------------------

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getDayLabel(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export type FlatItem =
  | { type: "commit"; item: HistoryItem }
  | { type: "day-label"; label: string };

function buildFlatList(items: HistoryItem[]): FlatItem[] {
  const result: FlatItem[] = [];
  let lastLabel: string | null = null;
  for (const item of items) {
    const label = getDayLabel(item.createdAt);
    if (label !== lastLabel) {
      result.push({ type: "day-label", label });
      lastLabel = label;
    }
    result.push({ type: "commit", item });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Undone-group segmentation
// ---------------------------------------------------------------------------

export type HistorySegment = {
  kind: "normal" | "undone";
  items: FlatItem[];
};

/**
 * Builds the set of hashes that are currently "undone" (superseded by a restore).
 * Trusts backend is_undone for all real commits. The previewHash item is the
 * only one whose originHash is used to derive a preview zone — real restore
 * commits store the ultimate origin hash, so scanning their range would
 * incorrectly mark intermediate restore commits as undone.
 */
function buildUndoneSet(items: HistoryItem[], previewHash: string): Set<string> {
  const undone = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.isUndone) {
      undone.add(item.hash);
      continue;
    }
    if (item.hash === previewHash && item.originHash) {
      const originIdx = items.findIndex((h) => h.hash === item.originHash);
      if (originIdx !== -1) {
        for (let k = i + 1; k < originIdx; k++) {
          undone.add(items[k].hash);
        }
      }
    }
  }
  return undone;
}

/**
 * Groups a flat list (commits + day-label sentinels) into consecutive undone/normal
 * segments. Day labels look ahead to the next commit to decide which segment they
 * belong to — so labels introducing an undone day land inside the undone wrapper.
 */
function groupConsecutiveUndone(
  flatItems: FlatItem[],
  undoneSet: Set<string>,
): HistorySegment[] {
  const segments: HistorySegment[] = [];

  const kindOf = (fi: FlatItem): "normal" | "undone" =>
    fi.type === "commit" && undoneSet.has(fi.item.hash) ? "undone" : "normal";

  for (let i = 0; i < flatItems.length; i++) {
    const fi = flatItems[i];
    let kind: "normal" | "undone";

    if (fi.type === "day-label") {
      kind = "normal";
      for (let j = i + 1; j < flatItems.length; j++) {
        if (flatItems[j].type === "commit") {
          kind = kindOf(flatItems[j]);
          break;
        }
      }
    } else {
      kind = kindOf(fi);
    }

    const last = segments[segments.length - 1];
    if (last?.kind === kind) {
      last.items.push(fi);
    } else {
      segments.push({ kind, items: [fi] });
    }
  }

  return segments;
}

function lastCommitIn(items: FlatItem[]): string | null {
  const found = [...items].reverse().find((fi) => fi.type === "commit");
  return found?.type === "commit" ? found.item.hash : null;
}

function firstCommitIn(items: FlatItem[]): string | null {
  const found = items.find((fi) => fi.type === "commit");
  return found?.type === "commit" ? found.item.hash : null;
}

// ---------------------------------------------------------------------------
// Preview item factory
// ---------------------------------------------------------------------------

/**
 * Builds the synthetic preview item as a visual copy of the target commit.
 * Its originHash points back to itself so buildUndoneSet can compute the
 * correct undone zone between the preview and the restore target.
 */
function makePreviewItem(target: HistoryItem): HistoryItem {
  return {
    hash: PREVIEW_ITEM_HASH,
    message: `Restore Commit ${target.hash.slice(0, 7)}`,
    createdAt: Math.floor(Date.now() / 1000),
    isBuilt: false,
    isBase: false,
    isExternal: false,
    isUndone: false,
    isOrphanedRestore: false,
    fileCount: target.fileCount,
    commit: null,
    changeMap: target.changeMap,
    missedHashes: target.missedHashes,
    rawChanges: target.rawChanges,
    originMessage: target.message,
    originHash: target.hash,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface HistoryRestoreResult {
  displayHistory: HistoryItem[];
  segments: HistorySegment[];
  undoneSet: Set<string>;
  firstCommitHash: string | undefined;
  lastCommitHash: string | undefined;
  firstDayLabel: string | null;
  bottomFadeToUndoneHashes: Set<string>;
  topFadeFromUndoneHashes: Set<string>;
  restoringHash: string | null;
  previewTargetHash: string | null;
  previewDeactivateCount: number;
  handleRequestRestore: (hash: string) => void;
  handleConfirmRestore: () => void;
  handleCancelPreview: () => void;
}

export function useHistoryRestore(
  history: HistoryItem[],
  onUncommittedChanges: () => void,
): HistoryRestoreResult {
  const { loadHistory } = useHistory();
  const setProcessing = useWidgetStore((state) => state.setProcessing);
  const setGitStatus = useWidgetStore((state) => state.setGitStatus);
  const gitStatus = useWidgetStore((state) => state.gitStatus);
  const { triggerRebuild } = useRebuildStream();

  const [restoringHash, setRestoringHash] = useState<string | null>(null);
  const [previewTargetHash, setPreviewTargetHash] = useState<string | null>(null);

  // When a preview is active, prepend a synthetic item that looks like the
  // target. originHash points to the target so buildUndoneSet spans the correct
  // zone. previewTargetHash is always the resolved ultimate origin (never a
  // restore-of-a-restore), so doRestore avoids creating restore chains.
  const displayHistory = useMemo<HistoryItem[]>(() => {
    if (!previewTargetHash) return history;
    const target = history.find((h) => h.hash === previewTargetHash);
    if (!target) return history;
    return [makePreviewItem(target), ...history];
  }, [history, previewTargetHash]);

  // Segmentation — derived from displayHistory so preview zones are included.
  const undoneSet = buildUndoneSet(displayHistory, PREVIEW_ITEM_HASH);
  const flatList = buildFlatList(displayHistory);
  const segments = groupConsecutiveUndone(flatList, undoneSet);

  const firstCommitHash = displayHistory[0]?.hash;
  const lastCommitHash = displayHistory[displayHistory.length - 1]?.hash;
  const firstDayLabel = flatList[0]?.type === "day-label" ? flatList[0].label : null;

  const previewDeactivateCount = previewTargetHash
    ? Math.max(0, displayHistory.findIndex((h) => h.hash === previewTargetHash) - 1)
    : 0;

  const bottomFadeToUndoneHashes = new Set<string>();
  const topFadeFromUndoneHashes = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].kind !== "normal") continue;
    if (segments[i + 1]?.kind === "undone") {
      const hash = lastCommitIn(segments[i].items);
      if (hash) bottomFadeToUndoneHashes.add(hash);
    }
    if (segments[i - 1]?.kind === "undone") {
      const hash = firstCommitIn(segments[i].items);
      if (hash) topFadeFromUndoneHashes.add(hash);
    }
  }

  const doRestore = useCallback(
    async (hash: string) => {
      setRestoringHash(hash);
      setProcessing(true);
      try {
        await darwinAPI.darwin.prepareRestore(hash);
        await triggerRebuild({
          context: "rollback",
          deferBuiltTag: true,
          onSuccess: async () => {
            const result = await darwinAPI.darwin.finalizeRestore(hash);
            setGitStatus(result);
            await loadHistory();
          },
          onFailure: async () => {
            await darwinAPI.darwin.abortRestore();
          },
        });
      } catch {
        setProcessing(false);
      } finally {
        setRestoringHash(null);
      }
    },
    [loadHistory, setProcessing, setGitStatus, triggerRebuild],
  );

  const handleRequestRestore = useCallback(
    (hash: string) => {
      if ((gitStatus?.files?.length ?? 0) > 0) {
        onUncommittedChanges();
        return;
      }
      const item = history.find((h) => h.hash === hash);
      setPreviewTargetHash(item?.originHash ?? hash);
    },
    [gitStatus, history, onUncommittedChanges],
  );

  const handleConfirmRestore = useCallback(() => {
    if (!previewTargetHash) return;
    const hash = previewTargetHash;
    setPreviewTargetHash(null);
    doRestore(hash);
  }, [previewTargetHash, doRestore]);

  const handleCancelPreview = useCallback(() => {
    setPreviewTargetHash(null);
  }, []);

  return {
    displayHistory,
    segments,
    undoneSet,
    firstCommitHash,
    lastCommitHash,
    firstDayLabel,
    bottomFadeToUndoneHashes,
    topFadeFromUndoneHashes,
    restoringHash,
    previewTargetHash,
    previewDeactivateCount,
    handleRequestRestore,
    handleConfirmRestore,
    handleCancelPreview,
  };
}
