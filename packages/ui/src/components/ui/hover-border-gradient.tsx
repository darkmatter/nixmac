"use client";

import { motion } from "motion/react";
import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type PropsWithChildren,
} from "react";
import { cn } from "@/lib/utils";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

const DIRECTIONS: Direction[] = ["TOP", "LEFT", "BOTTOM", "RIGHT"];

const MOVING_MAP: Record<Direction, string> = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  BOTTOM: "radial-gradient(20.7% 50% at 50% 100%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  RIGHT:
    "radial-gradient(16.2% 41.2% at 100% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
};

const DEFAULT_HIGHLIGHT =
  "radial-gradient(75% 181.15942028985506% at 50% 50%, #3275F8 0%, rgba(255, 255, 255, 0) 100%)";

function rotateDirection(currentDirection: Direction, clockwise: boolean): Direction {
  const currentIndex = DIRECTIONS.indexOf(currentDirection);
  const nextIndex = clockwise
    ? (currentIndex - 1 + DIRECTIONS.length) % DIRECTIONS.length
    : (currentIndex + 1) % DIRECTIONS.length;
  return DIRECTIONS[nextIndex]!;
}

type HoverBorderGradientProps = PropsWithChildren<{
  containerClassName?: string;
  className?: string;
  duration?: number;
  clockwise?: boolean;
  /** Radial gradient used on hover and as the accent while idle. */
  highlight?: string;
}> &
  Omit<ComponentPropsWithoutRef<"div">, "className" | "children">;

/** Aceternity hover-border-gradient — animated border glow around a pill. */
export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  duration = 1,
  clockwise = true,
  highlight = DEFAULT_HIGHLIGHT,
  onMouseEnter,
  onMouseLeave,
  ...props
}: HoverBorderGradientProps) {
  const [hovered, setHovered] = useState(false);
  const [direction, setDirection] = useState<Direction>("TOP");

  useEffect(() => {
    if (hovered) return;
    const interval = setInterval(() => {
      setDirection((prev) => rotateDirection(prev, clockwise));
    }, duration * 1000);
    return () => clearInterval(interval);
  }, [hovered, duration, clockwise]);

  return (
    <div
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
      className={cn(
        "relative flex h-min w-fit flex-col flex-nowrap content-center items-center justify-center gap-10 overflow-visible rounded-full border bg-black/20 p-px decoration-clone transition duration-500 hover:bg-black/10 dark:bg-white/20",
        containerClassName,
      )}
      {...props}
    >
      <div
        className={cn(
          "relative z-10 w-auto rounded-[inherit] bg-black px-4 py-2 text-white",
          className,
        )}
      >
        {children}
      </div>
      <motion.div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]"
        style={{ filter: "blur(2px)" }}
        initial={{ background: MOVING_MAP[direction] }}
        animate={{
          background: hovered ? [MOVING_MAP[direction], highlight] : MOVING_MAP[direction],
        }}
        transition={{ ease: "linear", duration }}
      />
    </div>
  );
}
