import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { useApply } from "@/hooks/use-apply";

interface BuildHeadButtonProps {
  isRestoring?: boolean;
}

export function BuildHeadButton({ isRestoring = false }: BuildHeadButtonProps) {
  const uncommittedChanges = useWidgetStore((s) => (s.gitStatus?.files?.length ?? 0) > 0);
  const { handleHistoryBuild } = useApply();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isRestoring}
      className={cn(
        "h-auto whitespace-nowrap border-white/10 bg-white/[0.06] px-[10px] py-1 text-[10px] text-neutral-400 hover:border-white/30",
        uncommittedChanges && "opacity-40 cursor-default hover:border-white/10 hover:bg-white/[0.06] hover:text-neutral-400",
      )}
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
