export type OnboardingStep =
  | "config_directory"
  | "host_configuration";

export type SetupSource =
  | "github_import"
  | "manual"
  | "picker"
  | "zip_import";

export type NixSetupTarget = "nix" | "nix_darwin";
export type NixSetupTrigger = "automatic" | "user";
export type EvolveSource = "prompt";
export type EvolveOutcome = "changes" | "conversational";
export type EvolveStage = "agent" | "apply" | "build";
export type ApplySource = "changes" | "history" | "manual_confirm";
export type ApplyResult = "failure" | "success";
export type RollbackSource = "changes";
export type TelemetrySurface = "cli" | "gui";
export type SettingsChangedSetting =
  | "evolve_model"
  | "evolve_provider"
  | "summary_model"
  | "summary_provider";
export type TelemetryErrorCategory =
  | "agent"
  | "authorization_denied"
  | "build_error"
  | "evaluation_error"
  | "full_disk_access"
  | "generic_error"
  | "infinite_recursion"
  | "user_cancelled";

export const toTelemetryErrorCategory = (
  errorType?: string | null,
): TelemetryErrorCategory => {
  switch (errorType) {
    case "agent":
    case "authorization_denied":
    case "build_error":
    case "evaluation_error":
    case "full_disk_access":
    case "generic_error":
    case "infinite_recursion":
    case "user_cancelled":
      return errorType;
    default:
      return "generic_error";
  }
};

export type TelemetryEventProps = {
  app_launched: { environment?: string };
  app_ready: { boot_ms?: number };
  apply_completed: { result: ApplyResult; source: ApplySource };
  apply_started: { source: ApplySource };
  diagnostics_opt_in: Record<string, never>;
  diagnostics_opt_out: Record<string, never>;
  error_occurred: { category: TelemetryErrorCategory; surface: TelemetrySurface };
  evolve_completed: { outcome?: EvolveOutcome; step?: string };
  evolve_failed: { stage?: EvolveStage };
  evolve_started: {
    has_custom_model?: boolean;
    provider?: string;
    source?: EvolveSource;
  };
  history_restore_completed: {
    changed_file_count: number;
    surface: TelemetrySurface;
  };
  history_restore_failed: {
    category: TelemetryErrorCategory;
    changed_file_count: number;
    surface: TelemetrySurface;
  };
  history_restore_started: {
    changed_file_count: number;
    surface: TelemetrySurface;
  };
  nix_setup_completed: { target: NixSetupTarget };
  nix_setup_failed: { target: NixSetupTarget };
  nix_setup_started: { target: NixSetupTarget; trigger: NixSetupTrigger };
  onboarding_started: { surface: TelemetrySurface };
  onboarding_completed: { step: OnboardingStep };
  onboarding_step_completed: { source?: SetupSource; step: OnboardingStep };
  product_analytics_opt_in: Record<string, never>;
  product_analytics_opt_out: Record<string, never>;
  review_accepted: { changed_file_count: number; surface: TelemetrySurface };
  review_rejected: { changed_file_count: number; surface: TelemetrySurface };
  rollback_performed: { source?: RollbackSource };
  settings_changed: {
    setting: SettingsChangedSetting;
    surface: TelemetrySurface;
  };
  settings_opened: { surface: TelemetrySurface };
};

export type TelemetryEventName = keyof TelemetryEventProps;

type RequiredKeys<T> = {
  [Key in keyof T]-?: Record<never, never> extends Pick<T, Key> ? never : Key;
}[keyof T];

type EventForName<Name extends TelemetryEventName> =
  keyof TelemetryEventProps[Name] extends never
    ? { name: Name; props?: never }
    : RequiredKeys<TelemetryEventProps[Name]> extends never
      ? { name: Name; props?: TelemetryEventProps[Name] }
      : { name: Name; props: TelemetryEventProps[Name] };

export type TelemetryEvent = {
  [Name in TelemetryEventName]: EventForName<Name>;
}[TelemetryEventName];

export const TELEMETRY_EVENT_PROPERTY_KEYS = {
  app_launched: ["environment"],
  app_ready: ["boot_ms"],
  apply_completed: ["result", "source"],
  apply_started: ["source"],
  diagnostics_opt_in: [],
  diagnostics_opt_out: [],
  error_occurred: ["category", "surface"],
  evolve_completed: ["outcome", "step"],
  evolve_failed: ["stage"],
  evolve_started: ["provider", "has_custom_model", "source"],
  history_restore_completed: ["changed_file_count", "surface"],
  history_restore_failed: ["category", "changed_file_count", "surface"],
  history_restore_started: ["changed_file_count", "surface"],
  nix_setup_completed: ["target"],
  nix_setup_failed: ["target"],
  nix_setup_started: ["target", "trigger"],
  onboarding_started: ["surface"],
  onboarding_completed: ["step"],
  onboarding_step_completed: ["step", "source"],
  product_analytics_opt_in: [],
  product_analytics_opt_out: [],
  review_accepted: ["changed_file_count", "surface"],
  review_rejected: ["changed_file_count", "surface"],
  rollback_performed: ["source"],
  settings_changed: ["setting", "surface"],
  settings_opened: ["surface"],
} satisfies {
  [Name in TelemetryEventName]: readonly (keyof TelemetryEventProps[Name])[];
};
