import { afterEach, describe, expect, it, vi } from "vitest";
import type { TelemetryProvider } from "./types";

const makeProvider = (enabled: boolean): TelemetryProvider => ({
  enabled,
  captureEvent() {},
  captureError() {},
  setEnabled() {},
  getFeatureFlag() {
    return undefined;
  },
  onFeatureFlags() {
    return () => {};
  },
  reset() {},
});

async function loadInitTelemetry({
  e2e = false,
  key = "posthog-key",
  prefs = { sendDiagnostics: false } as { sendDiagnostics?: boolean } | Error,
} = {}) {
  const noopProvider = makeProvider(false);
  const provider = makeProvider(true);
  const getPrefs = vi.fn<() => Promise<{ sendDiagnostics?: boolean }>>();
  if (prefs instanceof Error) {
    getPrefs.mockRejectedValue(prefs);
  } else {
    getPrefs.mockResolvedValue(prefs);
  }
  const createTelemetryProvider = vi.fn<
    (config: unknown, sendDiagnostics: boolean) => TelemetryProvider
  >(() => provider);
  const setTelemetryProvider = vi.fn<(provider: TelemetryProvider) => void>();

  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    isE2eProfile: e2e,
    nixmacEnvironment: "test",
    nixmacVersion: "1.2.3",
    settings: {
      posthogKey: key,
      posthogHost: "https://telemetry.example",
    },
  }));
  vi.doMock("@/ipc/api", () => ({
    tauriAPI: {
      ui: { getPrefs },
    },
  }));
  vi.doMock("@/lib/telemetry/provider", () => ({ createTelemetryProvider }));
  vi.doMock("@/lib/telemetry/instance", () => ({ setTelemetryProvider }));
  vi.doMock("@/lib/telemetry/noop", () => ({ noopProvider }));

  const { initTelemetry } = await import("./init");
  return {
    createTelemetryProvider,
    getPrefs,
    initTelemetry,
    noopProvider,
    provider,
    setTelemetryProvider,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/env");
  vi.doUnmock("@/ipc/api");
  vi.doUnmock("@/lib/telemetry/provider");
  vi.doUnmock("@/lib/telemetry/instance");
  vi.doUnmock("@/lib/telemetry/noop");
});

describe("initTelemetry", () => {
  it("returns noop without prefs, provider work, or installation in the E2E profile", async () => {
    const subject = await loadInitTelemetry({ e2e: true });

    await expect(subject.initTelemetry()).resolves.toBe(subject.noopProvider);
    expect(subject.setTelemetryProvider).not.toHaveBeenCalled();
    expect(subject.getPrefs).not.toHaveBeenCalled();
    expect(subject.createTelemetryProvider).not.toHaveBeenCalled();
  });

  it("returns noop without prefs, provider work, or installation when the key is missing", async () => {
    const subject = await loadInitTelemetry({ key: "   " });

    await expect(subject.initTelemetry()).resolves.toBe(subject.noopProvider);
    expect(subject.setTelemetryProvider).not.toHaveBeenCalled();
    expect(subject.getPrefs).not.toHaveBeenCalled();
    expect(subject.createTelemetryProvider).not.toHaveBeenCalled();
  });

  it("fails closed and returns one uninstalled provider when prefs cannot be read", async () => {
    const subject = await loadInitTelemetry({
      prefs: new Error("prefs unavailable"),
    });

    await expect(subject.initTelemetry()).resolves.toBe(subject.provider);
    expect(subject.getPrefs).toHaveBeenCalledOnce();
    expect(subject.createTelemetryProvider).toHaveBeenCalledOnce();
    expect(subject.createTelemetryProvider).toHaveBeenCalledWith(
      {
        key: "posthog-key",
        host: "https://telemetry.example",
        release: "1.2.3",
        environment: "test",
      },
      false,
    );
    expect(subject.setTelemetryProvider).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "passes the explicit sendDiagnostics=%s preference",
    async (enabled) => {
      const subject = await loadInitTelemetry({
        prefs: { sendDiagnostics: enabled },
      });

      await expect(subject.initTelemetry()).resolves.toBe(subject.provider);
      expect(subject.createTelemetryProvider).toHaveBeenCalledOnce();
      expect(subject.createTelemetryProvider).toHaveBeenLastCalledWith(
        expect.any(Object),
        enabled,
      );
      expect(subject.setTelemetryProvider).not.toHaveBeenCalled();
    },
  );
});
