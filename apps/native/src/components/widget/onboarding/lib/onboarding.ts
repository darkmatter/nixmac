export type StepId =
  | "permissions"
  | "nix-setup"
  | "setup"
  | "customizations"
  | "inference"
  | "build";

export const STEPS: { id: StepId; label: string; description: string }[] = [
  { id: "permissions", label: "Permissions", description: "Grant macOS access" },
  { id: "nix-setup", label: "System Setup", description: "Install Nix & nix-darwin" },
  { id: "setup", label: "Import Flake", description: "Import your configuration" },
  { id: "customizations", label: "Import Customizations", description: "Capture existing tweaks" },
  { id: "inference", label: "AI Inference", description: "Hosted or your own key" },
  { id: "build", label: "First Build", description: "Apply your configuration" },
];

/** Stable "Step X of N" label so step numbering stays correct as steps change. */
export function stepEyebrow(id: StepId): string {
  const index = STEPS.findIndex((s) => s.id === id);
  return `Step ${index + 1} of ${STEPS.length}`;
}

/** Human-readable step name for the header and chrome. */
export function stepLabel(id: StepId): string {
  return STEPS.find((s) => s.id === id)?.label ?? id;
}

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

/**
 * Picks the step to render: the user's explicit back-navigation target when
 * valid, otherwise the furthest gate they've reached.
 */
export function resolveOnboardingStep(furthestStep: StepId, viewingStep: StepId | null): StepId {
  if (!viewingStep) return furthestStep;
  const furthestIndex = stepIndex(furthestStep);
  const viewingIndex = stepIndex(viewingStep);
  if (viewingIndex === -1 || viewingIndex > furthestIndex) return furthestStep;
  return viewingStep;
}

/** Inputs to the onboarding step machine — backend gates plus local progress. */
export interface OnboardingStepInputs {
  /** All required macOS permissions granted. */
  permissionsReady: boolean;
  /** Nix and darwin-rebuild both detected (or test override). */
  nixReady: boolean;
  /** A config dir + a valid host attribute are set. */
  flakeReady: boolean;
  /** User finished (or skipped) the import-customizations step. */
  customizationsReviewed: boolean;
  /** A resolved inference config exists. */
  hasInference: boolean;
  /** User deferred inference to the build step. */
  inferenceSkipped: boolean;
}

/**
 * Returns the first onboarding gate that is not yet satisfied. Mirrors the
 * app's computeCurrentStep for the first three gates, then continues into the
 * session-local post-setup steps. Steps run strictly in order.
 */
export function computeOnboardingStep(inputs: OnboardingStepInputs): StepId {
  if (!inputs.permissionsReady) return "permissions";
  if (!inputs.nixReady) return "nix-setup";
  if (!inputs.flakeReady) return "setup";
  // Importing existing customizations is optional, but the user must review
  // the detected items before moving on.
  if (!inputs.customizationsReviewed) return "customizations";
  // Inference is optional here — it can be configured now or deferred to the
  // build step, where it becomes required.
  if (!inputs.hasInference && !inputs.inferenceSkipped) return "inference";
  return "build";
}
