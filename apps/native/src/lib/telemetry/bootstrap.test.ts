import { describe, expect, it, vi } from "vitest";
import type { TelemetryProvider } from "./types";
import {
  bootstrapWithTelemetry,
  captureBootstrapRenderError,
} from "./bootstrap";

function provider(
  captureEvent: TelemetryProvider["captureEvent"] = vi.fn<
    TelemetryProvider["captureEvent"]
  >(),
): TelemetryProvider {
  return {
    enabled: true,
    captureEvent,
    captureError() {},
    setEnabled() {},
    getFeatureFlag() {
      return undefined;
    },
    onFeatureFlags() {
      return () => {};
    },
    reset() {},
  };
}

describe("bootstrapWithTelemetry", () => {
  it("renders with the current provider when telemetry initialization rejects", async () => {
    const fallback = provider();
    const render = vi.fn<(telemetry: TelemetryProvider) => void>();
    const onTelemetryError =
      vi.fn<(phase: "initialize" | "capture", error: unknown) => void>();

    await bootstrapWithTelemetry({
      initTelemetry: vi
        .fn<() => Promise<TelemetryProvider>>()
        .mockRejectedValue(new Error("init failed")),
      getTelemetry: () => fallback,
      render,
      environment: "test",
      onTelemetryError,
    });

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(fallback);
    expect(onTelemetryError).toHaveBeenCalledOnce();
  });

  it("renders even when the initialization-error callback throws", async () => {
    const fallback = provider();
    const render = vi.fn<(telemetry: TelemetryProvider) => void>();

    await bootstrapWithTelemetry({
      initTelemetry: vi
        .fn<() => Promise<TelemetryProvider>>()
        .mockRejectedValue(new Error("init failed")),
      getTelemetry: () => fallback,
      render,
      environment: "test",
      onTelemetryError: () => {
        throw new Error("callback failed");
      },
    });

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(fallback);
  });

  it("still renders when app-launch telemetry capture throws", async () => {
    const telemetry = provider(() => {
      throw new Error("capture failed");
    });
    const render = vi.fn<(telemetry: TelemetryProvider) => void>();
    const onTelemetryError =
      vi.fn<(phase: "initialize" | "capture", error: unknown) => void>();

    await bootstrapWithTelemetry({
      initTelemetry: async () => telemetry,
      getTelemetry: () => provider(),
      render,
      environment: "test",
      onTelemetryError,
    });

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(telemetry);
    expect(onTelemetryError).toHaveBeenCalledOnce();
  });

  it("propagates render failures to the fatal-render boundary", async () => {
    const renderError = new Error("render failed");

    await expect(
      bootstrapWithTelemetry({
        initTelemetry: async () => provider(),
        getTelemetry: () => provider(),
        render: () => {
          throw renderError;
        },
        environment: "test",
      }),
    ).rejects.toBe(renderError);
  });

  it("does not let telemetry reporting block the fatal-render boundary", () => {
    const telemetry = provider();
    telemetry.captureError = () => {
      throw new Error("reporting failed");
    };
    const onTelemetryError =
      vi.fn<(phase: "render-error", error: unknown) => void>();

    expect(() =>
      captureBootstrapRenderError({
        error: new Error("render failed"),
        getTelemetry: () => telemetry,
        onTelemetryError,
      }),
    ).not.toThrow();
    expect(onTelemetryError).toHaveBeenCalledOnce();
  });

  it("contains a throwing fatal-report callback", () => {
    const telemetry = provider();
    telemetry.captureError = () => {
      throw new Error("reporting failed");
    };

    expect(() =>
      captureBootstrapRenderError({
        error: new Error("render failed"),
        getTelemetry: () => telemetry,
        onTelemetryError: () => {
          throw new Error("callback failed");
        },
      }),
    ).not.toThrow();
  });
});
