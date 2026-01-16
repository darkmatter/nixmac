"use client";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={cn("h-6 w-6", className)}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

const CheckFilled = ({ className }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={cn("h-6 w-6", className)}
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
      fillRule="evenodd"
    />
  </svg>
);

type LoadingState = {
  id?: number | string;
  text: string;
};

const SkeletonCircle = ({ className }: { className?: string }) => (
  <div
    className={cn("h-6 w-6 animate-pulse rounded-full bg-white/20", className)}
  />
);

const SkeletonLine = ({ width = "w-48" }: { width?: string }) => (
  <div className={cn("h-4 animate-pulse rounded bg-white/20", width)} />
);

const LoaderCore = ({
  loadingStates,
  value = 0,
  pendingCount = 3,
}: {
  loadingStates: LoadingState[];
  value?: number;
  pendingCount?: number;
}) => {
  const skeletonWidths = ["w-32", "w-48", "w-40", "w-36", "w-44"];
  const itemHeight = 40; // Height of each item including margin

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="relative" style={{ width: "500px" }}>
        {/* Actual loading states */}
        {loadingStates.map((loadingState, index) => {
          const distance = index - value;
          // Completed items (above) fade slower, pending items (below) fade faster
          const opacity =
            distance < 0
              ? Math.max(1 - Math.abs(distance) * 0.25, 0) // Completed: fade to 0.3 min
              : Math.max(1 - distance * 0.5, 0); // Pending: fade faster

          const isCompleted = index < value;
          const isCurrent = index === value;
          const checkClass = isCompleted || isCurrent ? "text-lime-500" : "";

          let textClass = "text-white";
          if (isCurrent) {
            textClass = "text-lime-500";
          } else if (isCompleted) {
            textClass = "text-lime-500/80";
          }

          // Position relative to current step - current step stays centered at y=0
          const y = (index - value) * itemHeight;

          return (
            <motion.div
              animate={{ opacity, y }}
              className={cn("absolute right-0 left-0 flex gap-2 text-left")}
              initial={{ opacity: 0, y }}
              key={loadingState.id ?? `step-${index}`}
              transition={{ duration: 0.5 }}
            >
              <div className="shrink-0">
                {index > value ? (
                  <CheckIcon className="text-white/50" />
                ) : (
                  <CheckFilled className={checkClass} />
                )}
              </div>
              <span
                className={cn(
                  textClass,
                  "block overflow-hidden text-ellipsis whitespace-nowrap"
                )}
              >
                {loadingState.text}
              </span>
            </motion.div>
          );
        })}

        {/* Skeleton placeholders for pending items */}
        {skeletonWidths.slice(0, pendingCount).map((width, i) => {
          const skeletonIndex = loadingStates.length + i;
          const distance = skeletonIndex - value;
          const opacity = Math.max(0.5 - distance * 0.08, 0.15);
          const y = distance * itemHeight;

          return (
            <motion.div
              animate={{ opacity, y }}
              className={cn("absolute right-0 left-0 flex gap-2 text-left")}
              initial={{ opacity: 0, y }}
              key={`skeleton-${width}`}
              transition={{ duration: 0.5 }}
            >
              <SkeletonCircle />
              <SkeletonLine width={width} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export const MultiStepLoader = ({
  loadingStates,
  step,
  loading,
}: {
  loadingStates: LoadingState[];
  /** Current step - controlled externally, advances only when new messages arrive */
  step: number;
  loading?: boolean;
}) => {
  // Step is controlled entirely by the parent component via the `step` prop.
  // No internal timer - step only changes when parent passes a new value.
  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          animate={{
            opacity: 1,
          }}
          className="fixed inset-0 z-[100] flex h-full w-full items-center justify-center backdrop-blur-2xl"
          exit={{
            opacity: 0,
          }}
          initial={{
            opacity: 0,
          }}
        >
          <div className="relative flex h-full w-full items-center justify-center">
            <LoaderCore loadingStates={loadingStates} value={step} />
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 h-full bg-black bg-gradient-to-t opacity-20 [mask-image:radial-gradient(900px_at_center,transparent_30%,white)] dark:bg-black" />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

/**
 * Inline version of MultiStepLoader that renders within a container
 * instead of as a fullscreen overlay. Use this for embedding in the widget.
 */
export const MultiStepLoaderInline = ({
  loadingStates,
  step,
  className,
}: {
  loadingStates: LoadingState[];
  /** Current step - controlled externally, advances only when new messages arrive */
  step: number;
  className?: string;
}) => (
  <div
    className={cn(
      "relative flex min-h-[200px] w-full items-center justify-center",
      className
    )}
  >
    <LoaderCore loadingStates={loadingStates} pendingCount={2} value={step} />
  </div>
);
