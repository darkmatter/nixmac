import { Check, ChevronRight, FileCode2, Shield, X } from "lucide-react";
import type { CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGlow } from "@/components/ui/button-glow";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ApplyDiffLine, ApplyRequest } from "./types";

export type ApplyPhase = "review" | "building" | "done";

const DIFF_ADDED = "#9ff0e3";
const DIFF_REMOVED = "#f09fad";

function diffLineStyle(kind: ApplyDiffLine["kind"]): CSSProperties {
  switch (kind) {
    case "added":
      return { color: DIFF_ADDED, background: `${DIFF_ADDED}1a` };
    case "removed":
      return { color: DIFF_REMOVED, background: `${DIFF_REMOVED}1a` };
    case "meta":
      return { color: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)" };
    default:
      return { color: "var(--muted-foreground)" };
  }
}

/**
 * The review → build → commit bottom sheet. Every secrets change funnels
 * through here: see the diff, apply, and land as a git commit. Positioned
 * absolutely, so the nearest relative ancestor (the app window) scopes it.
 */
export function ApplySheet({
  request,
  phase,
  onCancel,
  onApply,
  onDone,
}: {
  request: ApplyRequest;
  phase: ApplyPhase;
  onCancel: () => void;
  onApply: () => void;
  onDone: () => void;
}) {
  return (
    /* backdrop click-to-dismiss mirrors the app's overlay pattern */
    <div
      className="absolute inset-0 z-40 flex items-end bg-black/50 duration-150 animate-in fade-in"
      onClick={phase === "review" ? onCancel : undefined}
    >
      {/* click here must not dismiss the backdrop */}
      <div
        className="max-h-[88%] w-full overflow-y-auto rounded-t-2xl border-border border-t bg-popover px-5.5 py-5 shadow-2xl duration-200 animate-in slide-in-from-bottom-4"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "review" && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-base">{request.title}</h3>
                <p className="mt-1 text-[13px] text-muted-foreground">{request.subtitle}</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onCancel}
                className="inline-flex cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {request.plan && (
              <div className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-muted/20 px-3.5 py-3">
                <div className="mb-0.5 text-[11px] text-muted-foreground">nixmac plan</div>
                {request.plan.map((step) => (
                  <div key={step} className="flex items-center gap-2 text-[13px]">
                    <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {step}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {request.files.map((file) => (
                <span
                  key={file.path}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11.5px]"
                >
                  <span className={cn(file.mark === "+" ? "text-[#9ff0e3]" : "text-warning")}>
                    {file.mark}
                  </span>
                  {file.path}
                  <span className="text-muted-foreground">{file.note}</span>
                </span>
              ))}
            </div>

            <div className="overflow-hidden rounded-[10px] border border-border">
              <div className="flex items-center gap-2 border-border border-b bg-muted/25 px-3 py-2">
                <FileCode2 className="size-3.5 text-sky-400" aria-hidden="true" />
                <span className="font-mono text-muted-foreground text-xs">{request.diffFile}</span>
              </div>
              <div className="py-2.5 font-mono text-[12.5px] leading-[1.7]">
                {request.diff.map((line) => (
                  <div key={line.text} className="whitespace-pre px-3" style={diffLineStyle(line.kind)}>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                <Shield className="size-3.5" aria-hidden="true" />
                Encrypted with age, then verified with darwin-rebuild before anything is applied.
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
                <ButtonGlow active onClick={onApply}>
                  <Check aria-hidden="true" />
                  Apply &amp; commit
                </ButtonGlow>
              </div>
            </div>
          </div>
        )}

        {phase === "building" && (
          <div className="flex flex-col items-center gap-3.5 py-6.5">
            <Spinner className="size-6.5 text-teal-400" />
            <div className="text-center">
              <div className="font-semibold text-[15px]">Applying changes</div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                Encrypting with age · running{" "}
                <code className="font-mono text-foreground">darwin-rebuild check</code>
              </div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col items-center gap-3.5 py-5.5">
            <span className="inline-flex size-13 items-center justify-center rounded-full bg-success/15 text-success">
              <Check className="size-6.5" aria-hidden="true" />
            </span>
            <div className="text-center">
              <div className="font-semibold text-base">Applied &amp; committed</div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                Build check passed. Every apply is a git commit — roll back anytime.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                {request.commit}
              </code>
              <span className="text-[13px] text-muted-foreground">{request.commitMsg}</span>
            </div>
            <Button size="sm" onClick={onDone}>
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
