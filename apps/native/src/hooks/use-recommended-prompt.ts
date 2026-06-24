import { uiActions, useUiState } from "@nixmac/state";
import { tauriAPI } from "@/ipc/api";
import { useEffect } from "react";

export function useRecommendedPrompt() {
  const recommendation = useUiState((s) => s.recommendedPrompt);

  const refresh = () => {
    tauriAPI.scanner
      .getRecommendedPrompt()
      .then((result) => {
        uiActions.setRecommendedPrompt(result);
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
