"use client";

import { BadgeButton } from "@/components/ui/badge-button";
import { useRecommendedPrompt } from "@/hooks/use-recommended-prompt";
import { getTelemetry } from "@/lib/telemetry/instance";

export function MacRecommendationChip({ onSelect }: { onSelect: (prompt: string) => void }) {
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
        onSelect(recommendation.promptText);
      }}
    >
      {recommendation.promptText}
    </BadgeButton>
  );
}
