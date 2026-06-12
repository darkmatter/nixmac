import { tauriAPI } from "@/ipc/api";

/**
 * Hook for checking macOS permissions.
 *
 * `checkPermissions` asks the backend to probe all permissions; the result
 * arrives via the `permissions_changed` event and is mirrored into the
 * ViewModel by the permissions sync module.
 */
const checkPermissions = async (): Promise<void> => {
  await tauriAPI.permissions.refresh();
};

export function usePermissions() {
  return { checkPermissions };
}
