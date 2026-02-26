/**
 * The high-level categories of feedback the user can submit.
 *
 * - `Suggestion`: feature request or UX improvement
 * - `Bug`: an unexpected behavior or error
 * - `General`: other feedback or commentary
 * - `Issue`: a specific issue or problem
 * - `Error`: an error encountered in the application
 */
export enum FeedbackType {
  Suggestion = "suggestion",
  Bug = "bug",
  General = "general",
  Issue = "issue",
  Error = "error",
}

/**
 * Which optional artifacts or telemetry the user agrees to share with the team
 * when submitting feedback.
 */
export interface ShareOptions {
  currentAppState: boolean;
  systemInfo: boolean;
  usageStats: boolean;
  evolutionLog: boolean;
  changedNixFiles: boolean;
  aiProviderModelInfo: boolean;
  buildErrorOutput: boolean;
  flakeInputsSnapshot: boolean;
  nixConfig: boolean;
  appLogs: boolean;
  lastPrompt?: boolean;
}

/**
 * System information captured from the runtime. Fields are optional so
 * collectors can populate what is available on the platform.
 */
export interface SystemInfo {
  osName?: string; // e.g. "macOS"
  osVersion?: string; // e.g. "15.3"
  arch?: string; // e.g. "aarch64-darwin"
  nixVersion?: string; // e.g. "2.24.1"
  appVersion?: string; // app build/version string
}

/**
 * Aggregated nixmac usage statistics from the app.
 * Fields are optional and may be filled by the runtime when
 * the user opts-in to sharing usage stats.
 */
export interface UsageStats {
  /** Total number of evolutions the user has run */
  totalEvolutions?: number;
  /** Success rate as a percentage (0.0 - 100.0) of evolutions */
  successRate?: number;
  /** Average number of iterations per evolution */
  avgIterations?: number;
  /** ISO timestamp when these stats were last computed */
  lastComputedAt?: string;
  extra?: Record<string, unknown>;
}

/**
 * AI provider/model details and usage signals captured from the app.
 * Fields are optional and may be partially populated.
 */
export interface AiProviderModelInfo {
  evolveProvider?: string;
  evolveModel?: string;
  summaryProvider?: string;
  summaryModel?: string;
  totalTokens?: number;
  latencyMs?: number;
  iterations?: number;
  buildAttempts?: number;
}

/**
 * Flake.lock input metadata (subset) captured from the user's configuration.
 */
export interface FlakeInputEntry {
  rev?: string;
  lastModified?: number;
  narHash?: string;
}

export interface FlakeInputsSnapshot {
  nixpkgs?: FlakeInputEntry;
  "nix-darwin"?: FlakeInputEntry;
  "home-manager"?: FlakeInputEntry;
}

/**
 * The serializable shape of feedback that will be sent to the server.
 * This intentionally keeps collected artifacts as optional
 * so they can be attached later when the runtime gathers logs / snapshots.
 */
export interface FeedbackPayload {
  id?: string;
  type: FeedbackType;

  /** Primary freeform feedback text from the user */
  text: string;

  /** Optional second textbox used for bug reports (what the user expected) */
  expectedText?: string;

  /** User opt-in flags for which artifacts may be attached */
  share: ShareOptions;

  /** Optional collected artifacts */
  lastPromptText?: string;
  currentAppStateSnapshot?: unknown;
  /** Structured system info when available */
  systemInfo?: SystemInfo;

  /** Structured usage statistics when available */
  usageStats?: UsageStats;
  usageStatsSnapshot?: unknown;
  evolutionLogContent?: string;
  changedNixFilesDiff?: string;
  aiProviderModelInfo?: AiProviderModelInfo;
  buildErrorOutput?: string;
  flakeInputsSnapshot?: FlakeInputsSnapshot;
  nixConfigSnapshot?: string;
  appLogsContent?: string;

  /** Optional user email (if the user chooses to provide it) */
  email?: string;

  /** ISO timestamp when the feedback was created */
  createdAt: string;
}

/**
 * Lightweight model class for storing and serializing feedback from the dialog.
 */
/**
 * Convenience class wrapping a `FeedbackPayload` with defaults, helpers and
 * light-weight client-side validation. Consumers can construct an instance
 * from form values, call `validate()` and send `toJSON()` to a backend.
 */
export class Feedback {
  public id?: string;
  public type: FeedbackType;
  public text: string;
  public expectedText?: string;
  public share: ShareOptions;
  public createdAt: string;
  public email?: string;

  // Optional collected artifacts (populated later by caller)
  public lastPromptText?: string;
  public currentAppStateSnapshot?: unknown;
  public evolutionLogContent?: string;
  public changedNixFilesDiff?: string;
  public aiProviderModelInfo?: AiProviderModelInfo;
  public buildErrorOutput?: string;
  public flakeInputsSnapshot?: FlakeInputsSnapshot;
  public nixConfigSnapshot?: string;
  public appLogsContent?: string;
  public systemInfo?: SystemInfo;
  public usageStats?: UsageStats;

  /**
   * Create a new Feedback model.
   *
   * The constructor accepts a partial payload and will apply sensible
   * defaults for missing fields (for example: timestamps and share flags).
   */
  constructor(payload: Partial<FeedbackPayload> & { type: FeedbackType; text?: string }) {
    this.id = payload.id;
    this.type = payload.type;
    this.text = payload.text ?? "";
    this.expectedText = payload.expectedText;
    this.email = payload.email;
    this.share = payload.share ?? {
      currentAppState: true,
      systemInfo: true,
      usageStats: true,
      evolutionLog: true,
      changedNixFiles: true,
      aiProviderModelInfo: true,
      buildErrorOutput: true,
      flakeInputsSnapshot: true,
      nixConfig: true,
      appLogs: true,
    };
    this.createdAt = payload.createdAt ?? new Date().toISOString();
    this.lastPromptText = payload.lastPromptText;
    this.currentAppStateSnapshot = payload.currentAppStateSnapshot;
    this.systemInfo = payload.systemInfo;
    this.usageStats = payload.usageStats;
    this.evolutionLogContent = payload.evolutionLogContent;
    this.changedNixFilesDiff = payload.changedNixFilesDiff;
    this.aiProviderModelInfo = payload.aiProviderModelInfo;
    this.buildErrorOutput = payload.buildErrorOutput;
    this.flakeInputsSnapshot = payload.flakeInputsSnapshot;
    this.nixConfigSnapshot = payload.nixConfigSnapshot;
    this.appLogsContent = payload.appLogsContent;
  }

  /**
   * Serialize the model into a plain JSON payload suitable for transmission.
   */
  toJSON(): FeedbackPayload {
    return {
      id: this.id,
      type: this.type,
      text: this.text,
      expectedText: this.expectedText,
      email: this.email,
      share: this.share,
      lastPromptText: this.lastPromptText,
      currentAppStateSnapshot: this.currentAppStateSnapshot,
      systemInfo: this.systemInfo,
      usageStats: this.usageStats,
      evolutionLogContent: this.evolutionLogContent,
      changedNixFilesDiff: this.changedNixFilesDiff,
      aiProviderModelInfo: this.aiProviderModelInfo,
      buildErrorOutput: this.buildErrorOutput,
      flakeInputsSnapshot: this.flakeInputsSnapshot,
      nixConfigSnapshot: this.nixConfigSnapshot,
      appLogsContent: this.appLogsContent,
      createdAt: this.createdAt,
    };
  }

  /**
   * Create a `Feedback` instance from a partial payload. Useful when reading
   * previously-saved feedback or server responses.
   */
  static fromJSON(input: Partial<FeedbackPayload>): Feedback {
    return new Feedback({
      id: input.id,
      type: input.type ?? FeedbackType.General,
      text: input.text ?? "",
      expectedText: input.expectedText,
      share: input.share ?? {
        currentAppState: true,
        systemInfo: true,
        usageStats: true,
        evolutionLog: true,
        changedNixFiles: true,
        aiProviderModelInfo: true,
        buildErrorOutput: true,
        flakeInputsSnapshot: true,
        nixConfig: true,
        appLogs: true,
      },
      lastPromptText: input.lastPromptText,
      currentAppStateSnapshot: input.currentAppStateSnapshot,
      systemInfo: input.systemInfo,
      usageStats: input.usageStats,
      evolutionLogContent: input.evolutionLogContent,
      changedNixFilesDiff: input.changedNixFilesDiff,
      aiProviderModelInfo: input.aiProviderModelInfo,
      buildErrorOutput: input.buildErrorOutput,
      flakeInputsSnapshot: input.flakeInputsSnapshot,
      nixConfigSnapshot: input.nixConfigSnapshot,
      appLogsContent: input.appLogsContent,
      createdAt: input.createdAt,
    });
  }

  /**
   * Basic client-side validation. Returns `ok: true` when the model looks
   * valid for quick checks; otherwise returns a list of error messages.
   */
  validate(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!this.type) errors.push("type is required");
    if (this.type === FeedbackType.Bug && this.text.trim().length === 0) {
      errors.push("bug reports should include a description in 'text'");
    }
    if (
      (this.type === FeedbackType.Issue || this.type === FeedbackType.Error) &&
      this.text.trim().length === 0
    ) {
      errors.push("issue reports should include a description in 'text'");
    }
    if (
      (this.type === FeedbackType.Suggestion || this.type === FeedbackType.General) &&
      this.text.trim().length === 0
    ) {
      errors.push("please provide some text for your feedback");
    }
    return { ok: errors.length === 0, errors };
  }
}
