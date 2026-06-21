import { BuildStep } from "@/components/widget/onboarding/steps/build-step";
import { CustomizationsStep } from "@/components/widget/onboarding/steps/customizations-step";
import { InferenceStep } from "@/components/widget/onboarding/steps/inference-step";
import { NixSetupStep } from "@/components/widget/onboarding/steps/nix-setup-step";
import { PermissionsStep } from "@/components/widget/onboarding/steps/permissions-step";
import { SetupStep } from "@/components/widget/onboarding/steps/setup-step";
import type { StepId } from "@/components/widget/onboarding/lib/onboarding";
import { useOnboarding } from "@nixmac/state";
import { getTelemetry } from "@/lib/telemetry/instance";

interface OnboardingStepContentProps {
  currentStep: StepId;
}

export function OnboardingStepContent({ currentStep }: OnboardingStepContentProps) {
  const onboarding = useOnboarding();

  return (
    <main className="min-w-0">
      <div key={currentStep} className="fade-in slide-in-from-bottom-2 animate-in duration-300">
        {currentStep === "permissions" && <PermissionsStep />}
        {currentStep === "nix-setup" && <NixSetupStep />}
        {currentStep === "setup" && <SetupStep />}
        {currentStep === "customizations" && (
          <CustomizationsStep
            tracked={onboarding.trackedCustomizations}
            onSetTracked={onboarding.setTrackedCustomizations}
            onContinue={onboarding.reviewCustomizations}
          />
        )}
        {currentStep === "inference" && (
          <InferenceStep
            onConfigured={onboarding.configureInference}
            onSkip={onboarding.skipInference}
          />
        )}
        {currentStep === "build" && (
          <BuildStep
            hasInference={Boolean(onboarding.inference)}
            onConfigureInference={onboarding.configureInference}
            onComplete={() => {
              getTelemetry().captureEvent({ name: "onboarding_completed" });
              onboarding.complete();
            }}
          />
        )}
      </div>
    </main>
  );
}
