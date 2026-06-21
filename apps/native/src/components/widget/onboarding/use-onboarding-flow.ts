import { useEffect, useMemo } from "react";
import {
  computeOnboardingStep,
  STEPS,
  type StepId,
} from "@/components/widget/onboarding/lib/onboarding";
import { useOnboarding } from "@nixmac/state";
import { settings } from "@/lib/env";
import { useViewModel } from "@nixmac/state";

export function useOnboardingFlow(): { currentStep: StepId; progress: number } {
  const permissions = useViewModel((s) => s.permissions);
  const permissionsHydrated = useViewModel((s) => s.permissionsHydrated);
  const nixInstalled = useViewModel((s) => s.nixInstall?.installed ?? null);
  const darwinRebuildAvailable = useViewModel((s) => s.nixInstall?.darwinRebuildAvailable ?? null);
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const host = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const hosts = useViewModel((s) => s.hosts);

  const onboarding = useOnboarding();

  const permissionsReady = !(permissionsHydrated && permissions && !permissions.allRequiredGranted);
  const nixReady =
    (nixInstalled === true && darwinRebuildAvailable === true) ||
    settings.NIX_INSTALLED_OVERRIDE === true;
  const flakeReady = Boolean(configDir) && Boolean(host) && hosts.includes(host);

  const currentStep = useMemo(
    () =>
      computeOnboardingStep({
        permissionsReady,
        nixReady,
        flakeReady,
        customizationsReviewed: onboarding.customizationsReviewed,
        hasInference: Boolean(onboarding.inference),
        inferenceSkipped: onboarding.inferenceSkipped,
      }),
    [
      permissionsReady,
      nixReady,
      flakeReady,
      onboarding.customizationsReviewed,
      onboarding.inference,
      onboarding.inferenceSkipped,
    ],
  );

  useEffect(() => {
    if (flakeReady && !onboarding.active && !onboarding.completed) {
      onboarding.beginPostSetup();
    }
  }, [flakeReady, onboarding]);

  const progress = useMemo(() => {
    const currentIndex = STEPS.findIndex((s) => s.id === currentStep);
    return (currentIndex / (STEPS.length - 1)) * 100;
  }, [currentStep]);

  return { currentStep, progress };
}
