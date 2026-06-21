import { Check } from "lucide-react";
import { STEPS, type StepId } from "@/components/widget/onboarding/lib/onboarding";
import { cn } from "@/lib/utils";

interface StepperProps {
  currentStep: StepId;
}

/** Vertical sidebar stepper listing every onboarding step with its status. */
export function OnboardingStepper({ currentStep }: StepperProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <ol className="flex flex-col gap-1">
      {STEPS.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <li key={step.id}>
            <div
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-3 transition-colors",
                isCurrent && "bg-sidebar-accent",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors",
                  isComplete && "border-success/40 bg-success/15 text-success",
                  isCurrent && "border-primary bg-primary text-primary-foreground",
                  !isComplete && !isCurrent && "border-border text-muted-foreground",
                )}
              >
                {isComplete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <div className="flex flex-col">
                <span
                  className={cn(
                    "font-medium text-sm leading-tight",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="text-muted-foreground/70 text-xs leading-tight">
                  {step.description}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
