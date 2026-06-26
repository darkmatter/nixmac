import { getTelemetry } from "@/lib/telemetry/instance";
import { onboardingActions } from "@nixmac/state";
import { RotateCcw } from "lucide-react";

interface Props {
  title: string;
}

export function OnboardingHeader({ title }: Props) {
  return (
    <header
      className="mb-8 flex shrink-0 select-none items-center justify-between"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" className="size-8 object-contain" aria-hidden="true" />
        <span className="font-semibold text-base tracking-tight">nixmac</span>
      </div>

      <div className="flex items-center gap-1">
        <h3 className="font-normal  text-xs tracking-tight text-zinc-400 font-mono uppercase">{title}</h3>
      </div>

      <button
        type="button"
        onClick={() => {
          getTelemetry().captureEvent({ name: "onboarding_restarted" });
          onboardingActions.reset();
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Restart setup
      </button>
    </header>
  );
}
