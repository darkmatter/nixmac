import { Eye, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Confirmation gate before decrypting a value into the UI. Absolutely
 * positioned so it stays inside the app window, like the apply sheet.
 */
export function RevealDialog({
  secretName,
  onConfirm,
  onCancel,
}: {
  secretName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    /* backdrop click-to-dismiss mirrors the app's overlay pattern */
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 duration-150 animate-in fade-in"
      onClick={onCancel}
    >
      {/* click here must not dismiss the backdrop */}
      <div
        role="alertdialog"
        aria-label="Reveal secret value?"
        className="w-[400px] rounded-[14px] border border-border bg-popover p-5 shadow-2xl duration-200 animate-in slide-in-from-bottom-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <ShieldCheck className="size-4.5" aria-hidden="true" />
          </span>
          <h3 className="font-semibold text-[15px]">Reveal secret value?</h3>
        </div>
        <p className="mb-4 text-[13px] text-muted-foreground leading-relaxed">
          This decrypts <code className="font-mono text-foreground">{secretName}</code> locally with
          this host's age key. The plaintext stays in memory and is never written to disk.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onConfirm}>
            <Eye aria-hidden="true" />
            Reveal
          </Button>
        </div>
      </div>
    </div>
  );
}
