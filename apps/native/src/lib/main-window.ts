import { client, orpc, queryClient } from "@/lib/orpc";

/**
 * The main-window mode is chosen once at launch, so a successful answer is
 * kept in the shared query cache for the life of the process. A failed
 * request leaves no data behind, so the next caller asks again. Not persisted:
 * a restart can change the mode, and only `meta.persist` queries reach disk.
 */
function mainWindowModeQueryOptions() {
  return orpc.mainWindow.isPopover.queryOptions({
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function isMainWindowPopover(): Promise<boolean> {
  return queryClient.fetchQuery(mainWindowModeQueryOptions());
}

export function dismissMainWindowPopover(): Promise<boolean> {
  return client.mainWindow.dismissPopover();
}

export function dismissMainWindowClose(token: number): Promise<boolean> {
  return client.mainWindow.dismissClose({ token });
}

export function acknowledgeMainWindowClose(token: number): Promise<boolean> {
  return client.mainWindow.acknowledgeClose({ token });
}
