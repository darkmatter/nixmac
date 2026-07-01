import { Check } from "lucide-react";
import { STEPS, stepIndex, type StepId } from "@/components/widget/onboarding/lib/onboarding";
import { cn } from "@/lib/utils";

interface StepperProps {
  activeStep: StepId;
  furthestStep: StepId;
  onStepSelect: (stepId: StepId) => void;
}

/** Vertical sidebar stepper listing every onboarding step with its status. */
export function OnboardingStepper({ activeStep, furthestStep, onStepSelect }: StepperProps) {
  const furthestIndex = stepIndex(furthestStep);
  const activeIndex = stepIndex(activeStep);

  return (
    <ol className="flex flex-col gap-1">
      {STEPS.map((step, index) => {
        const isComplete = index < furthestIndex;
        const isCurrent = index === activeIndex;
        const isReachable = index <= furthestIndex;
        // Steps past the furthest gate can't be jumped to yet — they depend on
        // work in the current/earlier steps. Surface that as a locked state.
        const isLocked = !isReachable;
        const canNavigate = isReachable && !isCurrent;

        const content = (
          <>
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors",
                isComplete && "border-success/40 bg-success/15 text-success",
                isCurrent && "border-primary bg-primary text-primary-foreground",
                // Reachable-but-not-complete (the furthest gate you can resume
                // at): read as actionable, not locked.
                !isComplete && !isCurrent && !isLocked && "border-foreground/40 text-foreground",
                isLocked && "border-dashed border-border/60 text-muted-foreground/50",
              )}
            >
              {isComplete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <div className="flex flex-col text-left">
              <span
                className={cn(
                  "font-medium text-sm leading-tight",
                  isCurrent && "text-foreground",
                  !isCurrent && !isLocked && "text-muted-foreground",
                  isLocked && "text-muted-foreground/50",
                )}
              >
                {step.label}
              </span>
              <span
                className={cn(
                  "text-xs leading-tight",
                  isLocked ? "text-muted-foreground/40" : "text-muted-foreground/70",
                )}
              >
                {step.description}
              </span>
            </div>
          </>
        );

        return (
          <li key={step.id}>
            {canNavigate ? (
              <button
                type="button"
                onClick={() => onStepSelect(step.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-3 transition-colors",
                  "hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                aria-label={`Go to ${step.label}`}
              >
                {content}
              </button>
            ) : (
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg px-3 py-3 transition-colors",
                  isCurrent && "bg-sidebar-accent",
                  isLocked && "cursor-not-allowed",
                )}
                aria-current={isCurrent ? "step" : undefined}
                aria-disabled={isLocked ? true : undefined}
              >
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
