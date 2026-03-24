"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { useRecommendedPrompt } from "@/hooks/use-recommended-prompt";
import { useWidgetStore } from "@/stores/widget-store";

export function MacRecommendationChip() {
  const { recommendation } = useRecommendedPrompt();
  const setEvolvePrompt = useWidgetStore((s) => s.setEvolvePrompt);

  if (!recommendation) return null;

  return (
    <BadgeButton
      onClick={() => setEvolvePrompt(recommendation.promptText)}
    >
      {recommendation.promptText}
    </BadgeButton>
  );
}
