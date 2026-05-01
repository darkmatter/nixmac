import { cn } from "@/lib/utils";
import { Cable, Lightbulb, Monitor, Shield, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { FsMode } from "./mode-toggle";
import type { FsFile, Section, SectionId } from "./data";

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
  mode: FsMode;
  files: Record<SectionId, FsFile[]>;
}

export function SectionTabs({ sections, active, setActive, mode, files }: SectionTabsProps) {
  return (
    <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-border/50 border-b px-2">
      {sections.map((s) => {
        const isActive = s.id === active;
        const label = mode === "plain" ? s.plain : s.nix;
        const Icon = SECTION_ICONS[s.id];
        const count = s.id === "manage" ? (files[s.id]?.length ?? 0) : 0;
        return (
          <button
            type="button"
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 px-2.5 py-2 text-xs transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={s.hint}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5",
                isActive && mode === "nix" ? "text-teal-400" : undefined,
              )}
            />
            <span className={isActive ? "font-medium" : undefined}>{label}</span>
            {count > 0 && (
              <span className="rounded-sm bg-amber-500/15 px-1 py-px font-semibold text-[10px] text-amber-400">
                {count}
              </span>
            )}
            {isActive && (
              <span
                className={cn(
                  "absolute inset-x-2 bottom-0 h-0.5 rounded-sm",
                  mode === "nix" ? "bg-teal-400" : "bg-foreground",
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
