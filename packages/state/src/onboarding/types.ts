import type { InferenceConfig } from "../onboarding-types";

export type OnboardingStepId =
  | "permissions"
  | "nix-setup"
  | "setup"
  | "customizations"
  | "inference"
  | "build";

export type OnboardingStateValues = {
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
  /** When set, the user is reviewing a completed step instead of the furthest gate. */
  viewingStep: OnboardingStepId | null;
};
