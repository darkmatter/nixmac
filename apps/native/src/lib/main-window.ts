import { client } from "@/lib/orpc";

let popoverModePromise: Promise<boolean> | undefined;

/** The main-window mode is immutable for the lifetime of the process. */
export function isMainWindowPopover(): Promise<boolean> {
  popoverModePromise ??= client.mainWindow.isPopover();
  return popoverModePromise;
}

export function dismissMainWindowPopover(): Promise<boolean> {
  return client.mainWindow.dismissPopover();
}

export function acknowledgeMainWindowClose(token: number): Promise<boolean> {
  return client.mainWindow.acknowledgeClose({ token });
}
