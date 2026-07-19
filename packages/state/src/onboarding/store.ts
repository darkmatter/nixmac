/**
 * Transient, session-only onboarding UI state. Onboarding completion and
 * per-step progress are derived from durable facts elsewhere (live backend
 * gates + persisted `GlobalPreferences`), NOT stored here — that is what keeps
 * a finished user out of the flow across restarts. This store only holds intent
 * and view state that legitimately resets each launch.
 */

import { create } from "zustand";
import type { InferenceSetupDraft, OnboardingStateValues, OnboardingStepId } from "./types";

export const initialInferenceSetupDraft: InferenceSetupDraft = {
	mode: "hosted",
	hosted: {
		email: "",
		otp: "",
		otpSent: false,
		selectedPlan: "credits",
	},
	byok: {
		providerId: "openrouter",
		model: "",
		key: "",
		baseUrl: "",
	},
};

export const initialOnboardingState: OnboardingStateValues = {
	trackedCustomizations: [],
	trackedCustomizationSources: {},
	inferenceSetupDraft: initialInferenceSetupDraft,
	inferenceDeferred: false,
	celebrating: false,
	viewingStep: null,
};

/** Imperative writers for the transient onboarding UI store. */
export type OnboardingActions = {
	reset: () => void;
	setTrackedCustomizations: (
		trackedCustomizations: string[],
		trackedCustomizationSources: OnboardingStateValues["trackedCustomizationSources"],
	) => void;
	setInferenceSetupDraft: (draft: Partial<InferenceSetupDraft>) => void;
	setHostedInferenceDraft: (
		draft: Partial<InferenceSetupDraft["hosted"]>,
	) => void;
	setByokInferenceDraft: (draft: Partial<InferenceSetupDraft["byok"]>) => void;
	/** Defer inference to the build step (inline setup runs alongside the build). */
	deferInference: () => void;
	/** Keep the success celebration mounted after the build gate is satisfied. */
	setCelebrating: (celebrating: boolean) => void;
	setViewingStep: (viewingStep: OnboardingStepId | null) => void;
};

/** Combined store shape: state values plus the actions that mutate them. */
export type OnboardingStore = OnboardingStateValues & OnboardingActions;

export const onboardingStore = create<OnboardingStore>()((set) => ({
	...initialOnboardingState,
	reset: () => set(initialOnboardingState),
	setTrackedCustomizations: (
		trackedCustomizations,
		trackedCustomizationSources,
	) => set({ trackedCustomizations, trackedCustomizationSources }),
	setInferenceSetupDraft: (draft) =>
		set((state) => ({
			inferenceSetupDraft: {
				...state.inferenceSetupDraft,
				...draft,
			},
		})),
	setHostedInferenceDraft: (draft) =>
		set((state) => ({
			inferenceSetupDraft: {
				...state.inferenceSetupDraft,
				hosted: {
					...state.inferenceSetupDraft.hosted,
					...draft,
				},
			},
		})),
	setByokInferenceDraft: (draft) =>
		set((state) => ({
			inferenceSetupDraft: {
				...state.inferenceSetupDraft,
				byok: {
					...state.inferenceSetupDraft.byok,
					...draft,
				},
			},
		})),
	deferInference: () => set({ inferenceDeferred: true, viewingStep: null }),
	setCelebrating: (celebrating) => set({ celebrating }),
	setViewingStep: (viewingStep) => set({ viewingStep }),
}));

/**
 * Back-compat handle that exposes the store's own actions plus the store's
 * `getState`/`setState`/`subscribe` utilities. Zustand action references are
 * stable for the store's lifetime, so they are picked off the initial state
 * once. Kept so existing call sites that import `onboardingActions` keep
 * working; new code should prefer `onboardingStore` directly.
 */
const {
	reset,
	setTrackedCustomizations,
	setInferenceSetupDraft,
	setHostedInferenceDraft,
	setByokInferenceDraft,
	deferInference,
	setCelebrating,
	setViewingStep,
} = onboardingStore.getInitialState();

export const onboardingActions: OnboardingActions & {
	getState: typeof onboardingStore.getState;
	setState: typeof onboardingStore.setState;
	subscribe: typeof onboardingStore.subscribe;
} = {
	getState: onboardingStore.getState,
	setState: onboardingStore.setState,
	subscribe: onboardingStore.subscribe,
	reset,
	setTrackedCustomizations,
	setInferenceSetupDraft,
	setHostedInferenceDraft,
	setByokInferenceDraft,
	deferInference,
	setCelebrating,
	setViewingStep,
};
