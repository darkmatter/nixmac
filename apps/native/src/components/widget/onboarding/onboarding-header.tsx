import { RotateCcw } from "lucide-react";
import { useOnboarding } from "@nixmac/state";
import { getTelemetry } from "@/lib/telemetry/instance";

export function OnboardingHeader() {
  const reset = useOnboarding((s) => s.reset);

  return (
    <header className="mb-8 flex shrink-0 items-center justify-between" data-tauri-drag-region>
      <div className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="" className="size-8 object-contain" aria-hidden="true" />
        <span className="font-semibold text-base tracking-tight">nixmac</span>
      </div>

      <div className="flex items-center gap-1">
        <h3 className="font-medium  text-xl tracking-tight">System Permissions</h3>
      </div>

      <button
        type="button"
        onClick={() => {
          getTelemetry().captureEvent({ name: "onboarding_restarted" });
          reset();
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Restart setup
      </button>
    </header>
  );
}
