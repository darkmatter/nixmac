import { Button } from "@/components/ui/button";
import { tauriAPI } from "@/ipc/api";
import { Archive, Download, Upload } from "lucide-react";
import { useState } from "react";

export function BackupRestoreSection() {
  const [includeSecretsInExport, setIncludeSecretsInExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleExport = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setExporting(true);
    try {
      const result = await tauriAPI.settings.export(includeSecretsInExport);
      if (!result) {
        return;
      }
      const skippedHint =
        result.keysSkipped.length > 0
          ? ` (skipped ${result.keysSkipped.length} sensitive key${result.keysSkipped.length === 1 ? "" : "s"})`
          : "";
      setStatusMessage(`Exported ${result.keysWritten} settings to ${result.path}${skippedHint}.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (
      !window.confirm(
        "Import will REPLACE your current settings with the contents of the chosen file. Settings absent from the file (including API keys, if the export was sanitized) will be cleared. Continue?",
      )
    ) {
      return;
    }
    setErrorMessage(null);
    setStatusMessage(null);
    setImporting(true);
    try {
      const result = await tauriAPI.settings.import();
      if (!result) {
        return;
      }
      setStatusMessage(
        `Imported ${result.keysImported} settings from ${result.path}. Reopen settings to see the new values.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Archive className="h-3.5 w-3.5" />
        Backup & Restore
      </div>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Export the contents of <code className="rounded bg-muted px-1 font-mono">settings.json</code>{" "}
          (per-device prefs like provider, model, and confirmations) to a file you can keep or share.
          Import replaces all current settings with the contents of a previously exported file.
          Repo-synced tuning values live in <code className="rounded bg-muted px-1 font-mono">.nixmac/settings.json</code>{" "}
          inside your config directory and are versioned by git — not included in this export.
        </p>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeSecretsInExport}
            onChange={(e) => setIncludeSecretsInExport(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Include API keys in export
            <span className="block text-[10px] text-muted-foreground/70">
              By default, API keys are stripped before writing the file. Enable
              this only if you trust the destination.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleExport} disabled={exporting} size="sm" variant="outline">
            <Download className="mr-2 h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Export settings"}
          </Button>
          <Button onClick={handleImport} disabled={importing} size="sm" variant="outline">
            <Upload className="mr-2 h-3.5 w-3.5" />
            {importing ? "Importing…" : "Import settings"}
          </Button>
        </div>
      </div>
      {(statusMessage || errorMessage) && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          {statusMessage && <div className="text-muted-foreground">{statusMessage}</div>}
          {errorMessage && <div className="text-red-400">{errorMessage}</div>}
        </div>
      )}
    </div>
  );
}
