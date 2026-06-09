import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTelemetryProvider: vi.fn(),
  setTelemetryProvider: vi.fn(),
  getPrefs: vi.fn(),
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
});
