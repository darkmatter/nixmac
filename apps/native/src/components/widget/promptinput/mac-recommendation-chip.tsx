"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { useRecommendedPrompt } from "@/hooks/use-recommended-prompt";
import { useUiState } from "@nixmac/state";

export function MacRecommendationChip() {
  const { recommendation } = useRecommendedPrompt();
  const setEvolvePrompt = useUiState((s) => s.setEvolvePrompt);

  if (!recommendation) return null;

  return (
    <BadgeButton onClick={() => setEvolvePrompt(recommendation.promptText)}>
      {recommendation.promptText}
    </BadgeButton>
  );
}
