export type InferenceMode = "hosted" | "byok";

/** Resolved inference choice persisted on the onboarding state. */
export type InferenceConfig =
  | { mode: "hosted"; email: string; plan: string }
  | { mode: "byok"; providerId: string; providerName: string; model: string };
