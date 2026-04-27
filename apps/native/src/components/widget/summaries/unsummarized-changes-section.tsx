"use client";

import { UnsummarizedChange } from "@/components/widget/summaries/unsummarized-change";
import { UnsummarizedChangesDetected } from "@/components/widget/unsummarized-changes-detected";
import {
  categorizeRenamed,
  ChangeWithRichType,
} from "@/components/widget/utils";

export function UnsummarizedChangesSection({
  changes,
}: {
  changes: ChangeWithRichType[];
}) {
  if (!changes.length) return null;

  const changesWithRenamed = categorizeRenamed(changes);

  return (
    <>
      <UnsummarizedChangesDetected />
      {changesWithRenamed.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2 pt-1">
          {changesWithRenamed.map((item) => (
            <UnsummarizedChange
              key={item.oldFilename ?? item.filename}
              {...item}
            />
          ))}
        </div>
      )}
    </>
  );
}
