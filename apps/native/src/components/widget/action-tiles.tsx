"use client";

import { cn } from "@/lib/utils";
import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export interface ActionTile {
  name: string;
  icon: IconComponent;
  iconSrc?: string;
  color: "white" | "teal" | "blue" | "amber";
  disabled?: boolean;
  isActive?: boolean;
  onAction: () => void;
}

interface ActionTilesProps {
  title: string;
  subtitle: string;
  tiles: ActionTile[];
}

export function ActionTiles({ title, subtitle, tiles }: ActionTilesProps) {
  return (
    <div className="flex w-full flex-col items-center py-4">
      <h3 className="mb-1 font-semibold text-lg">{title}</h3>
      <p className="mb-6 text-center text-muted-foreground text-sm">
        {subtitle}
      </p>

      <div className="grid w-full max-w-lg grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <button
            key={tile.name}
            type="button"
            disabled={tile.disabled}
            onClick={tile.onAction}
            className={cn(
              "flex flex-col items-center justify-center rounded-lg border-2 px-4 py-3 transition-all",
              tile.disabled
                ? "cursor-not-allowed border-border/50 opacity-50"
                : tile.isActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50",
            )}
          >
            <div
              className={cn(
                "mb-1.5 rounded-full p-2",
                tile.color === "white" && "bg-white-500/10 text-white-500",
                tile.color === "teal" && "bg-teal-300/10 text-teal-300",
                tile.color === "blue" && "bg-teal-300/10 text-teal-300",
                tile.color === "amber" && "bg-rose-300/10 text-rose-300",
                tile.iconSrc === "/outline-white.png" && "p-1"
              )}
            >
              {tile.iconSrc ? (
                <img src={tile.iconSrc} alt="" className="h-7 w-7 object-contain" />
              ) : (
                <tile.icon className="h-5 w-5" />
              )}
            </div>
            <p className="font-medium text-sm">{tile.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}