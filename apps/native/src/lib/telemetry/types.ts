/**
 * Unified telemetry provider interface.
 *
 * Replaces the separate AnalyticsProvider and Sentry init with a single
 * pipeline: OTEL traces for error/crash reporting, PostHog for product analytics.
 */

export type TelemetryEvent =
  | { name: "app_launched"; props?: { environment: string } }
  | { name: "app_ready"; props?: { boot_ms?: number } }
  | {
      name: "evolve_started";
      props?: { provider: string; has_custom_model: boolean };
    }
  | {
      name: "evolve_completed";
      props: { step: string };
    }
  | {
      name: "evolve_failed";
      props?: { stage: "build" | "agent" | "apply" };
    }
  | { name: "rollback_performed" }
  | { name: "settings_changed"; props: { setting: string } }
  | { name: "diagnostics_opt_in" }
  | { name: "diagnostics_opt_out" }
  | { name: "onboarding_completed" }
  | { name: "onboarding_restarted" }
  | {
      name: "inference_configured";
      props: { mode: "hosted" | "byok"; provider?: string };
    }
  | { name: "inference_skipped" }
  | { name: "account_signed_in" }
  | { name: "first_build_started" }
  | { name: "first_build_completed" }
  | { name: "first_build_failed" }
  | { name: "apply_completed" }
  | { name: "apply_failed" }
  | { name: "customizations_scanned" }
  | {
      name: "customizations_tracked";
      props: { count: number };
    }
  | { name: "history_restored" }
  | { name: "feedback_submitted"; props: { type: string } };

export interface TelemetryProvider {
  /** Record a product event (goes to PostHog + OTEL span). */
  captureEvent(event: TelemetryEvent): void;
  /** Record an error (goes to OTEL → Sentry). */
  captureError(error: Error, context?: Record<string, unknown>): void;
  /** Turn telemetry on/off at runtime. */
  setEnabled(enabled: boolean): void;
  /** Whether telemetry is currently active. */
  readonly enabled: boolean;
  /**
   * Read a PostHog feature flag. Returns the variant key for multivariate
   * flags, a boolean for boolean flags, or `undefined` while flags are still
   * loading (or telemetry is disabled). Prefer the reactive `useFeatureFlag`
   * hook in components so the value updates when flags arrive.
   */
  getFeatureFlag(key: string): boolean | string | undefined;
  /**
   * Subscribe to feature-flag changes (initial load + refreshes). Returns an
   * unsubscribe function. The callback fires after flags become available.
   */
  onFeatureFlags(callback: () => void): () => void;
  /** Clear identity / queued state. */
  reset(): void;
}
