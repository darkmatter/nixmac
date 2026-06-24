import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  computeOnboardingStep,
  resolveOnboardingStep,
  stepIndex,
  STEPS,
  type StepId,
} from "@/components/widget/onboarding/lib/onboarding";
import { onboardingActions, useOnboarding } from "@nixmac/state";
import { settings } from "@/lib/env";
import { useViewModel } from "@nixmac/state";

export function useOnboardingFlow(): {
  activeStep: StepId;
  furthestStep: StepId;
  progress: number;
  goToStep: (stepId: StepId) => void;
} {
  const permissions = useViewModel((s) => s.permissions);
  const permissionsHydrated = useViewModel((s) => s.permissionsHydrated);
  const nixInstalled = useViewModel((s) => s.nixInstall?.installed ?? null);
  const darwinRebuildAvailable = useViewModel((s) => s.nixInstall?.darwinRebuildAvailable ?? null);
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const host = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const hosts = useViewModel((s) => s.hosts);

  const customizationsReviewed = useOnboarding((s) => s.customizationsReviewed);
  const inference = useOnboarding((s) => s.inference);
  const inferenceSkipped = useOnboarding((s) => s.inferenceSkipped);
  const onboardingActive = useOnboarding((s) => s.active);
  const onboardingCompleted = useOnboarding((s) => s.completed);
  const viewingStep = useOnboarding((s) => s.viewingStep);

  const permissionsReady = !(permissionsHydrated && permissions && !permissions.allRequiredGranted);
  const nixReady =
    (nixInstalled === true && darwinRebuildAvailable === true) ||
    settings.NIX_INSTALLED_OVERRIDE === true;
  const flakeReady = Boolean(configDir) && Boolean(host) && hosts.includes(host);

  const furthestStep = useMemo(
    () =>
      computeOnboardingStep({
        permissionsReady,
        nixReady,
        flakeReady,
        customizationsReviewed,
        hasInference: Boolean(inference),
        inferenceSkipped,
      }),
    [
      permissionsReady,
      nixReady,
      flakeReady,
      customizationsReviewed,
      inference,
      inferenceSkipped,
    ],
  );

  const prevFurthestStep = useRef(furthestStep);
  useEffect(() => {
    if (prevFurthestStep.current !== furthestStep) {
      onboardingActions.setViewingStep(null);
      prevFurthestStep.current = furthestStep;
    }
  }, [furthestStep]);

  useEffect(() => {
    if (flakeReady && !onboardingActive && !onboardingCompleted) {
      onboardingActions.beginPostSetup();
    }
  }, [flakeReady, onboardingActive, onboardingCompleted]);

  const activeStep = useMemo(
    () => resolveOnboardingStep(furthestStep, viewingStep),
    [furthestStep, viewingStep],
  );

  const progress = useMemo(() => {
    const furthestIndex = stepIndex(furthestStep);
    return (furthestIndex / (STEPS.length - 1)) * 100;
  }, [furthestStep]);

  const goToStep = useCallback(
    (stepId: StepId) => {
      const furthestIndex = stepIndex(furthestStep);
      const targetIndex = stepIndex(stepId);
      if (targetIndex === -1 || targetIndex > furthestIndex) return;
      onboardingActions.setViewingStep(stepId === furthestStep ? null : stepId);
    },
    [furthestStep],
  );

  return { activeStep, furthestStep, progress, goToStep };
}
