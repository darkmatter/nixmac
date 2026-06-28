export type OnboardingStepId =
  | "permissions"
  | "nix-setup"
  | "setup"
  | "customizations"
  | "inference"
  | "build";

/**
 * Transient, session-only onboarding UI state. Completion and per-step progress
 * are NOT stored here — they are derived from durable facts (permissions, nix,
 * flake/host, and persisted `GlobalPreferences`). This store only holds intent
 * and view state that legitimately resets each launch.
 */
export type OnboardingStateValues = {
  /** IDs of detected customizations the user toggled while reviewing the scan. */
  trackedCustomizations: string[];
  /** User chose to defer inference setup until the first build runs. */
  inferenceDeferred: boolean;
  /** Keep the success celebration mounted after the build gate is satisfied. */
  celebrating: boolean;
  /** When set, the user is reviewing an earlier step instead of the furthest gate. */
  viewingStep: OnboardingStepId | null;
};
