import { ScrollArea } from "@/components/ui/scroll-area";
import { DiscardUncommittedDialog } from "@/components/widget/history/discard-uncommitted-dialog";
import { HistoryDayLabel } from "@/components/widget/history/history-day-label";
import { HistoryHeader } from "@/components/widget/history/history-header";
import { HistoryItemCard } from "@/components/widget/history/history-item-card";
import { UncommittedChangesDetected } from "@/components/widget/notifications/uncommitted-changes-detected";
import { useHistoryQuery } from "@/hooks/use-history";
import { PREVIEW_ITEM_HASH, useHistoryRestore } from "@/hooks/use-history-restore";
import { useLazyHistorySummarize } from "@/hooks/use-lazy-history-summarize";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function HistoryStep() {
  const { history, total, hasNextPage, fetchNextPage, isFetchingNextPage } = useHistoryQuery();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [isFlashing, setIsFlashing] = useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);

  const { observeItem } = useLazyHistorySummarize({
    history,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  const handleUncommittedChanges = () => {
    const viewport = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    viewport?.scrollTo({ top: 0, behavior: "smooth" });
    setIsFlashing(true);
  };

  const {
    restoringHash,
    previewTargetHash,
    previewDeactivateCount,
    segments,
    undoneSet,
    firstCommitHash,
    lastCommitHash,
    firstDayLabel,
    bottomFadeToUndoneHashes,
    topFadeFromUndoneHashes,
    handleRequestRestore,
    handleConfirmRestore,
    handleCancelPreview,
  } = useHistoryRestore(history, handleUncommittedChanges);

  // Scroll to top when preview activates so the synthetic commit is visible.
  useEffect(() => {
    if (!previewTargetHash) return;
    const viewport = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    viewport?.scrollTo({ top: 0, behavior: "smooth" });
  }, [previewTargetHash]);

  return (
    <>
      <HistoryHeader count={total} />
      <div ref={scrollAreaRef} className="flex-1 min-h-0">
        <ScrollArea className="h-full pb-3 pr-4">
          <UncommittedChangesDetected
            isFlashing={isFlashing}
            onOpenDialog={() => setIsDiscardDialogOpen(true)}
          />
          {segments.map((segment, si) => (
            <div key={si}>
              {segment.items.map((fi) => {
                if (fi.type === "day-label") {
                  return (
                    <HistoryDayLabel
                      key={fi.label}
                      label={fi.label}
                      isFirst={fi.label === firstDayLabel}
                      isUndone={segment.kind === "undone"}
                    />
                  );
                }
                return (
                  <div key={fi.item.hash} ref={observeItem} data-history-hash={fi.item.hash}>
                    <HistoryItemCard
                      item={fi.item}
                      isRestoring={fi.item.hash === restoringHash}
                      isPreview={fi.item.hash === PREVIEW_ITEM_HASH}
                      isPreviewActive={!!previewTargetHash}
                      deactivateCount={
                        fi.item.hash === PREVIEW_ITEM_HASH ? previewDeactivateCount : undefined
                      }
                      timeline={{
                        isFirst: fi.item.hash === firstCommitHash,
                        isLast: fi.item.hash === lastCommitHash,
                        isUndone: undoneSet.has(fi.item.hash),
                        bottomFadeToUndone: bottomFadeToUndoneHashes.has(fi.item.hash),
                        topFadeFromUndone: topFadeFromUndoneHashes.has(fi.item.hash),
                      }}
                      onRequestRestore={handleRequestRestore}
                      onConfirmRestore={handleConfirmRestore}
                      onCancelRestore={handleCancelPreview}
                    />
                  </div>
                );
              })}
            </div>
          ))}
          {isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-neutral-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading older commits…
            </div>
          )}
        </ScrollArea>
      </div>
      <DiscardUncommittedDialog open={isDiscardDialogOpen} onOpenChange={setIsDiscardDialogOpen} />
    </>
  );
}
