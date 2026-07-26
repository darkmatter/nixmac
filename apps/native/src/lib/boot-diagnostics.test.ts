import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markNativeBootStage = vi.fn<(...args: unknown[]) => Promise<void>>();
const logBreadcrumb = vi.fn<(...args: unknown[]) => Promise<void>>();

async function loadBootDiagnostics() {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({ isE2eProfile: true }));
  vi.doMock("@/ipc/api", () => ({
    tauriAPI: {
      debug: {
        markBootStage: markNativeBootStage,
        logBreadcrumb,
      },
    },
  }));
  return import("./boot-diagnostics");
}

describe("boot diagnostics side-effect boundaries", () => {
  beforeEach(() => {
    markNativeBootStage.mockReset().mockResolvedValue(undefined);
    logBreadcrumb.mockReset().mockResolvedValue(undefined);
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-nixmac-boot-stage");
    document.title = "before";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/env");
    vi.doUnmock("@/ipc/api");
  });

  it("keeps render-stage marking limited to the DOM and title", async () => {
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    const { markBootRenderStage } = await loadBootDiagnostics();

    markBootRenderStage("react render / start");

    expect(document.documentElement.dataset.nixmacBootStage).toBe(
      "react-render---start",
    );
    expect(document.title).toBe("nixmac boot:react-render---start");
    expect(storageSet).not.toHaveBeenCalled();
    expect(markNativeBootStage).not.toHaveBeenCalled();
    expect(logBreadcrumb).not.toHaveBeenCalled();
  });

  it("persists and mirrors effect-safe stage marking", async () => {
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { markBootStage } = await loadBootDiagnostics();

    markBootStage("app effect");

    expect(document.documentElement.dataset.nixmacBootStage).toBe("app-effect");
    expect(document.title).toBe("nixmac boot:app-effect");
    expect(storageSet).toHaveBeenCalledWith(
      "nixmac:e2e-boot-stage",
      "app-effect",
    );
    expect(markNativeBootStage).toHaveBeenCalledTimes(1);
    expect(markNativeBootStage).toHaveBeenCalledWith(
      "app-effect",
      expect.any(Number),
    );
    expect(logBreadcrumb).not.toHaveBeenCalled();
  });
});
