import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import type { PermissionStatus, PermissionsState } from "@/tauri-api";
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

      // Determine FDA status: prefer the macOS plugin result, fall back to the
      // Rust backend result if the plugin throws (e.g. when running in a test
      // harness or when the plugin is unavailable).
      const backendFdaPermission = rustPermissions.permissions.find((p) => p.id === "full-disk");
      const backendFdaStatus: PermissionStatus = backendFdaPermission?.status ?? "unknown";

      // Default to the backend result so that a plugin failure never forces
      // "denied" when the backend already knows the correct status.
      let fdaStatus: PermissionStatus = backendFdaStatus;
      try {
        const fdaGranted = await darwinAPI.permissions.checkFullDiskAccess();
        fdaStatus = fdaGranted ? "granted" : "denied";
        console.log("[permissions] Plugin FDA check succeeded:", fdaStatus);
      } catch (e) {
        console.warn(
          "[permissions] Plugin FDA check failed – falling back to backend result:",
          backendFdaStatus,
          e,
        );
      }

      const updatedPermissions = rustPermissions.permissions.map((p) =>
        p.id === "full-disk" ? { ...p, status: fdaStatus } : p,
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
