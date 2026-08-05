export type StepId =
  | "permissions"
  | "nix-setup"
  | "homebrew-setup"
  | "config-dir"
  | "setup"
  | "customizations"
  | "inference"
  | "build";

export const STEPS: { id: StepId; label: string; description: string }[] = [
  { id: "permissions", label: "Permissions", description: "Grant macOS access" },
  { id: "nix-setup", label: "System Setup", description: "Install Nix" },
  { id: "homebrew-setup", label: "Homebrew", description: "Install the Homebrew package manager" },
  { id: "config-dir", label: "Config Directory", description: "Import or create your flake" },
  { id: "setup", label: "Choose Machine", description: "Pick your host configuration" },
  { id: "customizations", label: "Import Customizations", description: "Capture existing tweaks" },
  { id: "inference", label: "AI Inference", description: "Hosted or your own key" },
  { id: "build", label: "First Build", description: "Apply your configuration" },
];

/**
 * First user-driven step. The gates above it (permissions, Nix install) are
 * real machine state that a reset can't and shouldn't undo, so "Restart
 * setup" rewinds to here; the stepper draws a separator above it to hint at
 * that boundary.
 */
export const RESTART_TARGET_STEP: StepId = "config-dir";

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
  /** The Nix package manager is detected (or test override). nix-darwin is not
   * required here — the first build runs it via `nix run nix-darwin`. */
  nixReady: boolean;
  /** Homebrew (`brew`) is detected on this Mac. */
  homebrewReady: boolean;
  /** Session-only: user chose to skip the optional Homebrew step. */
  homebrewSkipped: boolean;
  /** A config directory has been chosen/imported. */
  configDirReady: boolean;
  /** A valid host attribute is set for the chosen config dir. */
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
 * every gate holds. This is the step machine *inside* the flow: gates derive
 * from durable facts, so in-flow progress is stable across restarts and
 * crashes. It does NOT decide whether the flow is shown — visibility is gated
 * by the backend completion latch (`OnboardingState.completedAt`), so a
 * regressed fact after completion (a cleared host during a settings edit, a
 * revoked permission) never re-summons the wizard. Steps run strictly in
 * order. See docs/2026-07-08-onboarding-state-ownership.md.
 */
export function computeOnboardingStep(inputs: OnboardingStepInputs): StepId | null {
  if (!inputs.permissionsReady) return "permissions";
  if (!inputs.nixReady) return "nix-setup";
  // Homebrew is optional: surface the guided-install gate only until brew is
  // detected or the user skips it for the session.
  if (!inputs.homebrewReady && !inputs.homebrewSkipped) return "homebrew-setup";
  if (!inputs.configDirReady) return "config-dir";
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
