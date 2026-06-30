import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EtcClobberConflictList } from "@/components/widget/overlays/etc-clobber-conflict-list";
import { uiActions, useUiState } from "@nixmac/state";

export function EtcClobberWarningDialog() {
  const open = useUiState((state) => state.etcClobberDialogOpen);
  const etcClobber = useUiState((state) => state.etcClobber);

  const handleOpenChange = (nextOpen: boolean) => {
    uiActions.setEtcClobberDialogOpen(nextOpen);
    if (!nextOpen) {
      uiActions.setEtcClobber(null);
    }
  };

  const handleDismiss = () => {
    handleOpenChange(false);
  };

  if (!etcClobber) {
    return null;
  }

  const hasHardConflicts = etcClobber.conflicts.length > 0;
  const hasWarnings = etcClobber.warnings.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden border-2 border-amber-300/30 p-0">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="mb-1 font-semibold text-sm">
            {hasHardConflicts ? "Existing /etc files would be overwritten" : "Managed files will be backed up"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-muted-foreground text-xs">
              {hasHardConflicts ? (
                <p>
                  nix-darwin would refuse to activate because these files are not currently
                  managed by its /etc symlink tree. No build or activation was started.
                </p>
              ) : (
                <p>
                  Home Manager found existing generated-file targets. Apply will continue, and
                  activation will move these files aside before linking the managed versions.
                </p>
              )}
              <EtcClobberConflictList result={etcClobber} className="max-w-none" />
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-border/50 border-t px-5 py-4">
          {hasHardConflicts ? (
            <p className="text-muted-foreground text-xs">
              Back up anything important, then rename each listed file by adding
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">.before-nix-darwin</code>
              to the end and try Apply again.
            </p>
          ) : hasWarnings ? (
            <p className="text-muted-foreground text-xs">
              Review the listed files if you care about their current contents. The apply has already
              continued; Home Manager will preserve each one using the configured backup suffix.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleDismiss}>
              Got it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
