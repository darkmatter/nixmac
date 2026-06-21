import { useUiState } from "@nixmac/state";
import { tauriAPI } from "@/ipc/api";
import { useEffect } from "react";

export function useRecommendedPrompt() {
  const recommendation = useUiState((s) => s.recommendedPrompt);

  const refresh = () => {
    tauriAPI.scanner
      .getRecommendedPrompt()
      .then((result) => {
        useUiState.getState().setRecommendedPrompt(result);
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
