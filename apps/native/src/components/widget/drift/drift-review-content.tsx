"use client";

import { DriftFileRow } from "./drift-file-row";
import { DriftSummaryView } from "./drift-summary-view";
import type { DriftFileRowData } from "./drift-utils";
import type { DriftView } from "./drift-review-types";

interface DriftReviewContentProps {
  files: DriftFileRowData[];
  view: DriftView;
}

export function DriftReviewContent({ files, view }: DriftReviewContentProps) {
  return (
    <div>
      {view === "summary" ? (
        <DriftSummaryView />
      ) : (
        <ul className="divide-y divide-border/50">
          {files.map((file, index) => (
            <DriftFileRow
              key={file.hash}
              file={file}
              defaultOpen={index === 0}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
