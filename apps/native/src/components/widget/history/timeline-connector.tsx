import { Unlink2, Scissors } from "lucide-react";
import { cn } from "@/lib/utils";

// Vertical line style constants. LINE_LABEL is brighter — used for day-label
// spans which sit between commits and need a stronger visual thread.
export const LINE_NORMAL = "bg-teal-400/40 shadow-[0_0_4px_1px_rgba(45,212,191,0.15)]";
export const LINE_LABEL  = "bg-teal-400/60 shadow-[0_0_4px_1px_rgba(45,212,191,0.35)]";
export const LINE_UNDONE = "bg-neutral-700";

export type TimelineLineVariant =
  | "normal"
  | "undone"
  | "fade-to-undone"
  | "fade-from-undone";

const VARIANT_CLASSES: Record<TimelineLineVariant, string> = {
  normal:             LINE_NORMAL,
  undone:             LINE_UNDONE,
  "fade-to-undone":   "bg-gradient-to-b from-teal-400/40 to-neutral-700",
  "fade-from-undone": "bg-gradient-to-b from-neutral-700 to-teal-400/40",
};

// 29px = mt-6 (24px dot offset) + h-2.5/2 (5px half-dot) — the dot center.
// Top line terminates here; bottom line originates here.
const SPAN_CLASSES = {
  top:    "top-0 h-[29px]",
  bottom: "top-[29px] bottom-0",
  full:   "top-0 bottom-0",
} as const;

export function TimeLineSection({
  span,
  variant,
}: {
  span: keyof typeof SPAN_CLASSES;
  variant: TimelineLineVariant;
}) {
  return (
    <div
      className={cn(
        "absolute left-[5px] w-0.5",
        SPAN_CLASSES[span],
        VARIANT_CLASSES[variant],
      )}
    />
  );
}

export function TimelineDot({ isUndone }: { isUndone?: boolean }) {
  return (
    <div className={cn("w-3 mt-6 flex-none flex justify-center")}>
      <div className={cn("relative z-10 w-2.5 h-2.5 shrink-0 rounded-full bg-white/80", isUndone && "bg-neutral-700")} />
    </div>
  );
}

export function TimeLineConnector({
  isUndone,
  isInteractive,
  isPreviewActive,
  className,
}: {
  isUndone: boolean;
  isInteractive: boolean;
  isPreviewActive?: boolean;
  className?: string;
}) {
  const baseColor = isUndone
    ? isPreviewActive
      ? cn("bg-rose-300/25", isInteractive && "group-hover:bg-rose-300/35")
      : cn("bg-white/[0.10]", isInteractive && "group-hover:bg-neutral-600")
    : "bg-gradient-to-r from-teal-400/40 to-white/[0.08]";

  return (
    <div
      className={cn(
        "relative flex-none h-0.5 mt-7 -ml-px",
        isUndone ? "w-8" : "w-4",
        baseColor,
        className,
      )}
    >
      {isUndone && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-2 flex items-center justify-center p-[3px] rounded-sm bg-[#111111]">
          {isPreviewActive
            ? <Scissors className="w-4 h-4 text-neutral-600" strokeWidth={1.5} />
            : <Unlink2 className="w-4 h-4 text-neutral-600" strokeWidth={1.5} />
          }
        </div>
      )}
    </div>
  );
}

/** Five timeline layout flags grouped so they travel as one prop. */
export interface TimelineContext {
  isFirst: boolean;
  isLast: boolean;
  isUndone: boolean;
  bottomFadeToUndone: boolean;
  topFadeFromUndone: boolean;
}

/**
 * Renders the two absolute vertical line segments for a history card.
 * Owns the variant logic so the card only needs to pass its TimelineContext.
 */
export function HistoryItemTimeline({ timeline }: { timeline: TimelineContext }) {
  const { isFirst, isLast, isUndone, bottomFadeToUndone, topFadeFromUndone } = timeline;
  const topVariant: TimelineLineVariant = topFadeFromUndone ? "fade-from-undone" : isUndone ? "undone" : "normal";
  const bottomVariant: TimelineLineVariant = bottomFadeToUndone ? "fade-to-undone" : isUndone ? "undone" : "normal";
  return (
    <>
      {!isFirst && <TimeLineSection span="top" variant={topVariant} />}
      {!isLast && <TimeLineSection span="bottom" variant={bottomVariant} />}
    </>
  );
}
