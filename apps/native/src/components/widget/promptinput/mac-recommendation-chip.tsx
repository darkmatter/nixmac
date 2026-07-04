"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { useRecommendedPrompt } from "@/hooks/use-recommended-prompt";
import { getTelemetry } from "@/lib/telemetry/instance";
import { uiActions } from "@nixmac/state";

export function MacRecommendationChip() {
  const { recommendation } = useRecommendedPrompt();

  if (!recommendation) return null;

  return (
    <BadgeButton
      onClick={() => {
        // Surface only — recommendation text is derived from this machine.
        getTelemetry().captureEvent({
          name: "prompt_suggestion_used",
          props: { surface: "mac_recommendation" },
        });
        uiActions.setEvolvePrompt(recommendation.promptText);
      }}
    >
      {recommendation.promptText}
    </BadgeButton>
  );
}
