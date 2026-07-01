import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";

interface HistoryRestoreItemButtonProps {
  hash: string;
  isRestoring?: boolean;
  onRequestRestore: (hash: string) => void;
}

export function HistoryRestoreItemButton({
  hash,
  isRestoring = false,
  onRequestRestore,
}: HistoryRestoreItemButtonProps) {
  const uncommittedChanges = useViewModel((s) => (s.git?.files?.length ?? 0) > 0);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isRestoring}
      className={cn(
        "h-auto whitespace-nowrap border-white/10 bg-white/6 px-[10px] py-1 text-[10px] text-neutral-400 hover:border-white/30",
        uncommittedChanges &&
          "opacity-40 cursor-default hover:border-white/10 hover:bg-white/6 hover:text-neutral-400",
      )}
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
          <RotateCcw className="h-[10px] w-[10px]" />
          Restore
        </>
      )}
    </Button>
  );
}
