import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HistoryConfirmRestoreButtonProps {
  deactivateCount?: number;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function HistoryConfirmRestoreButton({ deactivateCount, onConfirm, onCancel }: HistoryConfirmRestoreButtonProps) {
  return (
    <div className="relative flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto whitespace-nowrap border-teal-400/30 bg-teal-400/10 px-[10px] py-1 text-[10px] text-teal-400 hover:border-teal-400/50 hover:bg-teal-400/15"
          onClick={(e) => { e.stopPropagation(); onConfirm?.(); }}
        >
          <RotateCcw className="h-[10px] w-[10px]" />
          Confirm Restore
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto whitespace-nowrap border-white/10 bg-white/[0.06] px-[10px] py-1 text-[10px] text-neutral-500 hover:border-white/20 hover:text-neutral-400"
          onClick={(e) => { e.stopPropagation(); onCancel?.(); }}
        >
          <X className="h-[10px] w-[10px]" />
          Cancel
        </Button>
      </div>
      {deactivateCount !== undefined && deactivateCount > 0 && (
        <div className="absolute top-full left-[4px] mt-1">
          <p className="whitespace-nowrap text-left text-[10px] leading-tight text-neutral-500">
            This will deactivate {deactivateCount} commit{deactivateCount !== 1 ? "s" : ""}.
          </p>
          <p className="whitespace-nowrap text-left text-[10px] leading-tight text-neutral-500">
            Deactivated commits will stay in history.
          </p>
          <p className="whitespace-nowrap text-left text-[10px] leading-tight text-neutral-500">
            You can restore them again later.
          </p>
        </div>
      )}
    </div>
  );
}
