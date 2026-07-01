import type { StepId } from "@/components/widget/onboarding/lib/onboarding";
import { BuildStep } from "@/components/widget/onboarding/steps/build-step";
import { ConfigDirStep } from "@/components/widget/onboarding/steps/config-dir-step";
import { CustomizationsStep } from "@/components/widget/onboarding/steps/customizations-step";
import { InferenceStep } from "@/components/widget/onboarding/steps/inference-step";
import { NixSetupStep } from "@/components/widget/onboarding/steps/nix-setup-step";
import { PermissionsStep } from "@/components/widget/onboarding/steps/permissions-step";
import { SetupStep } from "@/components/widget/onboarding/steps/setup-step";
import { useOnboardingProgress } from "@/hooks/use-onboarding-progress";
import { onboardingActions, useOnboarding, useViewModel } from "@nixmac/state";

interface OnboardingStepContentProps {
  currentStep: StepId;
  title: string;
}

export function OnboardingStepContent({ currentStep, title }: OnboardingStepContentProps) {
  const trackedCustomizations = useOnboarding((s) => s.trackedCustomizations);
  const trackedCustomizationSources = useOnboarding((s) => s.trackedCustomizationSources);
  // Inference readiness is a durable fact: provider + model are persisted to
  // GlobalPreferences by InferenceSetup, and the login decision is recorded
  // separately. The build step only needs to know inference is configured.
  const evolveProvider = useViewModel((s) => s.preferences?.evolveProvider ?? null);
  const evolveModel = useViewModel((s) => s.preferences?.evolveModel ?? null);
  const hasInference = Boolean(evolveProvider) && Boolean(evolveModel);
  const { markMacScanned, markLoginDecided } = useOnboardingProgress();

  return (
    <main className="min-w-0">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div key={currentStep} className="fade-in slide-in-from-bottom-2 animate-in duration-300">
        {currentStep === "permissions" && <PermissionsStep />}
        {currentStep === "nix-setup" && <NixSetupStep />}
        {currentStep === "config-dir" && <ConfigDirStep />}
        {currentStep === "setup" && <SetupStep />}
        {currentStep === "customizations" && (
          <CustomizationsStep
            tracked={trackedCustomizations}
            trackedSources={trackedCustomizationSources}
            onSetTracked={onboardingActions.setTrackedCustomizations}
            onContinue={markMacScanned}
          />
        )}
        {currentStep === "inference" && (
          <InferenceStep
            onConfigured={markLoginDecided}
            onSkip={onboardingActions.deferInference}
          />
        )}
        {currentStep === "build" && (
          <BuildStep hasInference={hasInference} onConfigureInference={markLoginDecided} />
        )}
      </div>
    </main>
  );
}
