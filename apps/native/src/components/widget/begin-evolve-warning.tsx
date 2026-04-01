"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfigDirBadge } from "@/components/widget/config-dir-badge";
import { useEvolve } from "@/hooks/use-evolve";
import { useGitOperations } from "@/hooks/use-git-operations";
import { useRollback } from "@/hooks/use-rollback";
import { useWidgetStore } from "@/stores/widget-store";
import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface BeginEvolveWarningProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handleEvolve: () => Promise<void>;
}

type BuildCheckStatus = "checking" | "passed" | "failed";

export function BeginEvolveWarning({ open, onOpenChange, handleEvolve }: BeginEvolveWarningProps) {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const evolvePrompt = useWidgetStore((s) => s.evolvePrompt);
  const configDir = useWidgetStore((s) => s.configDir);
  const files = gitStatus?.files ?? [];

  const { evolveFromManual, buildCheck } = useEvolve();
  const { handleRollback } = useRollback();
  const { handleCommit: gitHandleCommit } = useGitOperations();

  const [buildStatus, setBuildStatus] = useState<BuildCheckStatus>("checking");
  const [adoptOnContinue, setAdoptOnContinue] = useState(false);
  const commitRef = useRef<HTMLInputElement>(null);

  // Clean working tree means a discard or commit succeeded — continue is enabled.
  const canContinue = files.length === 0;

  useEffect(() => {
    if (!open) {
      setBuildStatus("checking");
      setAdoptOnContinue(false);
      return;
    }
    buildCheck()
      .then(({ passed }) => setBuildStatus(passed ? "passed" : "failed"))
      .catch(() => setBuildStatus("failed"));
  }, [open, buildCheck]);

  const handleDiscard = async () => {
    await handleRollback();
    const newFiles = useWidgetStore.getState().gitStatus?.files?.length ?? 1;
    if (newFiles === 0) {
      toast.success("Changes discarded");
    } else {
      toast.error("Failed to discard changes");
    }
  };

  const handleCommit = async () => {
    const message = commitRef.current?.value.trim();
    if (!message) return;
    await gitHandleCommit(message);
  };

  const handleContinue = async () => {
    if (adoptOnContinue) {
      onOpenChange(false);
      useWidgetStore.getState().setGenerating(true);
      try {
        await evolveFromManual();
        // evolveFromManual persists evolveState on the backend; handleEvolve picks it up
        await handleEvolve();
      } catch {
        toast.error("Failed to adopt changes");
        useWidgetStore.getState().setGenerating(false);
      }
    } else {
      onOpenChange(false);
      await handleEvolve();
    }
  };

  const buildChecking = buildStatus === "checking";
  const buildPassed = buildStatus === "passed";
  const continueEnabled = canContinue || adoptOnContinue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 border-2 border-rose-300/30 p-0 overflow-hidden flex flex-col max-h-[85vh]">
        <DialogHeader className="px-5 pt-5 pb-4 shrink-0">
          <DialogTitle className="text-sm font-semibold mb-1">
            Can't proceed — changes in <ConfigDirBadge configDir={configDir} />:
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-xs text-muted-foreground space-y-.5">
              {files.length > 0 && (
                <ul className="space-y-2">
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

        <p className="px-5 py-3 text-xs font-semibold text-foreground">First, decide how to handle uncommitted changes.</p>
        <div className="overflow-y-auto flex-1 min-h-0 border-t border-border/50 divide-y divide-border/50">
          {/* Option 1: Discard */}
          <div className="px-5 py-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold tabular-nums text-muted-foreground">
                1
              </span>
              <p className="text-xs font-semibold text-foreground">Discard changes</p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground flex-1">Permanently remove all uncommitted changes.</p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-rose-300/50 text-rose-300 hover:border-rose-300 hover:text-rose-300"
                disabled={canContinue}
                onClick={handleDiscard}
              >
                Discard
              </Button>
            </div>
          </div>

          {buildStatus === "failed" && (
            <div className="px-5 py-2.5 flex items-center gap-2 bg-rose-950/30 text-xs text-rose-300/80">
              <X className="h-3 w-3 shrink-0" />
              Configuration failed build check — further options are unavailable.
            </div>
          )}

          {/* Option 2: Commit */}
          <div className="px-5 py-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold tabular-nums text-muted-foreground">
                {buildChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : buildPassed ? 2 : <X className="h-3 w-3" />}
              </span>
              <p className="text-xs font-semibold text-foreground">Commit changes</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {buildChecking ? "checking build…" : "Stage and commit with a message."}
            </p>
            <div className="flex gap-2">
              <Input
                ref={commitRef}
                placeholder="Commit message…"
                className="h-8 text-xs"
                disabled={buildChecking || !buildPassed}
                onKeyDown={(e) => { if (e.key === "Enter") handleCommit(); }}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-border/50 hover:border-border"
                disabled={buildChecking || !buildPassed}
                onClick={handleCommit}
              >
                Commit
              </Button>
            </div>
          </div>

          {/* Option 3: Adopt */}
          <div className="px-5 py-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold tabular-nums text-muted-foreground">
                {buildChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : buildPassed ? 3 : <X className="h-3 w-3" />}
              </span>
              <p className="text-xs font-semibold text-foreground">Include in evolution</p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <p className="text-xs text-muted-foreground flex-1">{buildChecking ? `checking build…` : `Adopt the changes into your request, and save them together at the end.`}</p>
              <Checkbox
                checked={adoptOnContinue}
                onCheckedChange={(checked) => setAdoptOnContinue(!!checked)}
                disabled={buildChecking || !buildPassed}
                className="mt-0.5 shrink-0"
              />
            </label>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border/50 shrink-0 flex flex-col items-center gap-3">
          {evolvePrompt && (
            <div className="w-full rounded-md border border-border/50 mb-2">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
                <img src="/outline-white.png" alt="" className="h-4 w-4 object-contain" />
                <span className="text-xs font-medium">Your request</span>
              </div>
              <p className="px-3 py-2 text-xs text-muted-foreground truncate">{evolvePrompt}</p>
            </div>
          )}
          <Button
            size="sm"
            disabled={!continueEnabled}
            onClick={handleContinue}
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
