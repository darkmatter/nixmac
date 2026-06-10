import type { SetDirResult } from "@/ipc/types";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { useWidgetStore } from "@/stores/widget-store";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDarwinConfig } from "./use-darwin-config";

const mocks = vi.hoisted(() => ({
  bootstrapDefault: vi.fn<(hostname: string) => Promise<void>>(),
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  importGithub: vi.fn<
    (repoRef: string, dirName?: string) => Promise<SetDirResult>
  >(),
  setDir: vi.fn<
    (
      dir: string,
      options?: { telemetrySurface?: "onboarding" | "settings" },
    ) => Promise<SetDirResult>
  >(),
  setHostAttr: vi.fn<(host: string) => Promise<void>>(),
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    config: {
      importGithub: mocks.importGithub,
      setDir: mocks.setDir,
      setHostAttr: mocks.setHostAttr,
    },
    flake: {
      bootstrapDefault: mocks.bootstrapDefault,
      listHosts: vi.fn<() => Promise<string[]>>().mockResolvedValue(["mbp"]),
    },
  },
}));

const setDirResult = {
  dir: "/Users/me/.darwin",
  evolveState: {
    backupBranch: null,
    committable: false,
    currentChangesetId: null,
    evolutionId: null,
    rollbackBranch: null,
    rollbackChangesetId: null,
    rollbackStorePath: null,
    step: "begin",
  },
  hosts: ["mbp"],
} satisfies SetDirResult;

describe("useDarwinConfig telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bootstrapDefault.mockResolvedValue(undefined);
    mocks.importGithub.mockResolvedValue(setDirResult);
    mocks.setDir.mockResolvedValue(setDirResult);
    mocks.setHostAttr.mockResolvedValue(undefined);

    const store = useWidgetStore.getState();
    store.setConfigDir("");
    store.setHosts([]);
    store.setHost("");
    store.setError(null);
    store.setBootstrapping(false);
  });

  it("emits safe onboarding events when configuration directory and host setup succeeds", async () => {
    const { result } = renderHook(() => useDarwinConfig());

    await result.current.setDir("/Users/me/.darwin", {
      telemetrySurface: "onboarding",
    });
    await result.current.saveHost("mbp", { telemetrySurface: "onboarding" });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "onboarding_step_completed",
      props: { source: "manual", step: "config_directory" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "onboarding_step_completed",
      props: { step: "host_configuration" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "onboarding_completed",
      props: { step: "host_configuration" },
    });
  });

  it("does not emit host onboarding completion when saving the host fails", async () => {
    mocks.setHostAttr.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useDarwinConfig());

    await result.current.saveHost("mbp");

    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "onboarding_completed",
      props: { step: "host_configuration" },
    });
  });

  it("emits source-specific setup completion for imported repositories", async () => {
    const { result } = renderHook(() => useDarwinConfig());

    await result.current.importGithub("darkmatter/nixmac-config", undefined, {
      telemetrySurface: "onboarding",
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "onboarding_step_completed",
      props: { source: "github_import", step: "config_directory" },
    });
  });

  it("does not double-count config-directory completion during onboarding bootstrap", async () => {
    const { result } = renderHook(() => useDarwinConfig());

    await result.current.setDir("/Users/me/.darwin", {
      telemetrySurface: "onboarding",
    });
    mocks.captureEvent.mockClear();

    await result.current.bootstrap("macbook", {
      telemetrySurface: "onboarding",
    });

    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "onboarding_step_completed",
      props: { source: "bootstrap", step: "config_directory" },
    });
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });

  it("does not emit onboarding completion for Settings-surface changes", async () => {
    const { result } = renderHook(() => useDarwinConfig());

    await result.current.setDir("/Users/me/.darwin", {
      telemetrySurface: "settings",
    });
    await result.current.saveHost("mbp", { telemetrySurface: "settings" });

    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });
});
