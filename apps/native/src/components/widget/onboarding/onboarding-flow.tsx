"use client";

import { OnboardingHeader } from "@/components/widget/onboarding/onboarding-header";
import { stepLabel } from "@/components/widget/onboarding/lib/onboarding";
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
      className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto px-4 py-8 sm:px-6"
      data-testid="onboarding-flow"
    >
      <OnboardingHeader title={stepLabel(activeStep)} />

      <div className="grid flex-1 gap-8 md:grid-cols-[220px_1fr]">
        <OnboardingSidebar
          activeStep={activeStep}
          furthestStep={furthestStep}
          progress={progress}
          onStepSelect={goToStep}
        />
        <OnboardingStepContent currentStep={activeStep} />
      </div>
    </div>
  );
}
