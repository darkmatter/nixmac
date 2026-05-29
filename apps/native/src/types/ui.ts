import type {
  EvolutionTelemetry,
  EvolveEvent,
  EvolveState,
  FileDiffContents,
  GitStatus,
  HistoryItem,
  PermissionsState,
  RecommendedPrompt,
  SemanticChangeMap,
  UpdateChannel,
} from "@/ipc/types";
import type { FeedbackType } from "@/types/feedback";

export type SettingsTab = "general" | "api-keys" | "ai-models" | "preferences" | "developer";

export type WidgetStep =
  | "permissions"
  | "nix-setup"
  | "setup"
  | "begin"
  | "evolve"
  | "commit"
  | "manualEvolve"
  | "manualCommit"
  | "history"
  | "filesystem";

type ProcessingAction = "evolve" | "apply" | "merge" | "cancel" | null;

export type ConfirmPrefKey = "confirmBuild" | "confirmClear" | "confirmRollback";
export type BoolPrefKey =
  | ConfirmPrefKey
  | "autoSummarizeOnFocus"
  | "scanHomebrewOnStartup"
  | "defaultToDiffTab";

export type RebuildErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "full_disk_access"
  | "user_cancelled"
  | "authorization_denied"
  | "generic_error";

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

export type RebuildContext = "rollback" | "apply";

export interface RebuildState {
  isRunning: boolean;
  context: RebuildContext;
  lines: RebuildLine[];
  rawLines: string[];
  exitCode?: number;
  success?: boolean;
  errorType?: RebuildErrorType;
  errorMessage?: string;
}

export const initialRebuildState: RebuildState = {
  isRunning: false,
  context: "apply",
  lines: [],
  rawLines: [],
  exitCode: undefined,
  success: undefined,
  errorType: undefined,
  errorMessage: undefined,
};

export interface WidgetState {
  // Permissions (checked on startup)
  permissionsState: PermissionsState | null;
  permissionsChecked: boolean;

  // Config (from backend)
  configDir: string;
  hosts: string[];
  host: string;

  // Bootstrap (creating default config)
  isBootstrapping: boolean;

  // Nix installation
  nixInstalled: boolean | null; // null = not checked yet
  nixInstalling: boolean;
  nixInstallPhase: "downloading" | "waiting-for-installer" | "prefetching" | null;
  nixDownloadProgress: { downloaded: number; total: number } | null;

  // nix-darwin (darwin-rebuild availability)
  darwinRebuildAvailable: boolean | null; // null = not checked yet

  // Evolve state derived from backend source of truth
  evolveState: EvolveState | null;
  externalBuildDetected: boolean;

  // Git (from backend)
  gitStatus: GitStatus | null;
  fileDiffContents: Record<string, FileDiffContents>;

  // Evolution
  evolvePrompt: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];
  promptHistory: string[];
  conversationalResponse: string | null;
  evolutionTelemetry: EvolutionTelemetry | null;

  changeMap: SemanticChangeMap | null;

  // Commit message suggestion (generated on merge screen)
  commitMessageSuggestion: string | null;

  // Rebuild state (for inline rebuild progress)
  rebuild: RebuildState;

  // Console
  consoleLogs: string;

  // History
  history: HistoryItem[];
  historyLoading: boolean;
  analyzingHistoryForHashes: Set<string>;

  // UI
  isSummarizing: boolean;
  isGenerating: boolean;
  settingsOpen: boolean;
  settingsActiveTab: SettingsTab | null;
  prefsLoaded: boolean;
  showHistory: boolean;
  showFilesystem: boolean;
  /**
   * Optional initial section to focus when the Filesystem view opens
   * (e.g. when "View" on the Untracked banner is clicked, this is set
   * to "manage"). The view consumes and clears it on mount. `null`
   * means "use the view's default."
   */
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
  // `undefined` means "stale/unfetched", while `null` means "fetched and none found".
  recommendedPrompt: RecommendedPrompt | null | undefined;

  // Confirmation preferences
  confirmBuild: boolean;
  confirmClear: boolean;
  confirmRollback: boolean;

  // Summarization preferences
  autoSummarizeOnFocus: boolean;

  // Startup scanning preferences
  scanHomebrewOnStartup: boolean;

  // Default-tab preference
  defaultToDiffTab: boolean;

  // Developer mode (hidden settings panel for bisecting / pinning to a past release)
  developerMode: boolean;
  pinnedVersion: string | null;
  updateChannel: UpdateChannel;

  // Editor
  editingFile: string | null;
}

export interface WidgetActions {
  // Permissions
  setPermissionsState: (state: PermissionsState | null) => void;
  setPermissionsChecked: (checked: boolean) => void;

  // Setters
  setConfigDir: (dir: string) => void;
  setHosts: (hosts: string[]) => void;
  setHost: (host: string) => void;
  setBootstrapping: (isBootstrapping: boolean) => void;
  setNixInstalled: (installed: boolean | null) => void;
  setNixInstalling: (installing: boolean) => void;
  setNixInstallPhase: (
    phase: "downloading" | "waiting-for-installer" | "prefetching" | null,
  ) => void;
  setNixDownloadProgress: (progress: { downloaded: number; total: number } | null) => void;
  setDarwinRebuildAvailable: (available: boolean | null) => void;
  setEvolveState: (state: EvolveState | null) => void;
  setExternalBuildDetected: (detected: boolean) => void;
  setGitStatus: (status: GitStatus | null) => void;
  setFileDiffContents: (contents: Record<string, FileDiffContents>) => void;
  setEvolvePrompt: (prompt: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setChangeMap: (map: SemanticChangeMap | null) => void;
  setSettingsOpen: (open: boolean, tab?: SettingsTab | null) => void;
  setPrefsLoaded: (loaded: boolean) => void;
  setShowHistory: (show: boolean) => void;
  /**
   * @param section optional initial section id; when omitted on a
   *   `show=true` call the view falls back to its default section.
   */
  setShowFilesystem: (show: boolean, section?: string | null) => void;
  setFeedbackOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  setPanicDetails: (
    details: { message: string; location?: string; backtrace?: string; timestamp: string } | null,
  ) => void;
  setPromptHistory: (history: string[]) => void;
  setRecommendedPrompt: (prompt: RecommendedPrompt | null | undefined) => void;

  // History
  setHistory: (history: HistoryItem[]) => void;
  setHistoryLoading: (loading: boolean) => void;
  addAnalyzingHistoryHash: (hash: string) => void;
  removeAnalyzingHistoryHash: (hash: string) => void;

  // Boolean preferences
  setBoolPref: (key: BoolPrefKey, value: boolean) => void;
  initConfirmPrefs: (prefs: Partial<Record<ConfirmPrefKey, boolean>>) => void;

  // Summarization preferences
  setAutoSummarizeOnFocus: (value: boolean) => void;

  // Developer mode
  setDeveloperMode: (value: boolean) => void;
  setPinnedVersion: (value: string | null) => void;
  setUpdateChannel: (value: UpdateChannel) => void;

  // Client-side state (NOT from server)
  setSummarizing: (summarizing: boolean) => void;
  setGenerating: (generating: boolean) => void;
  setFeedbackTypeOverride: (type: FeedbackType | null) => void;
  openFeedback: (type?: FeedbackType, initialText?: string) => void;

  // Console
  appendLog: (text: string) => void;
  clearLogs: () => void;

  // Evolve events
  appendEvolveEvent: (event: EvolveEvent) => void;
  clearEvolveEvents: () => void;
  setEvolutionTelemetry: (telemetry: EvolutionTelemetry | null) => void;

  setConversationalResponse: (response: string | null) => void;

  // Commit message suggestion
  setCommitMessageSuggestion: (msg: string | null) => void;

  // Rebuild state
  startRebuild: (context: RebuildContext) => void;
  appendRebuildLine: (line: RebuildLine) => void;
  appendRawLine: (line: string) => void;
  setRebuildError: (errorType: RebuildErrorType, errorMessage: string) => void;
  setRebuildComplete: (success: boolean, exitCode?: number) => void;
  clearRebuild: () => void;
}

export type WidgetStore = WidgetState & WidgetActions;
