"use client";

import { UnsummarizedChangesDetected } from "@/components/widget/notifications/unsummarized-changes-detected";
import { SummaryItems } from "@/components/widget/summaries/summary-items";
import {
  categorizeRenamed,
  enrichChanges,
  summarizeChangesByFile,
} from "@/components/widget/utils";
import { useViewModel } from "@nixmac/state";
import { useMemo } from "react";
import { DriftPlainRow } from "./drift-plain-row";

/**
 * "Summary" view of the drift. Shows the AI semantic summaries when they exist,
 * and — for changes that aren't summarized yet — falls back to the prior
 * behavior: the "Manual Changes found in …: Analyze" header plus the changed
 * files as friendly, action-bearing rows. It never renders an empty state.
 */
export function DriftSummaryView() {
  const gitStatus = useViewModel((s) => s.git);
  const changeMap = useViewModel((s) => s.changeMap);

  const hasSummaries =
    !!changeMap && (changeMap.groups.length > 0 || changeMap.singles.length > 0);

  // Files without a summary yet. With no change map at all, treat every change
  // as unsummarized so the view still lists the drift.
  const plainFiles = useMemo(() => {
    const changes = gitStatus?.changes;
    if (!changes) return [];
    const subset = changeMap
      ? changes.filter((c) => new Set(changeMap.unsummarizedHashes).has(c.hash))
      : changes;
    return summarizeChangesByFile(categorizeRenamed(enrichChanges(subset)));
  }, [gitStatus?.changes, changeMap]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {hasSummaries && changeMap && <SummaryItems map={changeMap} unsummarized={[]} />}

      {plainFiles.length > 0 && (
        <>
          <UnsummarizedChangesDetected />
          <ul className="divide-y divide-border/50">
            {plainFiles.map((file) => (
              <DriftPlainRow key={`${file.oldFilename ?? ""}\0${file.filename}`} file={file} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
