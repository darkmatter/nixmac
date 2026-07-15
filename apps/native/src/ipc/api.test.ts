import type { UiPrefs } from "@/ipc/types";
import { providerModelDefaults } from "@/lib/providers/ai-defaults";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OPENROUTER_DEFAULTS = providerModelDefaults("openrouter");

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  listen: vi.fn<(...args: unknown[]) => Promise<() => void>>(),
  once: vi.fn<(...args: unknown[]) => Promise<() => void>>(),
  checkFullDiskAccessPermission: vi.fn<() => Promise<boolean>>(),
  requestFullDiskAccessPermission: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
  once: mocks.once,
}));

vi.mock("tauri-plugin-macos-permissions-api", () => ({
  checkFullDiskAccessPermission: mocks.checkFullDiskAccessPermission,
  requestFullDiskAccessPermission: mocks.requestFullDiskAccessPermission,
}));

const prefs = (overrides: Partial<UiPrefs> = {}): UiPrefs =>
  ({
    openrouterApiKey: "openrouter-secret",
    openaiApiKey: "openai-secret",
    ollamaApiBaseUrl: null,
    openaiCompatibleApiBaseUrl: null,
    openaiCompatibleApiKey: null,
    summaryProvider: "openrouter",
    summaryModels: { openrouter: OPENROUTER_DEFAULTS.summaryModel },
    evolveProvider: "openrouter",
    evolveModels: { openrouter: OPENROUTER_DEFAULTS.evolveModel },
    maxIterations: 25,
    maxTokenBudget: 50000,
    maxOutputTokens: 32768,
    maxBuildAttempts: 5,
    sendDiagnostics: false,
    confirmBuild: true,
    confirmClear: true,
    confirmRollback: true,
    autoSummarizeOnFocus: false,
    scanHomebrewOnStartup: true,
    defaultToDiffTab: false,
    experimentalSpinningMascot: false,
    developerMode: false,
    pinnedVersion: null,
    updateChannel: "stable",
    featureFlagOverrides: null,
    ...overrides,
  }) as UiPrefs;

describe("tauriAPI.ui.getPrefs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("coalesces concurrent preference reads into one backend command", async () => {
    const loaded = prefs();
    mocks.invoke.mockResolvedValueOnce(loaded);
    const { tauriAPI } = await import("./api");

    const [first, second] = await Promise.all([tauriAPI.ui.getPrefs(), tauriAPI.ui.getPrefs()]);

    expect(first).toBe(loaded);
    expect(second).toBe(loaded);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("ui_get_prefs");
  });

  it("migrates legacy OpenAI provider prefs before caching", async () => {
    const loaded = prefs({
      openrouterApiKey: "openrouter-secret",
      openaiApiKey: "",
      evolveProvider: "openai",
      evolveModels: { openai: "gpt-4o" },
      summaryProvider: "openai",
      summaryModels: { openai: "gpt-4o-mini" },
    });
    const reloaded = prefs({
      openrouterApiKey: "openrouter-secret",
      openaiApiKey: "",
      evolveModels: {},
      summaryModels: {},
    });
    mocks.invoke
      .mockResolvedValueOnce(loaded)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(reloaded);
    const { tauriAPI } = await import("./api");

    const migrated = await tauriAPI.ui.getPrefs();

    expect(migrated).toBe(reloaded);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "ui_get_prefs");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "ui_set_prefs", {
      prefs: {
        evolveProvider: "openrouter",
        summaryProvider: "openrouter",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "ui_get_prefs");
  });

  it("does not cache defaults for unrelated provider prefs during migration", async () => {
    const loaded = prefs({
      openrouterApiKey: "openrouter-secret",
      openaiApiKey: "",
      evolveProvider: "openai",
      evolveModels: { openai: "gpt-4o" },
      summaryProvider: "ollama",
      summaryModels: {},
    });
    const reloaded = prefs({
      openrouterApiKey: "openrouter-secret",
      openaiApiKey: "",
      evolveModels: {},
      summaryProvider: "ollama",
      summaryModels: {},
    });
    mocks.invoke
      .mockResolvedValueOnce(loaded)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(reloaded);
    const { tauriAPI } = await import("./api");

    const migrated = await tauriAPI.ui.getPrefs();

    expect(migrated).toBe(reloaded);
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "ui_set_prefs", {
      prefs: {
        evolveProvider: "openrouter",
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "ui_get_prefs");
  });

  it("reuses loaded preferences until a write invalidates the cache", async () => {
    const initial = prefs();
    const afterWrite = prefs({ developerMode: true });
    mocks.invoke
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(afterWrite);
    const { tauriAPI } = await import("./api");

    await expect(tauriAPI.ui.getPrefs()).resolves.toBe(initial);
    await expect(tauriAPI.ui.getPrefs()).resolves.toBe(initial);
    await expect(tauriAPI.ui.setPrefs({ developerMode: true })).resolves.toEqual({ ok: true });
    await expect(tauriAPI.ui.getPrefs()).resolves.toBe(afterWrite);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "ui_get_prefs");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "ui_set_prefs", {
      prefs: { developerMode: true },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "ui_get_prefs");
  });
});
