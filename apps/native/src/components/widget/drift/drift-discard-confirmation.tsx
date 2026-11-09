"use client";

import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface DriftDiscardConfirmationProps {
  isManualDrift: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  total: number;
}

export function DriftDiscardConfirmation({
  isManualDrift,
  onCancel,
  onConfirm,
  total,
}: DriftDiscardConfirmationProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
      <p className="text-foreground text-sm">
        Discard all {total} {isManualDrift ? "manual " : ""}
        {total === 1 ? "change" : "changes"}? This reverts to the tracked state and cannot be undone.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Discard
        </Button>
      </div>
    </div>
  );
}
