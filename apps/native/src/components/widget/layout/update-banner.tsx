import { useUpdater } from "@/hooks/use-updater";
import { cn } from "@/lib/utils";
import { ArrowDownCircle, ChevronDown, ChevronUp, X, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function UpdateBanner() {
  const {
    available,
    version,
    notes,
    downloading,
    progress,
    error,
    errorSource,
    installUpdate,
    dismiss,
  } = useUpdater();

  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const notesRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Measure whether the collapsed text is actually clipped so we only show
  // the expand affordance when it would reveal hidden content.
  useLayoutEffect(() => {
    if (expanded) return;
    const el = error ? errorRef.current : notesRef.current;
    if (!el) {
      setIsOverflowing(false);
      return;
    }
    const measure = () => setIsOverflowing(el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [notes, error, errorSource, expanded]);

  // Collapse again when the banner content changes so we re-measure fresh.
  useEffect(() => {
    setExpanded(false);
  }, [notes, error]);

  if (!available && !error) return null;

  const canExpand = (!!notes || !!error) && (isOverflowing || expanded);

  return (
    <div
      className={cn(
        "relative flex gap-3 rounded-lg border px-4 py-3 text-sm mx-5 mt-2",
        expanded ? "items-start" : "items-center",
        error
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-blue-500/30 bg-blue-500/10 text-blue-200"
      )}
    >
      <ArrowDownCircle className={cn("size-4 shrink-0", expanded && "mt-0.5")} />

      <div className="flex-1 min-w-0">
        {error ? (
          <p
            ref={errorRef}
            className={cn(expanded ? "whitespace-pre-wrap break-words" : "truncate")}
          >
            {errorSource === "install" ? "Update install failed" : "Update check failed"}: {error}
          </p>
        ) : (
          <>
            <p className="font-medium">
              Update available: v{version}
            </p>
            {notes && (
              <p
                ref={notesRef}
                className={cn(
                  "text-xs opacity-70 mt-0.5",
                  expanded ? "whitespace-pre-wrap break-words" : "truncate"
                )}
              >
                {notes}
              </p>
            )}
          </>
        )}
      </div>

      <div className={cn("flex items-center gap-2 shrink-0", expanded && "mt-0.5")}>
        {canExpand && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-0.5 opacity-50 hover:opacity-100 transition-opacity"
            aria-label={expanded ? "Collapse details" : "Expand details"}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        )}

        {downloading ? (
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            <span>{progress != null ? `${progress}%` : "Installing…"}</span>
          </div>
        ) : available ? (
          <button
            onClick={installUpdate}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              "bg-blue-500/20 hover:bg-blue-500/30 text-blue-100"
            )}
          >
            Install &amp; Restart
          </button>
        ) : null}

        <button
          onClick={dismiss}
          className="rounded p-0.5 opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
