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

import { create } from "zustand";
import type { OnboardingStateValues } from "./types";

export const initialOnboardingState: OnboardingStateValues = {
  trackedCustomizations: [],
  customizationsReviewed: false,
  inference: null,
  inferenceSkipped: false,
  buildComplete: false,
  active: false,
  completed: false,
  viewingStep: null,
};

export const onboardingStore = create<OnboardingStateValues>()(() => initialOnboardingState);
