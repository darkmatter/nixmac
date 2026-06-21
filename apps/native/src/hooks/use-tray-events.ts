import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useUiState } from "@nixmac/state";

export function useTrayEvents() {
  useEffect(() => {
    const unlisten = Promise.all([
      listen("tray:open-feedback", () => {
        useUiState.getState().setFeedbackOpen(true);
      }),
      listen("tray:open-settings", () => {
        useUiState.getState().setSettingsOpen(true);
      }),
    ]).catch((error) => {
      if (import.meta.env.PROD) console.error("Tray listeners unavailable:", error);
      return [];
    });

    return () => {
      unlisten
        .then((fns) => {
          for (const fn of fns) {
            fn();
          }
        })
        .catch(() => {});
    };
  }, []);
}
