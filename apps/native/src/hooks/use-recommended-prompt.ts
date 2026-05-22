import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/tauri-api";
import { useEffect } from "react";

export function useRecommendedPrompt() {
  const recommendation = useWidgetStore((s) => s.recommendedPrompt);

  const refresh = () => {
    tauriAPI.scanner
      .getRecommendedPrompt()
      .then((result) => {
        useWidgetStore.getState().setRecommendedPrompt(result);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (recommendation === undefined) {
      refresh();
    }
  }, [recommendation]);

  return { recommendation, refresh };
}
