"use client";

import { AnimatedTabsList, AnimatedTabsTrigger } from "@/components/ui/animated-tabs";
import { Tabs } from "@/components/ui/tabs";
import { DiffSection } from "@/components/widget/summaries/diff-section";
import { SummaryItems } from "@/components/widget/summaries/summary-items";
import { prefetchFileDiffContents } from "@/hooks/use-git-operations";
import { cn } from "@/lib/utils";
import { useViewModel } from "@nixmac/state";
import type { Change } from "@/ipc/types";
import { Dna, Wrench } from "lucide-react";
import { Activity, useEffect, useMemo, useState } from "react";
import { enrichChanges } from "../utils";

interface SummaryOrDiffProps {
  variant?: "default" | "outline";
}

export function SummaryOrDiff({ variant = "default" }: SummaryOrDiffProps) {
  const gitStatus = useViewModel((s) => s.git);
  const changeMap = useViewModel((s) => s.changeMap);
  const evolveState = useViewModel((s) => s.evolve);
  const defaultToDiffTab = useViewModel((s) => s.preferences?.defaultToDiffTab ?? false);
  const [activeTab, setActiveTab] = useState(defaultToDiffTab ? "diff" : "summary");
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [includedFiles, setIncludedFiles] = useState<Record<string, boolean>>({});

  const fileDiffKey = useMemo(
    () =>
      gitStatus?.changes
        .map((c) => `${c.filename}:${c.hash}`)
        .sort()
        .join("\n") ?? "",
    [gitStatus],
  );

  useEffect(() => {
    prefetchFileDiffContents(useViewModel.getState().git);
  }, [fileDiffKey]);

  useEffect(() => {
    if (!gitStatus) return;
    const filenames = [...new Set(gitStatus.changes.map((c) => c.filename))];
    setIncludedFiles((prev) => {
      const next: Record<string, boolean> = {};
      for (const filename of filenames) {
        next[filename] = prev[filename] ?? true;
      }
      return next;
    });
  }, [fileDiffKey, gitStatus]);

  if (!gitStatus || !evolveState || evolveState.step === "begin") {
    return null;
  }

  const hashSet = new Set(changeMap?.unsummarizedHashes);
  const unsummarized = (gitStatus?.changes.filter((c) => hashSet.has(c.hash)) || []) as Change[];
  const enrichedUnsummarizedChanges = enrichChanges(unsummarized);

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className={cn(
        "flex max-w-full flex-col rounded-lg gap-0",
        variant === "outline" && "border border-border",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          {evolveState.step === "commit" ? (
            <Wrench className="h-4 w-4 text-primary" />
          ) : (
            <Dna className="h-4 w-4 text-primary" />
          )}
          <h2 className="font-medium text-sm">
            {evolveState.step === "commit" ? "Active Changes" : "What's changed"}
          </h2>
        </div>
        <AnimatedTabsList value={activeTab}>
          <AnimatedTabsTrigger value="summary">Summary</AnimatedTabsTrigger>
          <AnimatedTabsTrigger value="diff">Diff</AnimatedTabsTrigger>
        </AnimatedTabsList>
      </div>
      <>
        <Activity mode={activeTab === "summary" ? "visible" : "hidden"}>
          {changeMap && <SummaryItems map={changeMap} unsummarized={enrichedUnsummarizedChanges} />}
        </Activity>
        {activeTab === "diff" && (
          <DiffSection
            changes={gitStatus.changes}
            openFiles={openFiles}
            onOpenFilesChange={setOpenFiles}
            includedFiles={includedFiles}
            onIncludedFilesChange={setIncludedFiles}
          />
        )}
      </>
    </Tabs>
  );
}
