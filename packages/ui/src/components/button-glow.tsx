"use client";
import { cn } from "@/lib/utils";
import { NoiseBackground } from "./ui/noise-background";
import { Button } from "./ui/button";
import { Loader2, Wrench } from "lucide-react";
import { ComponentProps } from "react";

const ACTIVE_GRADIENT = [
  "rgb(45, 212, 191)",
  "rgb(20, 184, 166)",
  "rgb(13, 148, 136)",
] as const;

const INACTIVE_GRADIENT = [
  "rgb(115, 115, 115)",
  "rgb(82, 82, 82)",
  "rgb(64, 64, 64)",
] as const;



interface Props extends ComponentProps<typeof Button> {
  active?: boolean;
}

export function ButtonGlow({
  active,
  ...props
}: Props) {
  return (
    <NoiseBackground
          animating={active}
          shimmer={active}
          speed={active ? 0.35 : 0.1}
          containerClassName={cn(
            "w-fit rounded-full p-0.5 transition-opacity duration-300",
            !active && "opacity-70 saturate-50",
          )}
          gradientColors={
            active ? [...ACTIVE_GRADIENT] : [...INACTIVE_GRADIENT]
          }
          noiseIntensity={active ? 0.2 : 0.08}
        >
          <Button
            size="sm"
            disabled={!active}
            className={cn(
              "rounded-full border-0 shadow-none transition-all duration-100",
              active
                ? "bg-slate-900 text-slate-300 hover:bg-slate-800 active:scale-[0.98]"
                : "cursor-not-allowed bg-slate-800/80 text-slate-500 hover:bg-slate-800/80",
            )}
            {...props}
          >
            {active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            Build & Test
          </Button>
        </NoiseBackground>
  );
}