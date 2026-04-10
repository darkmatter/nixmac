import type { ReactNode } from "react";

interface HistoryCommitInfoProps {
  header: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}

export function HistoryCommitInfo({ header, actions, children }: HistoryCommitInfoProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0 flex-1">{header}</div>
        <div className="flex shrink-0 flex-col items-end gap-1">{actions}</div>
      </div>
      {children}
    </div>
  );
}
