import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { useCallback, useEffect } from "react";

export function useRecommendedPrompt() {
  const recommendation = useWidgetStore((s) => s.recommendedPrompt);

  const refresh = useCallback(() => {
    darwinAPI.scanner
      .getRecommendedPrompt()
      .then((result) => {
        useWidgetStore.getState().setRecommendedPrompt(result);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (recommendation === null) {
      refresh();
    }
  }, [recommendation, refresh]);

  return { recommendation, refresh };
}
