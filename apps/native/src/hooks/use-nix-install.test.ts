import { useWidgetStore } from "@/stores/widget-store";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNixInstall } from "./use-nix-install";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  installStart: vi.fn<() => Promise<void>>(),
  on: vi.fn<
    (
      eventName: string,
      handler: (event: { payload: Record<string, unknown> }) => void,
    ) => Promise<() => void>
  >(),
  prefetchDarwinRebuild: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("@/ipc/api", () => ({
  ipcRenderer: {
    on: mocks.on,
  },
  tauriAPI: {
    nix: {
      check: vi.fn<() => Promise<unknown>>(),
      installStart: mocks.installStart,
      prefetchDarwinRebuild: mocks.prefetchDarwinRebuild,
    },
  },
}));

describe("useNixInstall telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.installStart.mockResolvedValue(undefined);
    mocks.prefetchDarwinRebuild.mockResolvedValue(undefined);
    mocks.on.mockResolvedValue(vi.fn());

    const store = useWidgetStore.getState();
    store.setNixInstalled(false);
    store.setDarwinRebuildAvailable(null);
    store.setNixInstalling(false);
    store.setNixInstallPhase(null);
    store.setNixDownloadProgress(null);
    store.setError(null);
  });

  it("emits nix setup start and completion without error text", async () => {
    const endHandlers: Array<(event: { payload: { ok: boolean } }) => void> =
      [];
    mocks.on.mockImplementation(async (eventName, handler) => {
      if (eventName === "nix:install:end") {
        endHandlers.push(handler);
      }
      return vi.fn<() => void>();
    });

    await useNixInstall().installNix();
    endHandlers[0]?.({ payload: { ok: true } });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_started",
      props: { target: "nix", trigger: "user" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_completed",
      props: { target: "nix" },
    });
  });

  it("emits nix setup failure as an enum event only", async () => {
    const endHandlers: Array<
      (event: { payload: { error: string; ok: boolean } }) => void
    > = [];
    mocks.on.mockImplementation(async (eventName, handler) => {
      if (eventName === "nix:install:end") {
        endHandlers.push(handler);
      }
      return vi.fn<() => void>();
    });

    await useNixInstall().installNix();
    endHandlers[0]?.({
      payload: { error: "token sk-test /Users/me/.darwin", ok: false },
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_failed",
      props: { target: "nix" },
    });
    expect(mocks.captureEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ error: expect.any(String) }),
      }),
    );
  });

  it("attributes darwin-rebuild phase failures to nix-darwin setup", async () => {
    const progressHandlers: Array<
      (event: { payload: { phase: "prefetching" } }) => void
    > = [];
    const endHandlers: Array<
      (event: {
        payload: { error_type: "darwin_rebuild"; ok: boolean };
      }) => void
    > = [];
    mocks.on.mockImplementation(async (eventName, handler) => {
      if (eventName === "nix:install:progress") {
        progressHandlers.push(handler);
      }
      if (eventName === "nix:install:end") {
        endHandlers.push(handler);
      }
      return vi.fn<() => void>();
    });

    await useNixInstall().installNix();
    progressHandlers[0]?.({ payload: { phase: "prefetching" } });
    endHandlers[0]?.({
      payload: { error_type: "darwin_rebuild", ok: false },
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_failed",
      props: { target: "nix_darwin" },
    });
  });

  it("tracks automatic nix-darwin setup separately from Nix installation", async () => {
    const endHandlers: Array<(event: { payload: { ok: boolean } }) => void> =
      [];
    mocks.on.mockImplementation(async (eventName, handler) => {
      if (eventName === "nix:darwin-rebuild:end") {
        endHandlers.push(handler);
      }
      return vi.fn<() => void>();
    });

    await useNixInstall().prefetchDarwinRebuild();
    endHandlers[0]?.({ payload: { ok: true } });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_started",
      props: { target: "nix_darwin", trigger: "automatic" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_completed",
      props: { target: "nix_darwin" },
    });
  });

  it("labels auto-triggered nix-darwin installStart flows as automatic", async () => {
    const store = useWidgetStore.getState();
    store.setNixInstalled(true);
    store.setDarwinRebuildAvailable(false);

    await useNixInstall().installNix("automatic");

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "nix_setup_started",
      props: { target: "nix_darwin", trigger: "automatic" },
    });
  });
});
