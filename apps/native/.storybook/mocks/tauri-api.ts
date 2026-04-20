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
  ChangeType,
  EvolutionFailureResult,
  EvolutionResult,
  EvolutionState,
  EvolutionTelemetry,
  EvolveState,
  EvolveStep,
  GitFileStatus,
  GitStatus,
  HistoryItem,
  SemanticChangeMap,
  SummarizedChangeSet,
  WatcherEvent,
  Change,
  Commit,
} from "../../src/types/shared";

// Types defined in the real tauri-api.ts (not Specta-generated)

export interface DarwinConfig {
  configDir: string;
  hostAttr?: string | null;
}

export interface DarwinPrefs {
  openrouterApiKey?: string;
  openaiApiKey?: string;
  summaryProvider?: string;
  summaryModel?: string;
  evolveProvider?: string;
  evolveModel?: string;
  maxIterations?: number;
  maxBuildAttempts?: number;
  ollamaApiBaseUrl?: string;
  vllmApiBaseUrl?: string;
  vllmApiKey?: string;
  sendDiagnostics?: boolean;
  confirmBuild?: boolean;
  confirmClear?: boolean;
  confirmRollback?: boolean;
}

export interface ApplyResult {
  gitStatus: import("../../src/types/shared").GitStatus;
  evolveState: import("../../src/types/shared").EvolveState;
}

export interface CommitResult {
  hash: string;
  evolveState: import("../../src/types/shared").EvolveState;
}

export interface RollbackResult {
  gitStatus: import("../../src/types/shared").GitStatus;
  evolveState: import("../../src/types/shared").EvolveState;
}

export interface PreviewIndicatorState {
  visible: boolean;
  summary: string | null;
  filesChanged: number;
  additions?: number;
  deletions?: number;
  isLoading: boolean;
}

export type PermissionStatus = "granted" | "denied" | "pending" | "unknown";

export interface Permission {
  id: string;
  name: string;
  description: string;
  required: boolean;
  canRequestProgrammatically: boolean;
  status: PermissionStatus;
  instructions?: string;
}

export interface PermissionsState {
  permissions: Permission[];
  allRequiredGranted: boolean;
  checkedAt: number | null;
}

export interface RecommendedPrompt {
  id: string;
  promptText: string;
}

export type EvolveEventType =
  | "start"
  | "iteration"
  | "thinking"
  | "reading"
  | "editing"
  | "buildCheck"
  | "buildPass"
  | "buildFail"
  | "toolCall"
  | "apiRequest"
  | "apiResponse"
  | "question"
  | "complete"
  | "error"
  | "info"
  | "summarizing";

export interface EvolveEvent {
  raw: string;
  summary: string;
  eventType: EvolveEventType;
  iteration: number | null;
  timestampMs: number;
}

export interface FeedbackShareOptions {
  currentAppState: boolean;
  systemInfo: boolean;
  usageStats: boolean;
  evolutionLog: boolean;
  changedNixFiles: boolean;
  aiProviderModelInfo: boolean;
  buildErrorOutput: boolean;
  flakeInputsSnapshot: boolean;
  appLogs: boolean;
}

export interface FeedbackMetadata {
  currentAppStateSnapshot?: unknown;
  systemInfo?: unknown;
  usageStats?: unknown;
  evolutionLogContent?: string;
  changedNixFilesDiff?: string;
  aiProviderModelInfo?: unknown;
  buildErrorOutput?: string;
  flakeInputsSnapshot?: unknown;
  appLogsContent?: string;
  lastPromptText?: string;
}

export interface ConfigChangedEvent {
  hasChanges: boolean;
}

export interface UnknownRecord {
  [key: string]: unknown;
}
