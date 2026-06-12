import { Cable, Lightbulb, Monitor, Shield, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  untrackedCandidateItemCount,
  type FsFile,
  type Section,
  type SectionId,
} from "./data";

const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  entry: Cable,
  darwin: Monitor,
  home: User,
  support: Shield,
  manage: Lightbulb,
};

interface SectionTabsProps {
  sections: Section[];
  active: SectionId;
  setActive: (id: SectionId) => void;
  files: Record<SectionId, FsFile[]>;
}

export function SectionTabs({ sections, active, setActive, files }: SectionTabsProps) {
  return (
    <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-border/50 border-b px-2">
      {sections.map((s) => {
        const isActive = s.id === active;
        const Icon = SECTION_ICONS[s.id];
        const untrackedCount =
          s.id === "manage"
            ? untrackedCandidateItemCount(files[s.id] ?? [])
            : 0;
        return (
          <button
            type="button"
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-xs transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            title={s.hint}
            data-testid={`section-tab-${s.id}`}
            aria-pressed={isActive}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className={isActive ? "font-medium" : undefined}>{s.label}</span>
            {(untrackedCount ?? 0) > 0 && (
              <span className="rounded-sm bg-amber-500/15 px-1 py-px font-semibold text-[10px] text-amber-400">
                {untrackedCount}
              </span>
            )}
            {isActive && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-sm bg-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}
