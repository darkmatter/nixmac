"use client";

import type { ReactNode } from "react";
import { HoverBorderGradient } from "./ui/hover-border-gradient";
import { cn } from "@/lib/utils";

const TEAL_HIGHLIGHT =
  "radial-gradient(75% 181% at 50% 50%, rgb(45, 212, 191) 0%, rgba(255, 255, 255, 0) 100%)";

const GRAY_HIGHLIGHT =
  "radial-gradient(75% 181% at 50% 50%, rgb(115, 115, 115) 0%, rgba(255, 255, 255, 0) 100%)";

interface GlowFrameProps {
  active?: boolean;
  children: ReactNode;
  className?: string;
}

/** Shared animated border glow used by Build & Test and Scan this Mac. */
export function GlowFrame({ active = true, children, className }: GlowFrameProps) {
  return (
    <HoverBorderGradient
      duration={active ? 1.2 : 2.5}
      highlight={active ? TEAL_HIGHLIGHT : GRAY_HIGHLIGHT}
      containerClassName={cn(
        "rounded-full transition-opacity duration-300",
        !active && "pointer-events-none opacity-70 saturate-50",
      )}
      className={cn("rounded-[inherit] bg-transparent p-0", className)}
    >
      {children}
    </HoverBorderGradient>
  );
}
