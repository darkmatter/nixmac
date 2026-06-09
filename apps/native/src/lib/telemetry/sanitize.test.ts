import { describe, expect, it } from "vitest";
import { preparePostHogEvent, sanitizeDiagnosticText } from "./sanitize";
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
    });

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
    });

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

  it("keeps the diagnostic text scrubber available for boot diagnostics", () => {
    expect(sanitizeDiagnosticText("user@example.com /Users/farhan/project")).toBe(
      "[REDACTED] /Users/[REDACTED_USER]/project",
    );
  });
});
