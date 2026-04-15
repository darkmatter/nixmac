"use client";

import { useState } from "react";
import { Hammer } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useWidgetStore } from "@/stores/widget-store";
import { useApply } from "@/hooks/use-apply";

export function ExternalBuildDetected() {
  const externalBuildDetected = useWidgetStore((s) => s.externalBuildDetected);
  const evolveState = useWidgetStore((s) => s.evolveState);
  const { handleManualBuildConfirm } = useApply();
  const [isPending, setIsPending] = useState(false);

  if (!externalBuildDetected || !evolveState?.evolutionId) return null;

  const handleProceed = async () => {
    setIsPending(true);
    try {
      await handleManualBuildConfirm();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-teal-300/20 border-b px-2 py-1.5 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5">
        <Hammer className="h-3 w-3 shrink-0" />
        A nix build was detected outside nixmac.
      </span>
      <button
        type="button"
        onClick={handleProceed}
        disabled={isPending}
        className="flex items-center gap-1 text-teal-300 hover:text-teal-200 disabled:opacity-60 shrink-0"
      >
        {isPending ? (
          <>
            <Spinner className="h-3 w-3" />
            loading…
          </>
        ) : (
          "Proceed to commit"
        )}
      </button>
    </div>
  );
}
