"use client";

import { AnimatedTabsList, AnimatedTabsTrigger } from "@/components/ui/animated-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs } from "@/components/ui/tabs";
import { CheckConfirmationOff } from "@/components/widget/controls/check-confirmation-off";
import { ConfirmationDialog } from "@/components/widget/controls/confirmation-dialog";
import { DriftFileRow } from "@/components/widget/drift/drift-file-row";
import { DriftSummaryView } from "@/components/widget/drift/drift-summary-view";
import { deriveDriftFiles, formatDriftCounts, summarizeDriftCounts } from "@/components/widget/drift/drift-utils";
import { useConfirm } from "@/hooks/use-confirm";
import { useRollback } from "@/hooks/use-rollback";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";
import { CheckCircle, ChevronDown, ListTree, MessageSquareText, RefreshCw, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

interface SummaryOrDiffProps {
  variant?: "default" | "outline";
  onKeepChanges?: () => void;
  onRefineFurther?: () => void;
  showActions?: boolean;
  actionSlot?: ReactNode;
  undoLabel?: string;
  showHeaderDelta?: boolean;
}

export function SummaryOrDiff({
  variant = "default",
  onKeepChanges,
  onRefineFurther,
  showActions = true,
  actionSlot,
  undoLabel = "Undo Changes",
  showHeaderDelta = true,
}: SummaryOrDiffProps) {
  const gitStatus = useViewModel((s) => s.git);
  const evolveState = useViewModel((s) => s.evolve);
  const defaultToDiffTab = useViewModel((s) => s.preferences?.defaultToDiffTab ?? false);
  const { handleRollback } = useRollback();
  const rollbackConfirm = useConfirm({
    confirmPrefKey: "confirmRollback",
    onConfirm: handleRollback,
  });
  const [activeTab, setActiveTab] = useState(defaultToDiffTab ? "diff" : "summary");
  const [includedFiles, setIncludedFiles] = useState<Record<string, boolean>>({});

  const changes = gitStatus?.changes;
  const files = useMemo(() => deriveDriftFiles(changes ?? []), [changes]);
  const counts = useMemo(() => summarizeDriftCounts(files), [files]);

  useEffect(() => {
    setIncludedFiles((prev) => {
      const next: Record<string, boolean> = {};
      for (const file of files) {
        next[file.filename] = prev[file.filename] ?? true;
      }
      return next;
    });
  }, [files]);

  if (!gitStatus || !evolveState || evolveState.step === "begin" || files.length === 0) {
    return null;
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className={cn(
        "flex max-w-full flex-col rounded-lg gap-0",
        variant === "outline" && "border border-border",
      )}
    >
      <div className="flex items-center gap-2 text-lg mt-2 mb-6 font-bold" >
        {/* <CheckCircle className="h-4 w-4 " /> */}
        Changes applied Successfully
      </div>
      <header className="flex items-center justify-between gap-3 pb- my-2">

        <div className="flex min-w-0 items-center gap-2">

          {showHeaderDelta && (
            <Badge variant="outline" className="font-mono text-muted-foreground border-none">
              {formatDriftCounts(counts)}
            </Badge>
          )}
        </div>
        <AnimatedTabsList value={activeTab}>
          <AnimatedTabsTrigger value="summary">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
            Semantic
          </AnimatedTabsTrigger>
          <AnimatedTabsTrigger value="diff">
            <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
            Diff
          </AnimatedTabsTrigger>
        </AnimatedTabsList>
      </header >

      <>
        <div className="mt-4 mb-2">
          {activeTab === "summary" ? (
            <DriftSummaryView />
          ) : (
            <ul className="divide-y divide-border/50">
              {files.map((file, index) => (
                <DriftFileRow
                  key={`${file.oldFilename ?? ""}\0${file.filename}`}
                  file={file}
                  included={includedFiles[file.filename] ?? true}
                  onIncludedChange={(included) =>
                    setIncludedFiles((prev) => ({ ...prev, [file.filename]: included }))
                  }
                  showActions={false}
                  defaultOpen={index === 0}
                />
              ))}
            </ul>
          )}
        </div>
        {showActions && (
          <>
            {actionSlot ? (
              <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {actionSlot}
              </div>
            ) : (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                    Ready to keep these changes?
                  </p>
                  <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                    Keep them to write a version-history note, or choose another path from the menu.
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button type="button" onClick={onKeepChanges} className="rounded-r-none shadow-sm">
                    <CheckCircle className="h-4 w-4" />
                    Keep Changes
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        aria-label="More change options"
                        className="rounded-l-none border-primary-foreground/20 border-l px-2 shadow-sm"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="end" className="w-48">
                      <DropdownMenuItem onSelect={rollbackConfirm.request}>
                        <Undo2 />
                        {undoLabel}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={onRefineFurther} disabled={!onRefineFurther}>
                        <RefreshCw />
                        Refine further
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )}
            <ConfirmationDialog
              open={rollbackConfirm.open}
              onOpenChange={rollbackConfirm.setOpen}
              message="Discard changes and rebuild to previous commit?"
              onConfirm={rollbackConfirm.handleConfirm}
              color="amber"
            >
              <CheckConfirmationOff onCheckedChange={rollbackConfirm.setDisable} />
            </ConfirmationDialog>
          </>
        )}
      </>
    </Tabs >
  );
}
