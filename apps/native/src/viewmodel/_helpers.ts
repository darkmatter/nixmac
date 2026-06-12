import { ipcRenderer } from "@/ipc/api";

/**
 * Bind one backend-owned slice to the ViewModel: hydrate the current value
 * through a command, mirror it, then keep mirroring the payloads the backend
 * pushes on `event`. Returns the unlisten function.
 *
 * `onEvent` runs after `mirror` for pushed events only (not for hydration);
 * slices that need more than that stack their own listener next to the
 * helper call.
 */
export async function bindBackendSlice<T>({
  hydrate,
  event,
  mirror,
  onEvent,
}: {
  hydrate: () => Promise<T>;
  event: string;
  mirror: (payload: T) => void;
  onEvent?: (payload: T) => void;
}): Promise<() => void> {
  mirror(await hydrate());
  return ipcRenderer.on<T>(event, (e) => {
    mirror(e.payload);
    onEvent?.(e.payload);
  });
}
