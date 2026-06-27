"use client";

import type { ComponentProps } from "react";
import { Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { GlowFrame } from "./glow-frame";

interface Props extends ComponentProps<typeof Button> {
  active?: boolean;
}

/**
 * Animated teal "glow" pill — the Build & Test button. Pass `children` to reuse
 * the same glow treatment for another action (e.g. "Scan this Mac"); with no
 * children it renders the default Build & Test label + spinner/wrench icon.
 */
export function ButtonGlow({ active = true, children, className, ...props }: Props) {
  return (
    <GlowFrame active={active}>
      <Button
        size="sm"
        disabled={!active}
        className={cn(
          "rounded-full border-0 shadow-none transition-all duration-100",
          active
            ? "bg-slate-900 text-slate-300 hover:bg-slate-800 active:scale-[0.98]"
            : "cursor-not-allowed bg-slate-800/80 text-slate-500 hover:bg-slate-800/80",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            {active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            Build & Test
          </>
        )}
      </Button>
    </GlowFrame>
  );
}

export { GlowFrame } from "./glow-frame";
