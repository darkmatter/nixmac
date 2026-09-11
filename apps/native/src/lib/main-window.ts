import { client } from "@/lib/orpc";

let popoverModePromise: Promise<boolean> | undefined;

/** Cache the immutable launch mode, but let a failed transport request retry. */
export function isMainWindowPopover(): Promise<boolean> {
  popoverModePromise ??= client.mainWindow.isPopover().catch((error) => {
    popoverModePromise = undefined;
    throw error;
  });
  return popoverModePromise;
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
