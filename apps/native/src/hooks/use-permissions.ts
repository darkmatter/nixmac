import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import type { PermissionsState } from "@/tauri-api";
import { useCallback } from "react";

/**
 * Hook for checking and managing macOS permissions.
 *
 * Check all permissions and update the store.
 * Always marks permissions as checked, even on failure.
 */

export function usePermissions() {
  const checkPermissions = useCallback(async (): Promise<PermissionsState | null> => {
    const store = useWidgetStore.getState();

    try {
      const rustPermissions = await darwinAPI.permissions.checkAll();

      let fdaGranted = false;
      try {
        fdaGranted = await darwinAPI.permissions.checkFullDiskAccess();
      } catch (e) {
        // Plugin check failed, fall back to backend result
      }

      const fdaStatus = fdaGranted ? "granted" : "denied";
      const updatedPermissions = rustPermissions.permissions.map((p) =>
        p.id === "full-disk"
          ? { ...p, status: fdaStatus as "granted" | "denied" }
          : p,
      );

      const allRequiredGranted = updatedPermissions
        .filter((p) => p.required)
        .every((p) => p.status === "granted");

      const combinedState: PermissionsState = {
        ...rustPermissions,
        permissions: updatedPermissions,
        allRequiredGranted,
      };

      store.setPermissionsState(combinedState);
      return combinedState;
    } finally {
      // set permission checked flag even on error
      store.setPermissionsChecked(true);
    }
  }, []);

  return {
    checkPermissions,
  };
}
