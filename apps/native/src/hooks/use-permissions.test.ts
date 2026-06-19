import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn();

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    permissions: {
      refresh: (...args: unknown[]) => mockRefresh(...args),
    },
  },
}));

vi.mock("tauri-plugin-macos-permissions-api", () => ({
  checkFullDiskAccessPermission: vi.fn(),
  requestFullDiskAccessPermission: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The FDA merge/fallback logic moved into the Rust `refresh_permissions`
// probe; the hook only triggers it. The probed state reaches the ViewModel
// through the `permissions_changed` event (see viewmodel/viewmodel.test.ts).
describe("usePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checkPermissions triggers the backend probe", async () => {
    mockRefresh.mockResolvedValue(undefined);

    const { usePermissions } = await import("./use-permissions");
    const { result } = renderHook(() => usePermissions());

    await act(async () => {
      await result.current.checkPermissions();
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("checkPermissions propagates probe failures", async () => {
    mockRefresh.mockRejectedValue(new Error("probe failed"));

    const { usePermissions } = await import("./use-permissions");
    const { result } = renderHook(() => usePermissions());

    await expect(result.current.checkPermissions()).rejects.toThrow("probe failed");
  });
});
