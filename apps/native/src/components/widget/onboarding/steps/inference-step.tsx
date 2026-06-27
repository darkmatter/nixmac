"use client";

import { Clock } from "lucide-react";
import { StepShell } from "@/components/widget/onboarding/step-shell";
import { InferenceSetup } from "@/components/widget/onboarding/inference/inference-setup";
import { stepEyebrow } from "@/components/widget/onboarding/lib/onboarding";
import type { InferenceConfig } from "@/components/widget/onboarding/lib/inference";
import { getTelemetry } from "@/lib/telemetry/instance";

interface InferenceStepProps {
  onConfigured: (config: InferenceConfig) => void;
  onSkip: () => void;
}

export function InferenceStep({ onConfigured, onSkip }: InferenceStepProps) {
  return (
    <StepShell
      eyebrow={stepEyebrow("inference")}
      title="Set up AI inference"
      description="nixmac turns plain-language requests into nix changes. Choose how those requests are processed — use our hosted models, or bring your own API key."
    >
      <InferenceSetup onConfigured={onConfigured} />

      <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-background px-4 py-3">
        <p className="flex items-center gap-2 text-muted-foreground text-xs">
          <Clock className="size-3.5" aria-hidden="true" />
          Not sure yet? You can finish this while your first build runs.
        </p>
        <button
          type="button"
          onClick={() => {
            getTelemetry().captureEvent({ name: "inference_skipped" });
            onSkip();
          }}
          className="shrink-0 font-medium text-primary text-sm hover:underline"
        >
          Skip for now
        </button>
      </div>
    </StepShell>
  );
}
