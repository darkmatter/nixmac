import { describe, expect, it } from "vitest";
import { preparePostHogEvent, sanitizeDiagnosticText } from "./sanitize";
import { TELEMETRY_EVENT_PROPERTY_KEYS } from "./events";
import type { TelemetryEvent } from "./types";

describe("telemetry product event sanitization", () => {
  it("drops properties that are not allowlisted for the event", () => {
    const prepared = preparePostHogEvent({
      name: "evolve_failed",
      props: {
        stage: "build",
        diff: "secret diff",
        prompt: "install docker",
        file_path: "/Users/farhan/.darwin/flake.nix",
      },
    } as unknown as TelemetryEvent);

    expect(prepared).toEqual({
      name: "evolve_failed",
      props: { stage: "build" },
    });
  });

  it("redacts sensitive string values on allowed properties", () => {
    const prepared = preparePostHogEvent({
      name: "settings_changed",
      props: {
        setting: "api key sk-test-secret@example.com /Users/farhan/.ssh/id_ed25519",
      },
    } as unknown as TelemetryEvent);

    expect(prepared.props.setting).toContain("[REDACTED]");
    expect(prepared.props.setting).toContain("/Users/[REDACTED_USER]");
    expect(prepared.props.setting).not.toContain("secret@example.com");
    expect(prepared.props.setting).not.toContain("/Users/farhan");
  });

  it("strips URL query strings before product capture", () => {
    const prepared = preparePostHogEvent({
      name: "settings_changed",
      props: {
        setting: "https://nixmac.com/settings?token=secret&email=a@example.com",
      },
    } as unknown as TelemetryEvent);

    expect(prepared.props.setting).toBe("https://nixmac.com/settings");
  });

  it("preserves safe enum boolean and number properties", () => {
    expect(
      preparePostHogEvent({
        name: "evolve_started",
        props: { provider: "openrouter", has_custom_model: false },
      }),
    ).toEqual({
      name: "evolve_started",
      props: { provider: "openrouter", has_custom_model: false },
    });

    expect(
      preparePostHogEvent({
        name: "app_ready",
        props: { boot_ms: 1234 },
      }),
    ).toEqual({
      name: "app_ready",
      props: { boot_ms: 1234 },
    });
  });

  it("keeps every registered product event behind explicit property allowlists", () => {
    expect(Object.keys(TELEMETRY_EVENT_PROPERTY_KEYS).sort()).toEqual([
      "app_launched",
      "app_ready",
      "apply_completed",
      "apply_started",
      "diagnostics_opt_in",
      "diagnostics_opt_out",
      "error_occurred",
      "evolve_completed",
      "evolve_failed",
      "evolve_started",
      "history_restore_completed",
      "history_restore_failed",
      "history_restore_started",
      "nix_setup_completed",
      "nix_setup_failed",
      "nix_setup_started",
      "onboarding_completed",
      "onboarding_started",
      "onboarding_step_completed",
      "product_analytics_opt_in",
      "product_analytics_opt_out",
      "review_accepted",
      "review_rejected",
      "rollback_performed",
      "settings_changed",
      "settings_opened",
    ]);

    const prepared = preparePostHogEvent({
      name: "apply_completed",
      props: {
        error: "raw failure token sk-test",
        result: "success",
        source: "changes",
      },
    } as unknown as TelemetryEvent);

    expect(prepared).toEqual({
      name: "apply_completed",
      props: { result: "success", source: "changes" },
    });
  });

  it("keeps activation-flow additions restricted to aggregate enum payloads", () => {
    expect(
      preparePostHogEvent({
        name: "review_accepted",
        props: {
          changed_file_count: 2,
          diff: "secret diff",
          file_path: "/Users/farhan/.nixmac/flake.nix",
          prompt: "install docker",
          surface: "gui",
        },
      } as unknown as TelemetryEvent),
    ).toEqual({
      name: "review_accepted",
      props: { changed_file_count: 2, surface: "gui" },
    });

    expect(
      preparePostHogEvent({
        name: "history_restore_failed",
        props: {
          category: "build_error",
          error: "raw failure token sk-test",
          log: "full build log",
          surface: "gui",
        },
      } as unknown as TelemetryEvent),
    ).toEqual({
      name: "history_restore_failed",
      props: { category: "build_error", surface: "gui" },
    });
  });

  it("keeps the diagnostic text scrubber available for boot diagnostics", () => {
    expect(sanitizeDiagnosticText("user@example.com /Users/farhan/project")).toBe(
      "[REDACTED] /Users/[REDACTED_USER]/project",
    );
  });
});
