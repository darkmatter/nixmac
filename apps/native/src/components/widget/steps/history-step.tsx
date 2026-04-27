import { useCallback, useEffect, useRef, useState } from "react";
import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import { useHistoryRestore, PREVIEW_ITEM_HASH } from "@/hooks/use-history-restore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HistoryDayLabel } from "@/components/widget/history/history-day-label";
import { HistoryHeader } from "@/components/widget/history/history-header";
import { HistoryItemCard } from "@/components/widget/history/history-item-card";
import { UncommittedChangesDetected } from "@/components/widget/uncommitted-changes-detected";
import { DiscardUncommittedDialog } from "@/components/widget/discard-uncommitted-dialog";

export function HistoryStep() {
  const { loadHistory } = useHistory();
  const history = useWidgetStore((state) => state.history);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [isFlashing, setIsFlashing] = useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleUncommittedChanges = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    viewport?.scrollTo({ top: 0, behavior: "smooth" });
    setIsFlashing(true);
  }, []);

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
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    viewport?.scrollTo({ top: 0, behavior: "smooth" });
  }, [previewTargetHash]);

  return (
    <div data-testid="history-step" className="flex min-h-0 flex-1 flex-col">
      <HistoryHeader count={history.length} />
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
                  <HistoryItemCard
                    key={fi.item.hash}
                    item={fi.item}
                    isRestoring={fi.item.hash === restoringHash}
                    isPreview={fi.item.hash === PREVIEW_ITEM_HASH}
                    isPreviewActive={!!previewTargetHash}
                    deactivateCount={fi.item.hash === PREVIEW_ITEM_HASH ? previewDeactivateCount : undefined}
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
                );
              })}
            </div>
          ))}
        </ScrollArea>
      </div>
      <DiscardUncommittedDialog
        open={isDiscardDialogOpen}
        onOpenChange={setIsDiscardDialogOpen}
      />
    </div>
  );
}
