import { useFeedbackStore } from "@/stores/feedback-store";
import { useUiStore } from "@/stores/ui-store";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

export function useTrayEvents() {
  useEffect(() => {
    const unlisten = Promise.all([
      listen("tray:open-feedback", () => {
        useFeedbackStore.getState().setFeedbackOpen(true);
      }),
      listen("tray:open-settings", () => {
        useUiStore.getState().setSettingsOpen(true);
      }),
    ]).catch((error) => {
      if (import.meta.env.PROD)
        console.error("Tray listeners unavailable:", error);
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
