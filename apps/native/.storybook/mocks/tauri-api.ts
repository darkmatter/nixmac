import { storybookDarwinAPI, tauriEvent } from "./tauri-runtime";

export const DEFAULT_MAX_ITERATIONS = 25;

export const darwinAPI = storybookDarwinAPI;

export const EVOLVE_EVENT_CHANNEL = "darwin:evolve:event";
export const CONFIG_CHANGED_CHANNEL = "config:changed";

export const ipcRenderer = {
  on: tauriEvent.listen,
  once: tauriEvent.once,
};

// Re-export types from shared (Specta-generated)
export type {
  BuildCheckResult,
  ChangeType,
  CliToolsState,
  Config as DarwinConfig,
  ConfigChangedEvent,
  DarwinApplyDataEvent,
  DarwinApplyEndEvent,
  DarwinApplySummaryEvent,
  EvolutionFailureResult,
  EvolutionResult,
  EvolutionState,
  EvolutionTelemetry,
  EvolveEvent,
  EvolveEventType,
  EvolveState,
  EvolveStep,
  FeedbackAiProviderModelInfo,
  FeedbackFlakeInputEntry,
  FeedbackFlakeInputsSnapshot,
  FeedbackMetadataRequest,
  FeedbackPanicDetails,
  FeedbackShareOptions,
  FeedbackSystemInfo,
  FileEntry,
  GitFileStatus,
  GitStatus,
  HomebrewState,
  HistoryItem,
  NixCheckResult,
  NixDarwinRebuildEndEvent,
  NixInstallEndEvent,
  NixInstallErrorType,
  NixInstallPhase,
  NixInstallProgressEvent,
  OkResult,
  Permission,
  PermissionStatus,
  PermissionsState,
  PreviewIndicatorState,
  RecommendedPrompt,
  RebuildErrorType,
  SemanticChangeMap,
  SetDirResult,
  SummarizerUpdateEvent,
  SummarizedChangeSet,
  RustPanicEvent,
  SystemDefault,
  SystemDefaultsScan,
  UiPrefs as DarwinPrefs,
  UiPrefsUpdate as DarwinPrefsUpdate,
  WatcherEvent,
  Change,
  Commit,
  CommitResult,
  ConfigEditApplyResult,
  EvolveCancelResult,
  FinalizeApplyResult,
  RollbackResult,
} from "../../src/types/shared";

export interface FeedbackUsageStats {
  totalEvolutions?: number;
  successRate?: number;
  avgIterations?: number;
  lastComputedAt?: string;
  extra?: Record<string, unknown>;
}

export interface FeedbackMetadata {
  currentAppStateSnapshot?: unknown;
  systemInfo?: import("../../src/types/shared").FeedbackSystemInfo;
  usageStats?: FeedbackUsageStats;
  evolutionLogContent?: string;
  changedNixFilesDiff?: string;
  aiProviderModelInfo?: import("../../src/types/shared").FeedbackAiProviderModelInfo;
  buildErrorOutput?: string;
  flakeInputsSnapshot?: import("../../src/types/shared").FeedbackFlakeInputsSnapshot;
  appLogsContent?: string;
  panicDetails?: import("../../src/types/shared").FeedbackPanicDetails;
}
