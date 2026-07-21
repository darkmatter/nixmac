export {
	initialViewModelState,
	viewModelActions,
	viewModelStore,
	type ViewModelActions,
	type ViewModelStore,
} from "./viewmodel";
export {
	selectChangeMap,
	selectEvolve,
	selectEvolveEvents,
	selectExternalBuildDetected,
	selectGit,
	selectHistory,
	selectHosts,
	selectNixInstall,
	selectPermissions,
	selectPermissionsHydrated,
	selectPreferences,
	selectPromptHistory,
	selectRebuildLog,
	selectRebuildStatus,
	useViewModel,
	type ViewModelSelector,
} from "./viewmodel";
export type { RebuildLog, ViewModel, ViewModelState } from "./viewmodel";

export {
	initialUiState,
	uiActions,
	uiStore,
	type UiStateActions,
	type UiStateStore,
} from "./ui";
export {
	selectCommitMessageSuggestion,
	selectConsoleLogs,
	selectConversationalResponse,
	selectEditingFile,
	selectError,
	selectEvolutionTelemetry,
	selectEvolvePrompt,
	selectFeedbackOpen,
	selectFilesystemTargetSection,
	selectIsBootstrapping,
	selectIsGenerating,
	selectIsProcessing,
	selectIsSummarizing,
	selectProcessingAction,
	selectRecommendedPrompt,
	selectRebuildContext,
	selectRebuildPanelDismissed,
	selectSettingsActiveTab,
	selectSettingsOpen,
	selectShowFilesystem,
	selectShowHistory,
	useUiState,
	type UiStateSelector,
} from "./ui";
export type { ProcessingAction, SettingsTab, UiStateValues } from "./ui";

export {
	initialOnboardingState,
	onboardingActions,
	onboardingStore,
	type OnboardingActions,
	type OnboardingStore,
} from "./onboarding";
export {
	selectCelebrating,
	selectInferenceDeferred,
	selectTrackedCustomizations,
	selectViewingStep,
	useOnboarding,
	type OnboardingSelector,
} from "./onboarding";
export type { InferenceSetupDraft, TrackedCustomizationSource } from "./onboarding";

export type { InferenceConfig, InferenceMode } from "./onboarding-types";
