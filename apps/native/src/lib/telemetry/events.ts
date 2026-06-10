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

export type TelemetryEventProps = {
  app_launched: { environment?: string };
  app_ready: { boot_ms?: number };
  apply_completed: { result: ApplyResult; source: ApplySource };
  apply_started: { source: ApplySource };
  diagnostics_opt_in: Record<string, never>;
  diagnostics_opt_out: Record<string, never>;
  evolve_completed: { outcome?: EvolveOutcome; step?: string };
  evolve_failed: { stage?: EvolveStage };
  evolve_started: {
    has_custom_model?: boolean;
    provider?: string;
    source?: EvolveSource;
  };
  nix_setup_completed: { target: NixSetupTarget };
  nix_setup_failed: { target: NixSetupTarget };
  nix_setup_started: { target: NixSetupTarget; trigger: NixSetupTrigger };
  onboarding_completed: { step: OnboardingStep };
  onboarding_step_completed: { source?: SetupSource; step: OnboardingStep };
  product_analytics_opt_in: Record<string, never>;
  product_analytics_opt_out: Record<string, never>;
  rollback_performed: { source?: RollbackSource };
  settings_changed: { setting: string };
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
  evolve_completed: ["outcome", "step"],
  evolve_failed: ["stage"],
  evolve_started: ["provider", "has_custom_model", "source"],
  nix_setup_completed: ["target"],
  nix_setup_failed: ["target"],
  nix_setup_started: ["target", "trigger"],
  onboarding_completed: ["step"],
  onboarding_step_completed: ["step", "source"],
  product_analytics_opt_in: [],
  product_analytics_opt_out: [],
  rollback_performed: ["source"],
  settings_changed: ["setting"],
} satisfies {
  [Name in TelemetryEventName]: readonly (keyof TelemetryEventProps[Name])[];
};
