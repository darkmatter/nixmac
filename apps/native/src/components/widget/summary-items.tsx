"use client";

import { ChevronDown } from "lucide-react";
import { UnsummarizedChangesDetected } from "@/components/widget/unsummarized-changes-detected";
import { getShortFilename } from "@/components/widget/utils";
import type { ChangeWithSummary, SemanticChangeGroup, SemanticChangeMap } from "@/types/shared";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const CATEGORY_COLORS: Record<string, string> = {
  packages: "text-emerald-500",
  settings: "text-blue-500",
  shell: "text-amber-500",
  home: "text-violet-500",
  system: "text-gray-500",
};

function getCategoryColor(title: string): string {
  const key = title.toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "text-neutral-200";
}

function ShimmerBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.03] via-white/[0.065] to-white/[0.03]",
        className
      )}
    />
  );
}

const SHIMMER_VARIANTS = [
  ["w-[23%]", "w-[76%]", "w-[45%]"],
  ["w-[28%]", "w-[83%]", "w-[47%]"],
  ["w-[12%]", "w-[91%]", "w-[52%]"],
] as const;

function SkeletonItem({ index = 0 }: { index?: number }) {
  const [a, b] = SHIMMER_VARIANTS[index % SHIMMER_VARIANTS.length];
  return (
    <div className="mb-2 px-4 py-3">
      <ShimmerBar className={cn("h-3.5", a)} />
      <ShimmerBar className={cn("mt-2 h-2.5", b)} />
    </div>
  );
}

function GroupItem({ group, index }: { group: SemanticChangeGroup; index: number }) {
  if (group.summary.status === "QUEUED" || (!group.summary.title && !group.summary.description)) {
    return <SkeletonItem index={index} />;
  }

  const titleColor = getCategoryColor(group.summary.title);

  return (
    <Collapsible className="mb-2 last:mb-0">
      <div className="px-1 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className={cn("text-[13px] font-medium leading-snug", titleColor)}>
            {group.summary.title}
          </span>
          <span className="rounded bg-white/[0.06] px-[5px] py-px font-mono text-[10px] text-neutral-500">
            {group.changes.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-neutral-500">
          {group.summary.description}
        </p>
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="space-y-[3px] px-1 pb-2">
          {group.changes.map((change) => (
            <div
              key={change.hash}
              className="rounded border-l-2 border-white/20 bg-white/[0.02] px-2 py-1 text-[11px] text-neutral-500"
            >
              {change.title || getShortFilename(change.filename)}
            </div>
          ))}
        </div>
      </CollapsibleContent>
      <CollapsibleTrigger className="group flex w-full justify-center pb-2 text-neutral-700">
        <ChevronDown className="h-3 w-3 transition-transform duration-200 group-data-[state=open]:translate-y-0.5" />
      </CollapsibleTrigger>
    </Collapsible>
  );
}

function SingleItem({ change, index }: { change: ChangeWithSummary; index: number }) {
  if (!change.title && !change.description) {
    return <SkeletonItem index={index} />;
  }

  const titleColor = getCategoryColor(change.title);

  return (
    <div className="mb-2 px-4 py-3 last:mb-0">
      <span className={cn("text-[13px] font-medium leading-snug", titleColor)}>
        {change.title || getShortFilename(change.filename)}
      </span>
      {change.description && (
        <p className="mt-1 text-[11px] leading-snug text-neutral-500">
          {change.description}
        </p>
      )}
    </div>
  );
}

interface SummaryItemsProps {
  map: SemanticChangeMap;
}

export function SummaryItems({ map }: SummaryItemsProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-2">
      <UnsummarizedChangesDetected />
      {map.groups.map((group, i) => (
        <GroupItem key={`group-${group.summary.id}`} group={group} index={i} />
      ))}
      {map.singles.map((change, i) => (
        <SingleItem key={change.hash} change={change} index={i} />
      ))}
    </div>
  );
}
