"use client";

import { stepIndex, stepLabel, STEPS } from "@/components/widget/onboarding/lib/onboarding";
import { OnboardingHeader } from "@/components/widget/onboarding/onboarding-header";
import { OnboardingSidebar } from "@/components/widget/onboarding/onboarding-sidebar";
import { OnboardingStepContent } from "@/components/widget/onboarding/onboarding-step-content";
import { useOnboardingFlow } from "@/components/widget/onboarding/use-onboarding-flow";

/**
 * The full onboarding experience: brand header + sidebar stepper + the active
 * step. The first three gates are driven by the live ViewModel/IPC; the
 * post-setup steps (customizations, inference, build) are driven by the
 * session-local onboarding store.
 */
export function OnboardingFlow() {
  const { activeStep, furthestStep, progress, goToStep } = useOnboardingFlow();

  return (
    <div
      className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden px-4 py-8 sm:px-6"
      data-testid="onboarding-flow"
    >
      <OnboardingHeader title={`Step ${stepIndex(activeStep) + 1} of ${STEPS.length}`} />

      <div className="grid min-h-0 flex-1 gap-8 md:grid-cols-[220px_1fr]">
        <OnboardingSidebar
          activeStep={activeStep}
          furthestStep={furthestStep}
          progress={progress}
          onStepSelect={goToStep}
        />
        <div className="min-h-0 overflow-y-auto pb-4 pr-1">
          <OnboardingStepContent currentStep={activeStep} title={stepLabel(activeStep)} />
        </div>
      </div>
    </div>
  );
}
