import type { HistoryItem } from "@/tauri-api";
import { useHistoryCard } from "@/hooks/use-history-card";
import { HistoryRestoreItemButton } from "@/components/widget/history/history-restore-item-button";
import { HistoryItemMeta } from "@/components/widget/history/history-item-meta";
import { ChangeBadges } from "@/components/widget/history/change-badges";
import { HistoryItemExpandedDetail } from "@/components/widget/history/history-item-expanded-detail";
import { CardContentWrapper } from "@/components/widget/history/history-item-card-header";
import { CommitMessage } from "@/components/widget/commit-message";
import { HistoryCurrentItemBadge } from "@/components/widget/badges/current-item-badge";
import { BaseCommitBadge } from "@/components/widget/badges/base-commit-badge";
import { BuildHeadButton } from "@/components/widget/build-head-button";

interface HistoryItemCardProps {
  item: HistoryItem;
  isRestoring: boolean;
  onRequestRestore: (hash: string) => void;
}

export function HistoryItemCard({ item, isRestoring, onRequestRestore }: HistoryItemCardProps) {
  const { expanded, colorMap, cardClassName, actionType, handleCardClick, handleKeyDown } = useHistoryCard(item);

  const getActionOrBadge = () => {
    switch (actionType) {
      case "current":
        return <HistoryCurrentItemBadge />;
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
  const actionOrBadge = getActionOrBadge();

  return (
    <div
      className={cardClassName}
      onClick={handleCardClick}
      onKeyDown={item.changeMap ? handleKeyDown : undefined}
      role={item.changeMap ? "button" : undefined}
      tabIndex={item.changeMap ? 0 : undefined}
    >
      <CardContentWrapper
        header={<CommitMessage hash={item.hash} message={item.message} originMessage={item.originMessage ?? undefined} />}
        actions={actionOrBadge}
      >
        <HistoryItemMeta item={item} />
        <ChangeBadges changeMap={item.changeMap} colorMap={colorMap} rawChanges={item.rawChanges} />
      </CardContentWrapper>
      <HistoryItemExpandedDetail item={item} colorMap={colorMap} expanded={expanded} />
    </div>
  );
}
