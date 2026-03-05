import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useWidgetStore } from "@/stores/widget-store";

export function useTrayEvents() {
  useEffect(() => {
    const unlisten = Promise.all([
      listen("tray:open-feedback", () => {
        useWidgetStore.getState().setFeedbackOpen(true);
      }),
      listen("tray:open-settings", () => {
        useWidgetStore.getState().setSettingsOpen(true);
      }),
    ]);

    return () => {
      unlisten.then((fns) => {
        for (const fn of fns) {
          fn();
        }
      });
    };
  }, []);
}
