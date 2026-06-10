import { beforeEach, describe, expect, it, vi } from "vitest";

type Prefs = {
  productAnalyticsEnabled: boolean;
  sendDiagnostics: boolean;
};

type PreferenceEvent = {
  payload: Prefs;
};

const mocks = vi.hoisted(() => ({
  createTelemetryProvider: vi.fn<() => unknown>(),
  getPrefs: vi.fn<() => Promise<Prefs>>(),
  listen: vi.fn<
    (eventName: string, handler: (event: PreferenceEvent) => void) => Promise<() => void>
  >(),
  setTelemetryProvider: vi.fn<(provider: unknown) => void>(),
}));

vi.mock("./provider", () => ({
  createTelemetryProvider: mocks.createTelemetryProvider,
}));

vi.mock("./instance", () => ({
  setTelemetryProvider: mocks.setTelemetryProvider,
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    ui: {
      getPrefs: mocks.getPrefs,
    },
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

const importInitTelemetry = async () => {
  vi.resetModules();
  return await import("./init");
};

describe("initTelemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.createTelemetryProvider.mockReturnValue({ provider: "real" });
    mocks.getPrefs.mockResolvedValue({
      productAnalyticsEnabled: true,
      sendDiagnostics: false,
    });
    mocks.listen.mockResolvedValue(vi.fn());
  });

  it("returns noop when the PostHog key is missing", async () => {
    const { initTelemetry } = await importInitTelemetry();

    const provider = await initTelemetry();

    expect(mocks.createTelemetryProvider).not.toHaveBeenCalled();
    expect(provider).toEqual(expect.objectContaining({ captureEvent: expect.any(Function) }));
  });

  it("returns noop in e2e mode", async () => {
    vi.stubEnv("VITE_NIXMAC_E2E_MODE", "true");
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const { initTelemetry } = await importInitTelemetry();

    await initTelemetry();

    expect(mocks.createTelemetryProvider).not.toHaveBeenCalled();
  });

  it("uses productAnalyticsEnabled for product capture and sendDiagnostics for diagnostics", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    mocks.getPrefs.mockResolvedValue({
      productAnalyticsEnabled: false,
      sendDiagnostics: true,
    });
    const { initTelemetry } = await importInitTelemetry();

    await initTelemetry();

    expect(mocks.createTelemetryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ key: "phc_test" }),
      {
        diagnosticsEnabled: true,
        productAnalyticsEnabled: false,
      },
    );
  });

  it("fails closed when prefs cannot be read", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    mocks.getPrefs.mockRejectedValue(new Error("prefs unavailable"));
    const { initTelemetry } = await importInitTelemetry();

    await initTelemetry();

    expect(mocks.createTelemetryProvider).toHaveBeenCalledWith(
      expect.objectContaining({ key: "phc_test" }),
      {
        diagnosticsEnabled: false,
        productAnalyticsEnabled: false,
      },
    );
  });

  it("applies imported telemetry preferences from the global preference change event", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const provider = {
      setDiagnosticsEnabled: vi.fn<(next: boolean) => void>(),
      setProductAnalyticsEnabled: vi.fn<(next: boolean) => void>(),
    };
    mocks.createTelemetryProvider.mockReturnValue(provider);
    const { initTelemetry } = await importInitTelemetry();

    await initTelemetry();

    expect(mocks.listen).toHaveBeenCalledWith(
      "global_preferences_changed",
      expect.any(Function),
    );

    const listener = mocks.listen.mock.calls[0]?.[1];
    listener({
      payload: {
        productAnalyticsEnabled: false,
        sendDiagnostics: true,
      },
    });

    expect(provider.setDiagnosticsEnabled).toHaveBeenCalledWith(true);
    expect(provider.setProductAnalyticsEnabled).toHaveBeenCalledWith(false);
  });
});
