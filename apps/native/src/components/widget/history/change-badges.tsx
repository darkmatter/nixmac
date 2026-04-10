import { ChangeBadge } from "@/components/widget/badges/change-badge";
import { FilenameBadge } from "@/components/widget/badges/filename-badge";
import { BadgeList } from "@/components/widget/badge-list";
import type { ColorMap } from "@/components/widget/utils";
import type { Change, SemanticChangeMap } from "@/types/shared";

interface ChangeBadgesProps {
  changeMap: SemanticChangeMap | null;
  colorMap: ColorMap;
  rawChanges: Change[];
}

export function ChangeBadges({ changeMap, colorMap, rawChanges }: ChangeBadgesProps) {
  if (!changeMap) {
    const filenames = [...new Set(rawChanges.map((c) => c.filename))];
    if (filenames.length === 0) return null;
    return (
      <BadgeList>
        {filenames.map((filename) => (
          <FilenameBadge key={filename} filename={filename} />
        ))}
      </BadgeList>
    );
  }

  const badges = [
    ...changeMap.groups.map((g) => ({ key: String(g.summary.id), title: g.summary.title })),
    ...changeMap.singles.map((s) => ({ key: s.hash, title: s.title })),
  ];
  if (badges.length === 0) return null;
  return (
    <BadgeList>
      {badges.map((badge, i) => (
        <ChangeBadge
          key={badge.key}
          title={badge.title}
          style={colorMap.get(badge.key)}
          index={i}
        />
      ))}
    </BadgeList>
  );
}
