import { tauriAPI } from "@/ipc/api";
import type { PermissionsState } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { bindBackendSlice } from "./_helpers";

export function mirrorPermissions(permissions: PermissionsState | null): void {
  useViewModel.setState({ permissions, permissionsHydrated: true });
}

export function startPermissionsSync(): Promise<() => void> {
  return bindBackendSlice<PermissionsState | null>({
    hydrate: () => tauriAPI.permissions.get(),
    event: "permissions_changed",
    mirror: mirrorPermissions,
  });
}
