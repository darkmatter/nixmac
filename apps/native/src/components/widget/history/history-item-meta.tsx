import type { HistoryItem } from "@/tauri-api";
import { CommitHashBadge } from "@/components/widget/badges/commit-hash-badge";
import { FileCountBadge } from "@/components/widget/badges/file-count-badge";
import { TimeBadge } from "@/components/widget/badges/time-badge";
import { ExternalBadge } from "@/components/widget/badges/external-badge";
import { AnalyzeHistoryItemButton } from "@/components/widget/analyze-history-item-button";

export function HistoryItemMeta({ item, isPreview }: { item: HistoryItem; isPreview?: boolean }) {
  const showAnalyze = (!item.changeMap || item.unsummarizedHashes.length > 0) && !item.isBase;
  return (
    <div className="mt-[6px] flex w-fit flex-wrap items-center gap-2">
      <CommitHashBadge hash={item.hash} />
      {!isPreview && <TimeBadge createdAt={item.createdAt} />}
      {item.fileCount > 0 && <FileCountBadge fileCount={item.fileCount} />}
      {item.isExternal && <ExternalBadge />}
      {showAnalyze && (
        <AnalyzeHistoryItemButton
          hash={item.hash}
          isPartial={!!(item.changeMap && item.unsummarizedHashes.length > 0)}
        />
      )}
    </div>
  );
}
