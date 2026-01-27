"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps {
  currentStep: StepperStepId;
}

export const STEPPER_STEPS = [
  { id: 1 as const, name: "Evolve", description: "Make changes" },
  { id: 2 as const, name: "Preview", description: "Review effects" },
  { id: 3 as const, name: "Commit", description: "Save to git" },
];

export type StepperStepId = 1 | 2 | 3;


export function Stepper({ currentStep }: StepperProps) {
  return (
    <div className="border-border border-b bg-muted/30 px-5 py-4">
      <div className="flex items-center justify-between">
        {STEPPER_STEPS.map((step, i) => (
          <div className="flex items-center" key={step.id}>
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full font-medium text-sm transition-colors",
                  currentStep > step.id
                    ? "bg-teal-500 text-white"
                    : currentStep === step.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {currentStep > step.id ? (
                  <Check className="h-4 w-4" />
                ) : (
                  step.id
                )}
              </div>
              <div className="hidden sm:block">
                <p
                  className={cn(
                    "font-medium text-sm",
                    currentStep >= step.id
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {step.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {step.description}
                </p>
              </div>
            </div>
            {i < STEPPER_STEPS.length - 1 && (
              <div
                className={cn(
                  "relative left-4 mx-4 h-0.5 w-12",
                  currentStep > step.id ? "bg-teal-500" : "bg-border"
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
