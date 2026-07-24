import { ArrowLeft, Check, Copy, Lock, Monitor, TriangleAlert, User } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { RecipientKind } from "./types";

export function RecipientKindIcon({
  kind,
  className,
}: {
  kind: RecipientKind;
  className?: string;
}) {
  const Icon = kind === "host" ? Monitor : User;
  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

export function ThisHostChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-brand/35 bg-brand/15 px-2 py-px font-medium text-[11px] text-brand",
        className,
      )}
    >
      This host
    </span>
  );
}

/** Green "Can decrypt" / amber "No access" pill for a secret row. */
export function AccessBadge({ canDecrypt }: { canDecrypt: boolean }) {
  return canDecrypt ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-1.5 py-px font-medium text-[11px] text-success">
      <Check className="size-3" aria-hidden="true" />
      Can decrypt
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/15 px-1.5 py-px font-medium text-[11px] text-warning">
      <Lock className="size-3" aria-hidden="true" />
      No access
    </span>
  );
}

/** Green "In repo" / amber "Not committed" pill for a recipient key. */
export function InRepoBadge({ inRepo }: { inRepo: boolean }) {
  return inRepo ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-2 py-0.5 font-medium text-[11.5px] text-success">
      <Check className="size-3" aria-hidden="true" />
      In repo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/15 px-2 py-0.5 font-medium text-[11.5px] text-warning">
      <TriangleAlert className="size-3" aria-hidden="true" />
      Not committed
    </span>
  );
}

export function CopyIconButton({
  label,
  onCopy,
  className,
}: {
  label: string;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onCopy}
      className={cn(
        "inline-flex cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Copy className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** Back chevron + title header used by every drill-in view. */
export function ViewHeader({
  title,
  onBack,
  mono,
  children,
}: {
  title: string;
  onBack: () => void;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="inline-flex cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
      </button>
      <h2 className={cn("font-semibold text-base", mono && "font-mono")}>{title}</h2>
      {children}
    </div>
  );
}
