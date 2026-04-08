import { useCallback, useEffect, useRef, useState } from "react";
import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { darwinAPI } from "@/tauri-api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupByDay } from "@/components/widget/utils";
import { HistoryDayLabel } from "@/components/widget/history-day-label";
import { HistoryHeader } from "@/components/widget/history-header";
import { HistoryItemCard } from "@/components/widget/history-item-card";
import { UncommittedChangesDetected } from "@/components/widget/uncommitted-changes-detected";
import { DiscardUncommittedDialog } from "@/components/widget/discard-uncommitted-dialog";

export function HistoryStep() {
  const { loadHistory } = useHistory();
  const history = useWidgetStore((state) => state.history);
  const gitStatus = useWidgetStore((state) => state.gitStatus);
  const setProcessing = useWidgetStore((state) => state.setProcessing);
  const { triggerRebuild } = useRebuildStream();

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [restoringHash, setRestoringHash] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const doRestore = useCallback(
    async (hash: string) => {
      setRestoringHash(hash);
      setProcessing(true);
      try {
        await darwinAPI.darwin.restoreToCommit(hash);
        await triggerRebuild({ context: "rollback" });
      } catch {
        setProcessing(false);
      } finally {
        setRestoringHash(null);
      }
    },
    [setProcessing, triggerRebuild],
  );

  const handleRequestRestore = useCallback(
    (hash: string) => {
      const uncommittedChanges = (gitStatus?.files?.length ?? 0) > 0;
      if (uncommittedChanges) {
        const viewport = scrollAreaRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]",
        );
        viewport?.scrollTo({ top: 0, behavior: "smooth" });
        setIsFlashing(true);
        return;
      }
      doRestore(hash);
    },
    [gitStatus, doRestore],
  );

  const historyByDay = groupByDay(history);

  return (
    <>
      <HistoryHeader count={history.length} />
      <div ref={scrollAreaRef} className="flex-1 min-h-0">
        <ScrollArea className="h-full pb-3 pr-4">
          <UncommittedChangesDetected
            isFlashing={isFlashing}
            onOpenDialog={() => setIsDiscardDialogOpen(true)}
          />
          {historyByDay.map(({ label, items }) => (
            <div key={label}>
              <HistoryDayLabel label={label} />
              {items.map((item) => (
                <HistoryItemCard
                  key={item.hash}
                  item={item}
                  isRestoring={item.hash === restoringHash}
                  onRequestRestore={handleRequestRestore}
                />
              ))}
            </div>
          ))}
        </ScrollArea>
      </div>
      <DiscardUncommittedDialog
        open={isDiscardDialogOpen}
        onOpenChange={setIsDiscardDialogOpen}
      />
    </>
  );
}
