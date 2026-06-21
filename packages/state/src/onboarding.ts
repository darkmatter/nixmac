import { create } from "zustand";
import type { InferenceConfig } from "./onboarding-types";

/**
 * Local onboarding state for the steps that have no backend-mirrored cell of
 * their own. The first three gates (permissions, nix, flake import) are driven
 * entirely by the ViewModel/IPC; the post-setup steps below are session-local.
 *
 * `active` flips on once the user finishes the flake-import step inside the
 * onboarding flow, which keeps the new post-setup steps on screen even though
 * the backend already considers the Mac "set up". `completed` ends onboarding
 * and lets the widget route into the normal app.
 */
interface OnboardingState {
  /** IDs of detected customizations the user chose to track into their config. */
  trackedCustomizations: string[];
  /** User has finished (or skipped) the import-customizations step. */
  customizationsReviewed: boolean;
  /** Resolved AI inference choice — hosted account or bring-your-own-key. */
  inference: InferenceConfig | null;
  /** User chose to defer inference setup until the build runs. */
  inferenceSkipped: boolean;
  /** First build finished successfully. */
  buildComplete: boolean;
  /** Post-setup onboarding is in progress this session. */
  active: boolean;
  /** User finished onboarding — the widget may route into the app. */
  completed: boolean;

  setTrackedCustomizations: (ids: string[]) => void;
  reviewCustomizations: () => void;
  configureInference: (inference: InferenceConfig) => void;
  skipInference: () => void;
  setBuildComplete: (complete: boolean) => void;
  /** Called when the flake-import step is satisfied, opening the new steps. */
  beginPostSetup: () => void;
  complete: () => void;
  reset: () => void;
}

const INITIAL = {
  trackedCustomizations: [] as string[],
  customizationsReviewed: false,
  inference: null as InferenceConfig | null,
  inferenceSkipped: false,
  buildComplete: false,
  active: false,
  completed: false,
};

export const useOnboarding = create<OnboardingState>((set) => ({
  ...INITIAL,
  setTrackedCustomizations: (trackedCustomizations) => set({ trackedCustomizations }),
  reviewCustomizations: () => set({ customizationsReviewed: true }),
  configureInference: (inference) => set({ inference, inferenceSkipped: false }),
  skipInference: () => set({ inferenceSkipped: true }),
  setBuildComplete: (buildComplete) => set({ buildComplete }),
  beginPostSetup: () => set({ active: true }),
  complete: () => set({ completed: true, active: false }),
  reset: () => set({ ...INITIAL }),
}));
