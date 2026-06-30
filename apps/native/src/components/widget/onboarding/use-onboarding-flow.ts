import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  computeOnboardingStep,
  resolveOnboardingStep,
  stepIndex,
  STEPS,
  type StepId,
} from "@/components/widget/onboarding/lib/onboarding";
import { onboardingActions, useOnboarding, useViewModel } from "@nixmac/state";
import { settings } from "@/lib/env";

export function useOnboardingFlow(): {
  /** Step to render. */
  activeStep: StepId;
  /** Furthest gate reached; `build` once onboarding is complete. */
  furthestStep: StepId;
  progress: number;
  /** Whether onboarding should take over the window. */
  showFlow: boolean;
  goToStep: (stepId: StepId) => void;
} {
  const permissions = useViewModel((s) => s.permissions);
  const permissionsHydrated = useViewModel((s) => s.permissionsHydrated);
  const nixInstalled = useViewModel((s) => s.nixInstall?.installed ?? null);
  const darwinRebuildAvailable = useViewModel((s) => s.nixInstall?.darwinRebuildAvailable ?? null);
  const configDir = useViewModel((s) => s.preferences?.configDir ?? "");
  const host = useViewModel((s) => s.preferences?.hostAttr ?? "");
  const hosts = useViewModel((s) => s.hosts);
  const evolveProvider = useViewModel((s) => s.preferences?.evolveProvider ?? null);
  const evolveModel = useViewModel((s) => s.preferences?.evolveModel ?? null);
  const macScannedAt = useViewModel((s) => s.preferences?.onboardingMacScannedAt ?? null);
  const loginDecided = useViewModel((s) => s.preferences?.onboardingLoginDecided ?? false);
  const lastBuildAt = useViewModel((s) => s.preferences?.onboardingLastBuildAt ?? null);

  const inferenceDeferred = useOnboarding((s) => s.inferenceDeferred);
  const celebrating = useOnboarding((s) => s.celebrating);
  const viewingStep = useOnboarding((s) => s.viewingStep);

  const permissionsReady =
    settings.skipPermissions ||
    !(permissionsHydrated && permissions && !permissions.allRequiredGranted);
  const nixReady =
    (nixInstalled === true && darwinRebuildAvailable === true) ||
    settings.nixInstalledOverride === true;
  const flakeReady = Boolean(configDir) && Boolean(host) && hosts.includes(host);

  const derivedStep = useMemo(
    () =>
      computeOnboardingStep({
        permissionsReady,
        nixReady,
        flakeReady,
        macScanned: macScannedAt !== null,
        loginDecided,
        hasInference: Boolean(evolveProvider) && Boolean(evolveModel),
        buildComplete: lastBuildAt !== null,
        inferenceDeferred,
      }),
    [
      permissionsReady,
      nixReady,
      flakeReady,
      macScannedAt,
      loginDecided,
      evolveProvider,
      evolveModel,
      lastBuildAt,
      inferenceDeferred,
    ],
  );

  const complete = derivedStep === null;
  // Once complete, keep `build` as the nominal furthest gate for the stepper and
  // progress bar. Celebration keeps the flow mounted past completion until the
  // user dismisses it.
  const furthestStep: StepId = derivedStep ?? "build";
  const showFlow = !complete || celebrating;

  const prevFurthestStep = useRef(furthestStep);
  useEffect(() => {
    if (prevFurthestStep.current !== furthestStep) {
      onboardingActions.setViewingStep(null);
      prevFurthestStep.current = furthestStep;
    }
  }, [furthestStep]);

  const activeStep = useMemo(
    () => resolveOnboardingStep(furthestStep, viewingStep),
    [furthestStep, viewingStep],
  );

  const progress = useMemo(() => {
    if (complete) return 100;
    return (stepIndex(furthestStep) / (STEPS.length - 1)) * 100;
  }, [complete, furthestStep]);

  const goToStep = useCallback(
    (stepId: StepId) => {
      const furthestIndex = stepIndex(furthestStep);
      const targetIndex = stepIndex(stepId);
      if (targetIndex === -1 || targetIndex > furthestIndex) return;
      onboardingActions.setViewingStep(stepId === furthestStep ? null : stepId);
    },
    [furthestStep],
  );

  return { activeStep, furthestStep, progress, showFlow, goToStep };
}
