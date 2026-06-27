import type { StepId } from "@/components/widget/onboarding/lib/onboarding";
import { BuildStep } from "@/components/widget/onboarding/steps/build-step";
import { CustomizationsStep } from "@/components/widget/onboarding/steps/customizations-step";
import { InferenceStep } from "@/components/widget/onboarding/steps/inference-step";
import { NixSetupStep } from "@/components/widget/onboarding/steps/nix-setup-step";
import { PermissionsStep } from "@/components/widget/onboarding/steps/permissions-step";
import { SetupStep } from "@/components/widget/onboarding/steps/setup-step";
import { getTelemetry } from "@/lib/telemetry/instance";
import { onboardingActions, useOnboarding } from "@nixmac/state";

interface OnboardingStepContentProps {
  currentStep: StepId;
  title: string;
}

export function OnboardingStepContent({ currentStep, title }: OnboardingStepContentProps) {
  const trackedCustomizations = useOnboarding((s) => s.trackedCustomizations);
  const inference = useOnboarding((s) => s.inference);

  return (
    <main className="min-w-0">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div key={currentStep} className="fade-in slide-in-from-bottom-2 animate-in duration-300">
        {currentStep === "permissions" && <PermissionsStep />}
        {currentStep === "nix-setup" && <NixSetupStep />}
        {currentStep === "setup" && <SetupStep />}
        {currentStep === "customizations" && (
          <CustomizationsStep
            tracked={trackedCustomizations}
            onSetTracked={onboardingActions.setTrackedCustomizations}
            onContinue={onboardingActions.reviewCustomizations}
          />
        )}
        {currentStep === "inference" && (
          <InferenceStep
            onConfigured={onboardingActions.configureInference}
            onSkip={onboardingActions.skipInference}
          />
        )}
        {currentStep === "build" && (
          <BuildStep
            hasInference={Boolean(inference)}
            onConfigureInference={onboardingActions.configureInference}
            onComplete={() => {
              getTelemetry().captureEvent({ name: "onboarding_completed" });
              onboardingActions.complete();
            }}
          />
        )}
      </div>
    </main>
  );
}
