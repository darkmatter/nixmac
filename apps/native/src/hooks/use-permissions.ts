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

      // Determine FDA status by OR-ing the plugin and backend results: if
      // either source reports granted, the grant is real. The plugin's probe
      // set is narrow (Safari + stocks container only), and the backend
      // probes a wider set, so a single source can be wrong in either
      // direction.
      const backendFdaPermission = rustPermissions.permissions.find((p) => p.id === "full-disk");
      const backendFdaStatus: PermissionStatus = backendFdaPermission?.status ?? "unknown";

      let fdaStatus: PermissionStatus = backendFdaStatus;
      try {
        const pluginGranted = await darwinAPI.permissions.checkFullDiskAccess();
        if (pluginGranted || backendFdaStatus === "granted") {
          fdaStatus = "granted";
        } else if (backendFdaStatus === "pending" || backendFdaStatus === "unknown") {
          fdaStatus = "denied";
        } else {
          fdaStatus = backendFdaStatus;
        }
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
