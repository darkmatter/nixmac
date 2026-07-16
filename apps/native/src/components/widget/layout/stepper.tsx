"use client";

import { useCurrentStep } from "@/hooks/use-current-step";
import type { EvolveStep } from "@/ipc/orpc-bindings";
import { cn } from "@/lib/utils";
import { uiActions, useUiState, useViewModel } from "@nixmac/state";
import { Check } from "lucide-react";
import { Fragment } from "react";

const STEPS: Array<{
  step: Extract<EvolveStep, "begin" | "evolve" | "commit">;
  name: string;
  description: string;
}> = [
    { step: "begin", name: "Describe", description: "What to change" },
    { step: "evolve", name: "Review", description: "Check & test" },
    { step: "commit", name: "Save", description: "Keep changes" },
  ];

const stepIndexByEvolveStep: Record<EvolveStep, number> = {
  begin: 0,
  evolve: 1,
  manualEvolve: 1,
  commit: 2,
  manualCommit: 2,
};

export function Stepper() {
  const step = useCurrentStep();
  const isGenerating = useUiState((s) => s.isGenerating);
  const rawBackendStep = useViewModel((s) => s.evolve?.step ?? "begin");
  const hasChanges = useViewModel((s) => (s.git?.changes.length ?? 0) > 0);
  const isRebuilding = useViewModel((s) => s.rebuildStatus?.isRunning ?? false);

  // Review/Save are only real destinations when there's a diff. Without changes
  // the user belongs at the prompt step, so progress collapses to "begin" and
  // the later steps stay locked — matching computeCurrentStep.
  const backendStep = hasChanges ? rawBackendStep : "begin";

  if (
    step === "setup" ||
    step === "permissions" ||
    step === "nix-setup" ||
    step === "history" ||
    step === "filesystem"
  ) {
    return null;
  }

  // While a run is active the stepper stays visible as context (the evolve
  // overlay only covers the content area below it), but navigating between
  // steps is locked.
  const isBusy = isGenerating || isRebuilding;

  // Determine current step index based on widget state
  const currentStepIndex = stepIndexByEvolveStep[step];
  const backendStepIndex = stepIndexByEvolveStep[backendStep];

  const activeStepName = STEPS[currentStepIndex].name;

  return (
    <div className="border-border border-b bg-muted/30 px-3 py-4">
      {/* 5-column grid: step | line | step | line | step */}
      <div
        role="list"
        aria-label={`Progress: step ${currentStepIndex + 1} of ${STEPS.length}, ${activeStepName}`}
        className="grid grid-cols-[2.5fr_1fr_2.5fr_1fr_2.5fr] items-center max-w-2xl mx-auto xs:-translate-x-3 sm:-translate-x-5"
      >
        {STEPS.map((stepInfo, index) => {
          const isActive = currentStepIndex === index;
          const isCompleted = backendStepIndex > index && !isActive;
          const canSelectStep = backendStepIndex >= index && !isActive && !isBusy;
          const stepNumber = index + 1;
          const isFirst = index === 0;
          const isMiddle = index === 1;
          const isLast = index === 2;

          const handleStepClick = () => {
            uiActions.setActiveStepOverride(
              index === backendStepIndex ? null : stepInfo.step,
            );
          };

          return (
            <Fragment key={stepInfo.name}>
              {/* Step cell */}
              <div
                role="listitem"
                className={cn(
                  "flex items-center",
                  isFirst && "justify-end",
                  isMiddle && "justify-center",
                  isLast && "justify-start",
                )}
              >
                <button
                  type="button"
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`Go to ${stepInfo.name} step`}
                  disabled={!canSelectStep}
                  onClick={handleStepClick}
                  className={cn(
                    "flex items-center gap-3 rounded-md text-left transition-colors xs:gap-2 sm:gap-3",
                    canSelectStep && "cursor-pointer hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    !canSelectStep && "cursor-default",
                  )}
                >
                  {/* Circle - hidden below xs */}
                  <div
                    className={cn(
                      "hidden xs:flex h-6 min-w-6 sm:min-w-8 sm:h-8 items-center justify-center rounded-full font-medium text-sm transition-colors",
                      isCompleted
                        ? "bg-slate-800 text-slate-100 border border-slate-700/20 shadow-md shadow-slate-800/20"
                        : isActive
                          ? isBusy
                            ? // In transit away from this step: outline only.
                              "border border-primary/60 bg-transparent text-primary"
                            : "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4 font-extrabold text-slate-100 stroke-[3px] drop-shadow-md" />
                    ) : (
                      stepNumber
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-2">
                      <p
                        className={cn(
                          "font-medium text-sm",
                          backendStepIndex >= index ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {stepInfo.name}
                      </p>
                      {/* Small circle - visible only below xs */}
                      <div
                        className={cn(
                          "flex xs:hidden h-[18px] w-[18px] items-center justify-center rounded-full text-xs font-medium transition-colors",
                          isCompleted
                            ? "bg-slate-700 text-white"
                            : isActive
                              ? isBusy
                                ? "border border-primary/60 bg-transparent text-primary"
                                : "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isCompleted ? <Check className="h-3 w-3" /> : stepNumber}
                      </div>
                    </div>
                    <p className="text-muted-foreground text-xs whitespace-nowrap mt-1 xs:mt-[2px]">
                      {stepInfo.description}
                    </p>
                  </div>
                </button>
              </div>

              {/* Connector line cell (after steps 1 and 2). While a run is
                  active, the line out of the current step carries a flowing
                  gradient: we are in transit toward the next step. */}
              {!isLast && (
                <div
                  key={`line-${index}`}
                  data-testid={
                    isBusy && index === currentStepIndex ? "stepper-transition" : undefined
                  }
                  className={cn(
                    "h-0.5 w-[70%] xs:w-[50%]",
                    index === 0 && "ml-[30%]",
                    index === 1 && "mr-[20%]",
                    isBusy && index === currentStepIndex
                      ? "bg-[linear-gradient(90deg,var(--color-border)_25%,var(--color-primary)_50%,var(--color-border)_75%)] bg-[length:200%_100%] motion-safe:animate-stepper-flow"
                      : isCompleted
                        ? "bg-slate-500"
                        : "bg-border",
                  )}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
