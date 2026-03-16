import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { darwinAPI } from "@/tauri-api";
import { useRebuildStream } from "@/hooks/use-rebuild-stream";
import { HistoryCurrentItemBadge } from "@/components/widget/history-current-item-badge";

interface HistoryRestoreItemButtonProps {
  hash: string;
  isBuilt?: boolean;
}

export function HistoryRestoreItemButton({ hash, isBuilt = false }: HistoryRestoreItemButtonProps) {
  const [restoring, setRestoring] = useState(false);
  const { triggerRebuild } = useRebuildStream();

  const handleRestore = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setRestoring(true);
      try {
        await darwinAPI.darwin.restoreToCommit(hash);
        await triggerRebuild({ context: "rollback" });
      } catch {
        setRestoring(false);
      }
    },
    [hash, triggerRebuild],
  );

  if (isBuilt) return <HistoryCurrentItemBadge />;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={restoring}
      className="h-auto whitespace-nowrap border-white/10 bg-white/[0.06] px-[10px] py-1 text-[10px] text-neutral-400 hover:border-white/30"
      onClick={handleRestore}
    >
      {restoring ? (
        <>
          <Loader2 className="h-[10px] w-[10px] animate-spin" />
          Restoring…
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8a6 6 0 1 1 1.5 3.96"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M2 12V8h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Restore
        </>
      )}
    </Button>
  );
}
