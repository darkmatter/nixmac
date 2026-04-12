import type { RefObject } from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { ConfigDirBadge } from "@/components/widget/config-dir-badge";
import { Button } from "@/components/ui/button";

interface UncommittedChangesDetectedProps {
  ref?: RefObject<HTMLDivElement | null>;
  isFlashing: boolean;
  onOpenDialog: () => void;
}

export function UncommittedChangesDetected({
  ref,
  isFlashing,
  onOpenDialog,
}: UncommittedChangesDetectedProps) {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const configDir = useWidgetStore((s) => s.configDir);
  const fileCount = gitStatus?.files?.length ?? 0;

  if (fileCount === 0) return null;

  return (
    <div
      ref={ref}
      className="flex w-full shrink-0 items-center justify-between gap-2 border-b border-rose-300/20 px-2 py-1.5 text-xs text-muted-foreground"
    >
      <span className="flex items-center gap-1.5 flex-wrap">
        {fileCount} uncommitted {fileCount === 1 ? "change" : "changes"} in
        <ConfigDirBadge configDir={configDir} />
        <span className="text-xs">(restore is disabled)</span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onOpenDialog}
        className={cn(
          "text-xs px-2 border-rose-300/50 text-rose-300 hover:border-rose-300 hover:text-rose-300",
          isFlashing && "animate-attention-flash-text",
        )}
      >
        <Eraser className="h-2 w-2 mb-[2px]" />
        Discard
      </Button>
    </div>
  );
}
