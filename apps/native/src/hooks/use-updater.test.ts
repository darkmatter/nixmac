import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UpdateInfo } from "@/ipc/types";
import { useUpdater } from "./use-updater";

const { checkUpdate, installUpdate, captureEvent } = vi.hoisted(() => ({
  checkUpdate: vi.fn<() => Promise<UpdateInfo | null>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
  captureEvent: vi.fn<(event: unknown) => void>(),
}));
vi.mock("@/ipc/api", () => ({ tauriAPI: {
  updater: { checkUpdate, installUpdate, relaunch: vi.fn<() => Promise<void>>() },
  ui: { getPrefs: vi.fn<() => Promise<null>>().mockResolvedValue(null) },
} }));
vi.mock("@nixmac/state", () => ({ useViewModel: (select: (state: { preferences: null }) => unknown) => select({ preferences: null }) }));
vi.mock("@/lib/telemetry/instance", () => ({ getTelemetry: () => ({ captureEvent }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each([
  "error sending request for url https://private.example/manifest",
  "server returned 503 for https://private.example/manifest",
  "invalid JSON manifest from https://private.example/manifest",
])("keeps an automatic check rejection out of the banner: %s", async (message) => {
  const error = new Error(message);
  checkUpdate.mockRejectedValue(error);
  const { result } = renderHook(() => useUpdater());
  await waitFor(() => expect(captureEvent).toHaveBeenCalledWith({ name: "update_check_failed", props: { reason: "check_failed" } }));
  expect(result.current.checking).toBe(false);
  expect(result.current.error).toBeNull();
  expect(result.current.errorSource).toBeNull();
  expect(console.warn).toHaveBeenCalledWith("[updater] check failed:", error);
  expect(JSON.stringify(captureEvent.mock.calls)).not.toContain("private.example");
});

it("retains the banner error for an install rejection in release mode", async () => {
  checkUpdate.mockResolvedValue({ version: "1.2.3", notes: null } as UpdateInfo);
  installUpdate.mockRejectedValue(new Error("installation failed"));
  const { result } = renderHook(() => useUpdater());
  await waitFor(() => expect(result.current.available?.version).toBe("1.2.3"));
  await act(() => result.current.installUpdate());
  expect(installUpdate).toHaveBeenCalledOnce();
  expect(result.current.error).toBe("installation failed");
  expect(result.current.errorSource).toBe("install");
  expect(captureEvent).toHaveBeenCalledWith({ name: "update_install_failed", props: { version: "1.2.3" } });
});
