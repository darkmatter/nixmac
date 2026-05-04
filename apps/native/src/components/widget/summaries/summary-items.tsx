"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { UnsummarizedChangesSection } from "@/components/widget/summaries/unsummarized-changes-section";
import {
  ChangeWithRichType,
  getCategoryStyle,
  getShortFilename,
} from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import type {
  ChangeWithSummary,
  SemanticChangeGroup,
  SemanticChangeMap,
} from "@/types/shared";
import { Layers } from "lucide-react";

function ShimmerBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-white/[0.03] via-white/[0.065] to-white/[0.03]",
        className,
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
    <div className="mb-2 px-1 py-3">
      <ShimmerBar className={cn("h-3.5", a)} />
      <ShimmerBar className={cn("mt-2 h-2.5", b)} />
    </div>
  );
}

function GroupItem({
  group,
  index,
}: {
  group: SemanticChangeGroup;
  index: number;
}) {
  if (
    group.summary.status === "QUEUED" ||
    (!group.summary.title && !group.summary.description)
  ) {
    return <SkeletonItem index={index} />;
  }

  const style = getCategoryStyle(group.summary.title);

  return (
    <Collapsible className="group/root mb-2 last:mb-0">
      <div className="px-1 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span
            className={cn("text-[14px] font-medium leading-snug", style.text)}
          >
            {group.summary.title}
          </span>
          <CollapsibleTrigger className="flex h-[18px] w-[26px] items-center justify-center rounded bg-white/[0.06] font-mono text-[11.5px] text-neutral-300 transition-colors hover:bg-white/[0.1] hover:text-neutral-300">
            <span className="group-data-[state=open]/root:hidden">
              {group.changes.length}
            </span>
            <Layers className="hidden h-[11px] w-[11px] group-data-[state=open]/root:block" />
          </CollapsibleTrigger>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-neutral-300">
          {group.summary.description}
        </p>
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="space-y-[3px] px-1 pb-2">
          {group.changes.map((change) => (
            <div
              key={change.hash}
              className={cn(
                "rounded border-l-2 bg-white/[0.02] px-2 py-1.5",
                style.border,
              )}
            >
              <div className="truncate text-[11px] text-neutral-300">
                {change.title || getShortFilename(change.filename)}
                {change.description && (
                  <span className="text-neutral-400">
                    {" "}
                    — {change.description}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SingleItem({
  change,
  index,
}: {
  change: ChangeWithSummary;
  index: number;
}) {
  if (!change.title && !change.description) {
    return <SkeletonItem index={index} />;
  }

  return (
    <div className="mb-2 px-1 py-3 last:mb-0">
      <span className="text-[14px] font-medium leading-snug text-neutral-200">
        {change.title || getShortFilename(change.filename)}
      </span>
      {change.description && (
        <p className="mt-1 text-[12px] leading-snug text-neutral-300">
          {change.description}
        </p>
      )}
    </div>
  );
}

interface SummaryItemsProps {
  map: SemanticChangeMap;
  unsummarized: ChangeWithRichType[];
}

export function SummaryItems({ map, unsummarized }: SummaryItemsProps) {
  const partiallySummarized =
    unsummarized.length > 0 &&
    (map.singles.length > 0 || map.groups.length > 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-2">
      {map.groups.map((group, i) => (
        <GroupItem key={`group-${group.summary.id}`} group={group} index={i} />
      ))}
      {map.singles.map((change, i) => (
        <SingleItem key={change.hash} change={change} index={i} />
      ))}
      {partiallySummarized && <Separator />}
      <UnsummarizedChangesSection changes={unsummarized} />
    </div>
  );
}
