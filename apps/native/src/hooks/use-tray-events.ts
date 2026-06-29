import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { uiActions } from "@nixmac/state";
import { nav } from "@/router";

export function useTrayEvents() {
  useEffect(() => {
    const unlisten = Promise.all([
      listen("tray:open-feedback", () => {
        uiActions.setFeedbackOpen(true);
      }),
      listen("tray:open-settings", () => {
        nav.openSettings();
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
