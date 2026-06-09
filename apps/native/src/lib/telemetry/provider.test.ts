import posthog from "posthog-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetryProvider } from "./provider";
import type { TelemetryEvent } from "./types";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  init: vi.fn(),
  invoke: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: mocks.capture,
    init: mocks.init,
    opt_in_capturing: mocks.optIn,
    opt_out_capturing: mocks.optOut,
    register: mocks.register,
    reset: mocks.reset,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

const config = {
  environment: "test",
  host: "https://us.i.posthog.com",
  key: "phc_test",
  release: "0.0.0-test",
};

describe("createTelemetryProvider", () => {
  const silentOptIn = { captureEventName: false };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.init.mockImplementation((_key, options) => {
      options.loaded?.(posthog);
    });
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("keeps product capture off when product analytics is disabled", () => {
    const telemetry = createTelemetryProvider(config, {
      diagnosticsEnabled: true,
      productAnalyticsEnabled: false,
    });

    telemetry.captureEvent({ name: "app_launched", props: { environment: "production" } });

    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("captures only allowlisted sanitized product properties when product analytics is enabled", () => {
    const telemetry = createTelemetryProvider(config, {
      diagnosticsEnabled: false,
      productAnalyticsEnabled: true,
    });

    telemetry.captureEvent({
      name: "evolve_failed",
      props: {
        diff: "raw diff",
        stage: "build",
      },
    } as unknown as TelemetryEvent);

    expect(mocks.capture).toHaveBeenCalledWith("evolve_failed", { stage: "build" });
  });

  it("does not forward product events into the diagnostics span path", () => {
    const telemetry = createTelemetryProvider(config, {
      diagnosticsEnabled: true,
      productAnalyticsEnabled: true,
    });

    telemetry.captureEvent({ name: "rollback_performed" });

    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("gates error capture on diagnostics rather than product analytics", () => {
    const telemetry = createTelemetryProvider(config, {
      diagnosticsEnabled: true,
      productAnalyticsEnabled: false,
    });

    telemetry.captureError(new Error("boom"), { setting: "safe" });

    expect(mocks.invoke).toHaveBeenCalled();
  });

  it("can disable and re-enable product analytics without changing diagnostics", () => {
    const telemetry = createTelemetryProvider(config, {
      diagnosticsEnabled: true,
      productAnalyticsEnabled: true,
    });

    telemetry.setProductAnalyticsEnabled(false);
    telemetry.captureEvent({ name: "app_launched", props: { environment: "production" } });

    expect(mocks.optOut).toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalled();
    expect(mocks.register).toHaveBeenLastCalledWith({
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
      environment: "test",
      release: "0.0.0-test",
    });
    expect(mocks.capture).not.toHaveBeenCalled();

    telemetry.setProductAnalyticsEnabled(true);
    telemetry.captureEvent({ name: "app_launched", props: { environment: "production" } });

    expect(mocks.optIn).toHaveBeenCalledTimes(2);
    expect(mocks.optIn).toHaveBeenCalledWith(silentOptIn);
    expect(mocks.register).toHaveBeenCalledTimes(3);
    expect(mocks.register).toHaveBeenLastCalledWith({
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
      environment: "test",
      release: "0.0.0-test",
    });
    expect(mocks.capture).toHaveBeenCalledWith("app_launched", { environment: "production" });
    expect(telemetry.diagnosticsEnabled).toBe(true);
  });

  it("initializes PostHog with passive capture features disabled", () => {
    createTelemetryProvider(config, {
      diagnosticsEnabled: false,
      productAnalyticsEnabled: true,
    });

    expect(mocks.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        autocapture: false,
        capture_pageleave: false,
        capture_pageview: false,
        disable_session_recording: true,
        ip: false,
        opt_out_capturing_by_default: false,
        sanitize_properties: expect.any(Function),
      }),
    );

    const options = mocks.init.mock.calls[0]?.[1] as {
      sanitize_properties: (props: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(options.sanitize_properties({ setting: "user@example.com" })).toEqual({
      setting: "[REDACTED]",
    });
    expect(mocks.register).toHaveBeenCalledWith({
      $geoip_disable: true,
      $ip: null,
      $process_person_profile: false,
      environment: "test",
      release: "0.0.0-test",
    });
    expect(mocks.optIn).toHaveBeenCalledTimes(1);
    expect(mocks.optIn).toHaveBeenCalledWith(silentOptIn);
  });
});
