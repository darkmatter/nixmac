"use client";

import { getStepperStep } from "@/components/widget/utils";
import { cn } from "@/lib/utils";
import { useCurrentStep, useWidgetStore } from "@/stores/widget-store";
import { Check } from "lucide-react";

export const STEPPER_STEPS = [
  { id: 1 as const, name: "Begin", description: "Make a change" },
  { id: 2 as const, name: "Evolve", description: "Review & edit" },
  { id: 3 as const, name: "Commit", description: "Save to git" },
];

export type StepperStepId = 1 | 2 | 3;

export function Stepper() {
  const step = useCurrentStep();
  const gitStatus = useWidgetStore((s) => s.gitStatus);
  const hasChanges = gitStatus?.hasChanges ?? false;

  // Don't show stepper on setup step
  if (step === "setup" || step === "permissions") {
    return null;
  }

  const currentStep = getStepperStep(step, hasChanges);

  return (
    <div className="border-border border-b bg-muted/30 px-5 py-4">
      <div className="flex items-center justify-center gap-6 xs:gap-8 sm:gap-12">
        {STEPPER_STEPS.map((step, i) => (
          <div className="flex items-center" key={step.id}>
            <div className="flex items-center gap-3">
              {/* Circle - hidden below xs */}
              <div
                className={cn(
                  "hidden xs:flex h-8 min-w-8 items-center justify-center rounded-full font-medium text-sm transition-colors",
                  currentStep > step.id
                    ? "bg-teal-500 text-white"
                    : currentStep === step.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {currentStep > step.id ? (
                  <Check className="h-4 w-4" />
                ) : (
                  step.id
                )}
              </div>
              {/* Desktop: step name + description */}
              <div>
                <div className="flex items-center jusify-center gap-2">
                  <p
                    className={cn(
                      "font-medium text-sm",
                      currentStep >= step.id
                      ? "text-foreground"
                      : "text-muted-foreground",
                    )}
                    >
                    {step.name}
                  </p>
                  {/* Small circle - visible only below xs */}
                  <div
                    className={cn(
                      "flex xs:hidden h-[18px] w-[18px] items-center justify-center rounded-full text-xs font-medium transition-colors",
                      currentStep > step.id
                        ? "bg-teal-500 text-white"
                        : currentStep === step.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {currentStep > step.id ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      step.id
                    )}
                  </div>
                </div>
                <p className="text-muted-foreground text-xs whitespace-nowrap mt-1 xs:mt-[2px]">
                  {step.description}
                </p>
              </div>
            </div>
            {i < STEPPER_STEPS.length - 1 && (
              <div
                className={cn(
                  "relative left-2.5 xs:left-3 sm:left-4 h-0.5 w-10 sm:w-12",
                  currentStep > step.id ? "bg-teal-500" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
