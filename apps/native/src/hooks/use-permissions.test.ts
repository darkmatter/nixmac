import type { PermissionsState } from "@/tauri-api";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const makeBackendState = (fdaStatus: string): PermissionsState => ({
  allRequiredGranted: false,
  checkedAt: null,
  permissions: [
    {
      id: "desktop",
      name: "Desktop Folder Access",
      description: "desc",
      required: true,
      canRequestProgrammatically: true,
      status: "granted",
    },
    {
      id: "full-disk",
      name: "Full Disk Access",
      description: "desc",
      required: true,
      canRequestProgrammatically: false,
      status: fdaStatus as "granted" | "denied" | "pending" | "unknown",
    },
  ],
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCheckAll = vi.fn();
const mockCheckFullDiskAccess = vi.fn();
const mockSetPermissionsState = vi.fn();
const mockSetPermissionsChecked = vi.fn();

vi.mock("@/tauri-api", () => ({
  darwinAPI: {
    permissions: {
      checkAll: (...args: unknown[]) => mockCheckAll(...args),
      checkFullDiskAccess: (...args: unknown[]) => mockCheckFullDiskAccess(...args),
    },
  },
}));

vi.mock("tauri-plugin-macos-permissions-api", () => ({
  checkFullDiskAccessPermission: vi.fn(),
  requestFullDiskAccessPermission: vi.fn(),
}));

vi.mock("@/stores/widget-store", () => ({
  useWidgetStore: {
    getState: () => ({
      setPermissionsState: mockSetPermissionsState,
      setPermissionsChecked: mockSetPermissionsChecked,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePermissions – FDA merge/fallback logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses 'granted' when the plugin returns true", async () => {
    mockCheckAll.mockResolvedValue(makeBackendState("denied"));
    mockCheckFullDiskAccess.mockResolvedValue(true);

    const { usePermissions } = await import("./use-permissions");
    const { result } = renderHook(() => usePermissions());

    let state: PermissionsState | null = null;
    await act(async () => {
      state = await result.current.checkPermissions();
    });

    const fda = state!.permissions.find((p) => p.id === "full-disk")!;
    expect(fda.status).toBe("granted");
    expect(state!.allRequiredGranted).toBe(true);
  });

  it("uses 'denied' when the plugin returns false", async () => {
    mockCheckAll.mockResolvedValue(makeBackendState("granted"));
    mockCheckFullDiskAccess.mockResolvedValue(false);

    const { usePermissions } = await import("./use-permissions");
    const { result } = renderHook(() => usePermissions());

    let state: PermissionsState | null = null;
    await act(async () => {
      state = await result.current.checkPermissions();
    });

    const fda = state!.permissions.find((p) => p.id === "full-disk")!;
    expect(fda.status).toBe("denied");
  });

  it("falls back to the backend result when the plugin throws", async () => {
    // Backend says FDA is granted; plugin throws.
    mockCheckAll.mockResolvedValue(makeBackendState("granted"));
    mockCheckFullDiskAccess.mockRejectedValue(new Error("plugin unavailable"));

    const { usePermissions } = await import("./use-permissions");
    const { result } = renderHook(() => usePermissions());

    let state: PermissionsState | null = null;
    await act(async () => {
      state = await result.current.checkPermissions();
    });

    const fda = state!.permissions.find((p) => p.id === "full-disk")!;
    // Must NOT be forced to "denied" — should reflect the backend's "granted".
    expect(fda.status).toBe("granted");
    expect(state!.allRequiredGranted).toBe(true);
  });

  it("preserves 'denied' from backend when the plugin throws and backend says denied", async () => {
    mockCheckAll.mockResolvedValue(makeBackendState("denied"));
    mockCheckFullDiskAccess.mockRejectedValue(new Error("plugin unavailable"));

    const { usePermissions } = await import("./use-permissions");
    const { result } = renderHook(() => usePermissions());

    let state: PermissionsState | null = null;
    await act(async () => {
      state = await result.current.checkPermissions();
    });

    const fda = state!.permissions.find((p) => p.id === "full-disk")!;
    expect(fda.status).toBe("denied");
  });
});
