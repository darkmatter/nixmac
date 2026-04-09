import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { useApply } from "@/hooks/use-apply";
import { HistoryCurrentItemBadge } from "@/components/widget/history-current-item-badge";
import { HistoryBaseItemBadge } from "@/components/widget/history-base-item-badge";

interface HistoryRestoreItemButtonProps {
  hash: string;
  isBuilt?: boolean;
  isBase?: boolean;
  isRestoring?: boolean;
  onRequestRestore: (hash: string) => void;
}

export function HistoryRestoreItemButton({
  hash,
  isBuilt = false,
  isBase = false,
  isRestoring = false,
  onRequestRestore,
}: HistoryRestoreItemButtonProps) {
  const uncommittedChanges = useWidgetStore((s) => (s.gitStatus?.files?.length ?? 0) > 0);
  const isHead = useWidgetStore((s) => s.gitStatus?.headCommitHash === hash);
  const { handleHistoryBuild } = useApply();

  if (isBuilt) return <HistoryCurrentItemBadge />;
  if (isBase) return <HistoryBaseItemBadge />;

  const sharedClass = cn(
    "h-auto whitespace-nowrap border-white/10 bg-white/[0.06] px-[10px] py-1 text-[10px] text-neutral-400 hover:border-white/30",
    uncommittedChanges && "opacity-40 cursor-default hover:border-white/10 hover:bg-white/[0.06] hover:text-neutral-400",
  );

  if (isHead) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isRestoring}
        className={sharedClass}
        onClick={(e) => {
          e.stopPropagation();
          handleHistoryBuild();
        }}
      >
        <Wrench className="h-[10px] w-[10px]" />
        Build
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isRestoring}
      className={sharedClass}
      onClick={(e) => {
        e.stopPropagation();
        onRequestRestore(hash);
      }}
    >
      {isRestoring ? (
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
