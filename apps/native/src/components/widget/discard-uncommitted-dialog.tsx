import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfigDirBadge } from "@/components/widget/config-dir-badge";
import { useRollback } from "@/hooks/use-rollback";
import { useWidgetStore } from "@/stores/widget-store";
import { toast } from "sonner";

interface DiscardUncommittedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DiscardUncommittedDialog({ open, onOpenChange }: DiscardUncommittedDialogProps) {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const configDir = useWidgetStore((s) => s.configDir);
  const files = gitStatus?.files ?? [];
  const { handleRollback } = useRollback();

  const handleDiscard = async () => {
    await handleRollback();
    const remaining = useWidgetStore.getState().gitStatus?.files?.length ?? 1;
    if (remaining === 0) {
      toast.success("Changes discarded");
      onOpenChange(false);
    } else {
      toast.error("Failed to discard changes");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 border-2 border-rose-300/30 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-sm font-semibold mb-1">
            Uncommitted changes in <ConfigDirBadge configDir={configDir} />
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-xs text-muted-foreground">
              {files.length > 0 && (
                <ul className="space-y-2 mt-1">
                  {files.slice(0, 5).map((f) => (
                    <li key={f.path} className="flex items-center gap-2">
                      <span className="font-mono truncate">{f.path}</span>
                      <span className="shrink-0 opacity-60">({f.changeType})</span>
                    </li>
                  ))}
                  {files.length > 5 && (
                    <li className="opacity-60">…and {files.length - 5} more</li>
                  )}
                </ul>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="border-t border-border/50 px-5 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Discard all uncommitted changes. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-rose-300/50 text-rose-300 hover:border-rose-300 hover:text-rose-300"
              onClick={handleDiscard}
            >
              Discard changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
