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

/**
 * Inputs to the onboarding step machine. Every field is a durable, derivable
 * fact (backend gates + persisted preferences), except `inferenceDeferred`
 * which is transient session intent ("finish inference while the build runs").
 */
export interface OnboardingStepInputs {
  /** All required macOS permissions granted. */
  permissionsReady: boolean;
  /** Nix and darwin-rebuild both detected (or test override). */
  nixReady: boolean;
  /** A config dir + a valid host attribute are set. */
  flakeReady: boolean;
  /** The user has run the "scan this Mac" customizations pass at least once. */
  macScanned: boolean;
  /** The user logged in or explicitly chose bring-your-own-key. */
  loginDecided: boolean;
  /** A resolved inference provider + model are persisted. */
  hasInference: boolean;
  /** At least one successful build/evolution has been applied. */
  buildComplete: boolean;
  /** Session-only: user deferred inference to run alongside the first build. */
  inferenceDeferred: boolean;
}

/**
 * Returns the first onboarding gate that is not yet satisfied, or `null` when
 * onboarding is complete. Every gate is derived from durable facts, so the
 * answer is stable across restarts — a finished user computes `null` and never
 * re-enters the flow, while a regressed prerequisite (revoked permission,
 * missing flake) naturally re-surfaces its gate. Steps run strictly in order.
 */
export function computeOnboardingStep(inputs: OnboardingStepInputs): StepId | null {
  if (!inputs.permissionsReady) return "permissions";
  if (!inputs.nixReady) return "nix-setup";
  if (!inputs.flakeReady) return "setup";
  // Importing existing customizations is optional, but the user must run the
  // scan once before moving on.
  if (!inputs.macScanned) return "customizations";
  const inferenceReady = inputs.loginDecided && inputs.hasInference;
  // Inference can be deferred to run alongside the first build; the build step
  // hosts the inline inference setup in that case.
  if (!inferenceReady && !inputs.inferenceDeferred) return "inference";
  // The build gate needs both a successful apply and a configured inference.
  if (!inputs.buildComplete || !inferenceReady) return "build";
  return null;
}
