"use client";

import { UnsummarizedChangesDetected } from "@/components/widget/notifications/unsummarized-changes-detected";
import {
  categorizeRenamed,
  enrichChanges,
  summarizeChangesByFile,
} from "@/components/widget/utils";
import { useViewModel } from "@nixmac/state";
import { useMemo } from "react";
import { DriftPlainRow } from "./drift-plain-row";
import { DriftSummaryRow } from "./drift-summary-row";

/**
 * "Summary" view of the drift. Summarized changes render as collapsed rows
 * (grouped files on one line + the AI summary beneath, same row styling as the
 * unsummarized rows). Changes without a summary yet fall back to the
 * "Manual Changes found in …: Analyze" header plus per-file rows. Never empty.
 */
export function DriftSummaryView() {
  const gitStatus = useViewModel((s) => s.git);
  const changeMap = useViewModel((s) => s.changeMap);

  const groups = changeMap?.groups ?? [];
  const singles = changeMap?.singles ?? [];

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
    <div>
      {/* The folder + Analyze header sits above the whole list; summarized and
          unsummarized rows then live together below it. */}
      <UnsummarizedChangesDetected />
      <ul className="divide-y divide-border/50">
        {groups.map((group) => (
          <DriftSummaryRow
            key={`group-${group.summary.id}`}
            files={group.changes}
            summary={group.summary.title || group.summary.description}
          />
        ))}
        {singles.map((single) => (
          <DriftSummaryRow
            key={single.hash}
            files={[single]}
            summary={single.title || single.description}
          />
        ))}
        {plainFiles.map((file) => (
          <DriftPlainRow key={`${file.oldFilename ?? ""}\0${file.filename}`} file={file} />
        ))}
      </ul>
    </div>
  );
}
