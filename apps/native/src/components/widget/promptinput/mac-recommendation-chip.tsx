"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { useRecommendedPrompt } from "@/hooks/use-recommended-prompt";
import { uiActions } from "@nixmac/state";

export function MacRecommendationChip() {
  const { recommendation } = useRecommendedPrompt();

  if (!recommendation) return null;

  return (
    <BadgeButton onClick={() => uiActions.setEvolvePrompt(recommendation.promptText)}>
      {recommendation.promptText}
    </BadgeButton>
  );
}
