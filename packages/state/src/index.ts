export {
	initialViewModelState,
	selectChangeMap,
	selectEvolve,
	selectEvolveEvents,
	selectExternalBuildDetected,
	selectGit,
	selectHosts,
	selectNixInstall,
	selectPermissions,
	selectPermissionsHydrated,
	selectPreferences,
	selectPromptHistory,
	selectRebuildLog,
	selectRebuildStatus,
	useViewModel,
	viewModelActions,
	viewModelStore,
	type ViewModelActions,
	type ViewModelSelector,
	type ViewModelStore
} from "./viewmodel";
export type { RebuildLog, ViewModel, ViewModelState } from "./viewmodel";

export {
	initialUiState,
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
	selectRebuildContext,
	selectRebuildPanelDismissed,
	selectRecommendedPrompt,
	selectSettingsActiveTab,
	selectSettingsOpen,
	selectShowFilesystem,
	selectShowHistory,
	uiActions,
	uiStore,
	useUiState,
	type UiStateActions,
	type UiStateSelector,
	type UiStateStore
} from "./ui";
export type { ProcessingAction, SettingsTab, UiStateValues } from "./ui";

export {
	initialOnboardingState,
	onboardingActions,
	onboardingStore,
	selectCelebrating,
	selectInferenceDeferred,
	selectTrackedCustomizations,
	selectViewingStep,
	useOnboarding,
	type OnboardingActions,
	type OnboardingSelector,
	type OnboardingStore
} from "./onboarding";
export type { InferenceSetupDraft, TrackedCustomizationSource } from "./onboarding";

export type { InferenceConfig, InferenceMode } from "./onboarding-types";
