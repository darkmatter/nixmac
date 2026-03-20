import { useUpdater } from "@/hooks/use-updater";
import { cn } from "@/lib/utils";
import { ArrowDownCircle, X, Loader2 } from "lucide-react";

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

  if (!available && !error) return null;

  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-lg border px-4 py-3 text-sm mx-5 mt-2",
        error
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-blue-500/30 bg-blue-500/10 text-blue-200"
      )}
    >
      <ArrowDownCircle className="size-4 shrink-0" />

      <div className="flex-1 min-w-0">
        {error ? (
          <p className="truncate">
            {errorSource === "install" ? "Update install failed" : "Update check failed"}: {error}
          </p>
        ) : (
          <>
            <p className="font-medium">
              Update available: v{version}
            </p>
            {notes && (
              <p className="text-xs opacity-70 truncate mt-0.5">{notes}</p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
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
