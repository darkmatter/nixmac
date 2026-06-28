/**
 * Transient, session-only onboarding UI state. Onboarding completion and
 * per-step progress are derived from durable facts elsewhere (live backend
 * gates + persisted `GlobalPreferences`), NOT stored here — that is what keeps
 * a finished user out of the flow across restarts. This store only holds intent
 * and view state that legitimately resets each launch.
 */

import { create } from "zustand";
import type { OnboardingStateValues } from "./types";

export const initialOnboardingState: OnboardingStateValues = {
  trackedCustomizations: [],
  inferenceDeferred: false,
  celebrating: false,
  viewingStep: null,
};

export const onboardingStore = create<OnboardingStateValues>()(() => initialOnboardingState);
