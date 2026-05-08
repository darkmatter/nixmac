"use client";

import { UnsummarizedChange } from "@/components/widget/summaries/unsummarized-change";
import { UnsummarizedChangesDetected } from "@/components/widget/notifications/unsummarized-changes-detected";
import {
  categorizeRenamed,
  ChangeWithRichType,
  summarizeChangesByFile,
} from "@/components/widget/utils";

const MAX_ITEMS = 6;

export function UnsummarizedChangesSection({
  changes,
}: {
  changes: ChangeWithRichType[];
}) {
  if (!changes.length) return null;

  const changesWithRenamed = summarizeChangesByFile(categorizeRenamed(changes));
  const remaining = changesWithRenamed.length - MAX_ITEMS;

  const displayedChanges = changesWithRenamed.slice(0, MAX_ITEMS);
  const showMore = remaining > 0;

  return (
    <>
      <UnsummarizedChangesDetected />
      {changesWithRenamed.length > 0 && (
        <div className="flex flex-wrap  items-center">
          {displayedChanges.map((item) => (
            <UnsummarizedChange
              key={item.hash}
              {...item}
            />
          ))}
          {showMore && <span className="text-[11px] text-zinc-500  font-mono relative">+{remaining} more</span>}
        </div>
      )}
    </>
  );
}
