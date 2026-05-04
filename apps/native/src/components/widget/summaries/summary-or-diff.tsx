"use client";

import {
  AnimatedTabsList,
  AnimatedTabsTrigger,
} from "@/components/ui/animated-tabs";
import { Tabs } from "@/components/ui/tabs";
import { Diff } from "@/components/widget/summaries/diff";
import { SummaryItems } from "@/components/widget/summaries/summary-items";
import { useSummary } from "@/hooks/use-summary";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import type { Change } from "@/types/shared.ts";
import { Dna, Wrench } from "lucide-react";
import { Activity, useEffect, useState } from "react";
import { enrichChanges } from "../utils";

interface SummaryOrDiffProps {
  variant?: "default" | "outline";
}

export function SummaryOrDiff({ variant = "default" }: SummaryOrDiffProps) {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const changeMap = useWidgetStore((s) => s.changeMap);
  const evolveState = useWidgetStore((s) => s.evolveState);
  const { summarizeOnFocus } = useSummary();
  const [activeTab, setActiveTab] = useState("summary");

  useEffect(() => {
    window.addEventListener("focus", summarizeOnFocus);
    return () => window.removeEventListener("focus", summarizeOnFocus);
  }, [summarizeOnFocus]);

  if (!gitStatus || !evolveState || evolveState.step === "begin") {
    return null;
  }
  const changes = enrichChanges(gitStatus.changes) ?? [];

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "summary") summarizeOnFocus();
  };

  const hashSet = new Set(changeMap?.unsummarizedHashes);
  const unsummarized = (gitStatus?.changes.filter((c) => hashSet.has(c.hash)) ||
    []) as Change[];
  const enrichedUnsummarizedChanges = enrichChanges(unsummarized);

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
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
            {evolveState.step === "commit"
              ? "Active Changes"
              : "What's changed"}
          </h2>
        </div>
        <AnimatedTabsList defaultValue="summary">
          <AnimatedTabsTrigger value="summary">Summary</AnimatedTabsTrigger>
          <AnimatedTabsTrigger value="diff">Diff</AnimatedTabsTrigger>
        </AnimatedTabsList>
      </div>
      <>
        <Activity mode={activeTab === "summary" ? "visible" : "hidden"}>
          {changeMap && (
            <SummaryItems
              map={changeMap}
              unsummarized={enrichedUnsummarizedChanges}
            />
          )}
        </Activity>
        <Activity mode={activeTab === "diff" ? "visible" : "hidden"}>
          <Diff changes={changes} />
        </Activity>
      </>
    </Tabs>
  );
}
