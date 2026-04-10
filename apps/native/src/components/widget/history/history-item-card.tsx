import { BaseCommitBadge } from "@/components/widget/badges/base-commit-badge";
import { HistoryCurrentItemBadge } from "@/components/widget/badges/current-item-badge";
import { BuildHeadButton } from "@/components/widget/build-head-button";
import { CommitMessage } from "@/components/widget/commit-message";
import { ChangeBadges } from "@/components/widget/history/change-badges";
import { HistoryConfirmRestoreButton } from "@/components/widget/history/history-confirm-restore-button";
import { HistoryCommitInfo } from "@/components/widget/history/history-item-card-header";
import { HistoryDetailedChangeInfo } from "@/components/widget/history/history-item-expanded-detail";
import { HistoryItemMeta } from "@/components/widget/history/history-item-meta";
import { HistoryRestoreItemButton } from "@/components/widget/history/history-restore-item-button";
import { useHistoryCard } from "@/hooks/use-history-card";
import { cn } from "@/lib/utils";
import type { HistoryItem } from "@/tauri-api";
import type { TimelineContext } from "./timeline-connector";
import { HistoryItemTimeline, TimeLineConnector, TimelineDot } from "./timeline-connector";

interface HistoryItemCardProps {
  item: HistoryItem;
  isRestoring: boolean;
  isPreview?: boolean;
  isPreviewActive?: boolean;
  deactivateCount?: number;
  timeline: TimelineContext;
  onRequestRestore: (hash: string) => void;
  onConfirmRestore?: () => void;
  onCancelRestore?: () => void;
}

export function HistoryItemCard({
  item,
  isRestoring,
  isPreview = false,
  isPreviewActive,
  deactivateCount,
  timeline,
  onRequestRestore,
  onConfirmRestore,
  onCancelRestore,
}: HistoryItemCardProps) {
  const { expanded, colorMap, cardClassName, actionType, handleCardClick, handleKeyDown } = useHistoryCard(item, isPreview);
  const { isUndone } = timeline;

  const getActionOrBadge = () => {
    switch (actionType) {
      case "preview":
        return <HistoryConfirmRestoreButton deactivateCount={deactivateCount} onConfirm={onConfirmRestore} onCancel={onCancelRestore} />;
      case "current":
        return <HistoryCurrentItemBadge isDimmed={isPreviewActive} />;
      case "base":
        return <BaseCommitBadge />;
      case "build":
        return <BuildHeadButton isRestoring={isRestoring} />;
      case "restore":
        return (
          <HistoryRestoreItemButton
            hash={item.hash}
            isRestoring={isRestoring}
            onRequestRestore={onRequestRestore}
          />
        );
    }
  };

  return (
    <div className="relative pb-2">
      <HistoryItemTimeline timeline={timeline} />

      <div className="group flex items-start gap-0">
        <TimelineDot isUndone={isUndone} />
        <TimeLineConnector isUndone={isUndone} isInteractive={!!item.changeMap} isPreviewActive={isPreviewActive} />
        <div
          className={cn(
            cardClassName,
            "flex-1",
            isPreview && "border-teal-400/40 group-hover:border-teal-400/50 group-hover:bg-[#111111]",
            item.isBuilt && isPreviewActive && "border-white/[0.12]",
          )}
          onClick={handleCardClick}
          onKeyDown={item.changeMap ? handleKeyDown : undefined}
          role={item.changeMap ? "button" : undefined}
          tabIndex={item.changeMap ? 0 : undefined}
        >
          <HistoryCommitInfo
            header={<CommitMessage hash={item.hash} message={item.message} originMessage={item.originMessage ?? undefined} />}
            actions={getActionOrBadge()}
          >
            <HistoryItemMeta item={item} isPreview={isPreview} />
            <ChangeBadges changeMap={item.changeMap} colorMap={colorMap} rawChanges={item.rawChanges} />
          </HistoryCommitInfo>
          <HistoryDetailedChangeInfo item={item} colorMap={colorMap} expanded={expanded} />
        </div>
      </div>
    </div>
  );
}
