"use client";

import { Activity, useState } from "react";
import { Diff } from "@/components/widget/diff";
import { SummaryItems } from "@/components/widget/summary-items";
import { AnimatedTabsList, AnimatedTabsTrigger } from "@/components/ui/animated-tabs";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useWidgetStore } from "@/stores/widget-store";
import { Dna, Wrench } from "lucide-react";

interface SummaryOrDiffProps {
  variant?: "default" | "outline";
}

export function SummaryOrDiff({ variant = "default" }: SummaryOrDiffProps) {
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const changeMap = useWidgetStore((s) => s.changeMap);
  const [activeTab, setActiveTab] = useState("summary");

  const cleanOnMain = gitStatus?.cleanHead && gitStatus?.isMainBranch;
  if (!gitStatus || cleanOnMain) {
    return null;
  }
  const changes = gitStatus.changes ?? [];

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className={cn(
        "flex max-w-full flex-col rounded-lg gap-0",
        variant === "outline" && "border border-border"
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/50 border-b py-2">
        <div className="flex items-center gap-2">
          {gitStatus.headIsBuilt ? <Wrench className="h-4 w-4 text-primary" /> : <Dna className="h-4 w-4 text-primary" />}
          <h2 className="font-medium text-sm">{gitStatus.headIsBuilt ? "Active Changes" : "What's changed"}</h2>
        </div>
        <AnimatedTabsList defaultValue="summary">
          <AnimatedTabsTrigger value="summary">Summary</AnimatedTabsTrigger>
          <AnimatedTabsTrigger value="diff">Diff</AnimatedTabsTrigger>
        </AnimatedTabsList>
      </div>
      <>
        <Activity mode={activeTab === "summary" ? "visible" : "hidden"}>
          {changeMap
            ? <SummaryItems map={changeMap} />
            : <div className="p-4 text-muted-foreground text-sm">No summary available yet.</div>
          }
        </Activity>
        <Activity mode={activeTab === "diff" ? "visible" : "hidden"}>
          <Diff changes={changes} />
        </Activity>
      </>
    </Tabs>
  );
}
