"use client";

import {
  type MotionValue,
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";

/** Clockwise path around a stadium / pill shape, starting at top center. */
export function pointOnStadiumBorder(
  width: number,
  height: number,
  t: number,
): { x: number; y: number } {
  const inset = 1.5;
  const radius = height / 2 - inset;
  const centerY = height / 2;
  const topRightLen = Math.max(0, width / 2 - radius);
  const topLeftLen = topRightLen;
  const bottomLen = Math.max(0, width - 2 * radius);
  const arcLen = Math.PI * radius;
  const perimeter = topRightLen + arcLen + bottomLen + arcLen + topLeftLen;

  let distance = (((t % 1) + 1) % 1) * perimeter;

  if (distance <= topRightLen) {
    return { x: width / 2 + distance, y: inset };
  }
  distance -= topRightLen;

  if (distance <= arcLen) {
    const angle = -Math.PI / 2 + (distance / arcLen) * Math.PI;
    return {
      x: width - radius + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  }
  distance -= arcLen;

  if (distance <= bottomLen) {
    return { x: width - radius - distance, y: height - inset };
  }
  distance -= bottomLen;

  if (distance <= arcLen) {
    const angle = Math.PI / 2 + (distance / arcLen) * Math.PI;
    return {
      x: radius + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  }
  distance -= arcLen;

  return { x: radius + distance, y: inset };
}

function GradientLayer({
  traceProgress,
  phaseOffset,
  sizeRef,
  gradientColor,
  opacity,
}: {
  traceProgress: MotionValue<number>;
  phaseOffset: number;
  sizeRef: RefObject<{ width: number; height: number }>;
  gradientColor: string;
  opacity: number;
}) {
  const x = useTransform(traceProgress, (progress) => {
    const { width, height } = sizeRef.current ?? { width: 0, height: 0 };
    return pointOnStadiumBorder(width, height, progress + phaseOffset).x;
  });
  const y = useTransform(traceProgress, (progress) => {
    const { width, height } = sizeRef.current ?? { width: 0, height: 0 };
    return pointOnStadiumBorder(width, height, progress + phaseOffset).y;
  });
  const springX = useSpring(x, { stiffness: 120, damping: 28 });
  const springY = useSpring(y, { stiffness: 120, damping: 28 });
  const background = useMotionTemplate`radial-gradient(circle at ${springX}px ${springY}px, ${gradientColor} 0%, transparent 55%)`;

  return (
    <motion.div
      className="absolute inset-0"
      style={{
        opacity,
        background,
      }}
    />
  );
}

function ShimmerSweep({ active, opacity }: { active: boolean; opacity: number }) {
  if (!active) {
    return null;
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]"
    >
      <motion.div
        className="absolute inset-y-0 w-1/3 -skew-x-12 mix-blend-overlay"
        style={{
          background: `linear-gradient(to right, transparent, rgba(255, 255, 255, ${opacity}), transparent)`,
        }}
        initial={{ x: "-120%" }}
        animate={{ x: "420%" }}
        transition={{
          duration: 2.6,
          ease: "easeInOut",
          repeat: Number.POSITIVE_INFINITY,
          repeatDelay: 7,
        }}
      />
    </div>
  );
}

interface NoiseBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  gradientColors?: string[];
  noiseIntensity?: number;
  speed?: number;
  backdropBlur?: boolean;
  animating?: boolean;
  shimmer?: boolean;
  /** Peak white opacity of the shimmer band (0–1). Default 0.08. */
  shimmerOpacity?: number;
}

export const NoiseBackground = ({
  children,
  className,
  containerClassName,
  gradientColors = ["rgb(255, 100, 150)", "rgb(100, 150, 255)", "rgb(255, 200, 100)"],
  noiseIntensity = 0.2,
  speed = 0.1,
  backdropBlur = false,
  animating = true,
  shimmer = false,
  shimmerOpacity = 0.05,
}: NoiseBackgroundProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const traceProgress = useMotionValue(0);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    sizeRef.current = { width: rect.width, height: rect.height };
    traceProgress.set(0);
  }, [traceProgress]);

  useAnimationFrame((_time, delta) => {
    if (!(animating && containerRef.current)) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    sizeRef.current = { width: rect.width, height: rect.height };

    // One full lap about every 8s at speed=0.1; scales with speed prop.
    const lapMs = 8000 / Math.max(speed, 0.01);
    traceProgress.set((traceProgress.get() + delta / lapMs) % 1);
  });

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-neutral-200 p-2 backdrop-blur-sm dark:bg-neutral-800",
        "shadow-[0px_0.5px_1px_0px_var(--color-neutral-400)_inset,0px_1px_0px_0px_var(--color-neutral-100)]",
        "dark:shadow-[0px_1px_0px_0px_var(--color-neutral-950)_inset,0px_1px_0px_0px_var(--color-neutral-800)]",
        backdropBlur &&
          "after:absolute after:inset-0 after:h-full after:w-full after:backdrop-blur-lg after:content-['']",
        containerClassName,
      )}
      ref={containerRef}
      style={
        {
          "--noise-opacity": noiseIntensity,
        } as React.CSSProperties
      }
    >
      <GradientLayer
        gradientColor={gradientColors[0]}
        opacity={0.4}
        phaseOffset={0}
        sizeRef={sizeRef}
        traceProgress={traceProgress}
      />
      <GradientLayer
        gradientColor={gradientColors[1]}
        opacity={0.28}
        phaseOffset={-0.06}
        sizeRef={sizeRef}
        traceProgress={traceProgress}
      />
      <GradientLayer
        gradientColor={gradientColors[2] || gradientColors[0]}
        opacity={0.22}
        phaseOffset={-0.12}
        sizeRef={sizeRef}
        traceProgress={traceProgress}
      />

      {/* Static Noise Pattern */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          alt=""
          className="h-full w-full object-cover opacity-[var(--noise-opacity)]"
          src="https://assets.aceternity.com/noise.webp"
          style={{ mixBlendMode: "overlay" }}
        />
      </div>

      {/* Content */}
      <div
        className={cn("relative z-10", shimmer && "overflow-hidden rounded-[inherit]", className)}
      >
        <ShimmerSweep active={shimmer && animating} opacity={shimmerOpacity} />
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
};
