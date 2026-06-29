import type {
  EvolutionTelemetry,
  EvolveStep,
  FileDiffContents,
  RecommendedPrompt,
} from "@nixmac/native/ipc/types";
import { FeedbackType } from "@nixmac/native/types/feedback";
import type { RebuildContext } from "@nixmac/native/types/rebuild";

export type SettingsTab =
  | "general"
  | "account"
  | "api-keys"
  | "ai-models"
  | "preferences"
  | "tuning"
  | "developer";

export type ProcessingAction = "evolve" | "apply" | "merge" | "cancel" | null;

/**
 * @todo This needs a pass to determine how much of this is redundant
 */
export type UiStateValues = {
  settingsOpen: boolean;
  settingsActiveTab: SettingsTab | null;
  showHistory: boolean;
  showFilesystem: boolean;
  filesystemTargetSection: string | null;
  feedbackOpen: boolean;
  feedbackTypeOverride: FeedbackType | null;
  feedbackInitialText: string | null;
  panicDetails: {
    message: string;
    location?: string;
    backtrace?: string;
    timestamp: string;
  } | null;
  error: string | null;
  editingFile: string | null;
  evolvePrompt: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  isSummarizing: boolean;
  isGenerating: boolean;
  consoleLogs: string;
  analyzingHistoryForHashes: Set<string>;
  isBootstrapping: boolean;
  /** What kind of rebuild the overlay panel is reporting on. */
  rebuildContext: RebuildContext;
  /** True once the user (or a successful run) dismissed the rebuild panel. */
  rebuildPanelDismissed: boolean;
  /** Command result: assistant reply when an evolve turned out conversational. */
  conversationalResponse: string | null;
  /** Command result: telemetry of the last evolve run. */
  evolutionTelemetry: EvolutionTelemetry | null;
  commitMessageSuggestion: string | null;
  /** On-demand query result: per-file diff contents prefetched for the diff view. */
  fileDiffContents: Record<string, FileDiffContents>;
  /** On-demand query result. `undefined` means "stale/unfetched"; `null` means "fetched and none found". */
  recommendedPrompt: RecommendedPrompt | null | undefined;
  /** Override for the current step. Although computed, this lets the user go back */
  activeStepOverride: EvolveStep | null;
};
