import type { HomebrewItem, LaunchdItem, SystemDefault } from "@nixmac/native/ipc/types";

export type OnboardingStepId =
  | "permissions"
  | "nix-setup"
  | "config-dir"
  | "setup"
  | "customizations"
  | "inference"
  | "build";

export type TrackedCustomizationSource =
  | { type: "homebrew"; item: HomebrewItem }
  | { type: "launchd"; item: LaunchdItem }
  | { type: "system-default"; item: SystemDefault };

/**
 * Transient, session-only onboarding UI state. Completion and per-step progress
 * are NOT stored here — they are derived from durable facts (permissions, nix,
 * flake/host, and persisted `GlobalPreferences`). This store only holds intent
 * and view state that legitimately resets each launch.
 */
export type OnboardingStateValues = {
  /** IDs of detected customizations the user toggled while reviewing the scan. */
  trackedCustomizations: string[];
  /** Original scanner payload for each tracked customization, keyed by customization ID. */
  trackedCustomizationSources: Record<string, TrackedCustomizationSource>;
  /** User chose to defer inference setup until the first build runs. */
  inferenceDeferred: boolean;
  /** Keep the success celebration mounted after the build gate is satisfied. */
  celebrating: boolean;
  /** When set, the user is reviewing an earlier step instead of the furthest gate. */
  viewingStep: OnboardingStepId | null;
  /** Clone dir of an import awaiting a flake-dir choice. The backend keeps no
   * record of it, so restart needs this to discard the tree. */
  pendingImportDir: string | null;
};
