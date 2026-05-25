import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import type { UpdateChannel } from "@/ipc/types";
import { useUpdater } from "@/hooks/use-updater";
import { DEFAULT_MAX_ITERATIONS } from "@/lib/constants";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertTriangle,
  Archive,
  DatabaseZap,
  Download,
  GitBranch,
  Eraser,
  History,
  Info,
  Pin,
  RotateCcw,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";

const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-zA-Z0-9.-]+)?$/;
const DEFAULT_MAX_BUILD_ATTEMPTS = 5;

export function DeveloperTab() {
  const { installVersion, relaunch, clearPinnedVersion } = useUpdater();
  const pinnedVersion = useWidgetStore((s) => s.pinnedVersion);
  const setPinnedVersion = useWidgetStore((s) => s.setPinnedVersion);
  const updateChannel = useWidgetStore((s) => s.updateChannel);
  const setUpdateChannel = useWidgetStore((s) => s.setUpdateChannel);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [versionInput, setVersionInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const [clearingState, setClearingState] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [maxIterations, setMaxIterations] = useState<number>(DEFAULT_MAX_ITERATIONS);
  const [maxBuildAttempts, setMaxBuildAttempts] = useState<number>(DEFAULT_MAX_BUILD_ATTEMPTS);
  const [includeSecretsInExport, setIncludeSecretsInExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion("unknown"));
    tauriAPI.ui
      .getPrefs()
      .then((prefs) => {
        setMaxIterations(prefs.maxIterations ?? DEFAULT_MAX_ITERATIONS);
        setMaxBuildAttempts(prefs.maxBuildAttempts ?? DEFAULT_MAX_BUILD_ATTEMPTS);
      })
      .catch(() => {
        // Defaults already set; just leave them.
      });
  }, []);

  const handleMaxIterationsChange = async (raw: string) => {
    const next = Number.parseInt(raw, 10);
    if (Number.isNaN(next)) return;
    setMaxIterations(next);
    try {
      await tauriAPI.ui.setPrefs({ maxIterations: next });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMaxBuildAttemptsChange = async (raw: string) => {
    const next = Number.parseInt(raw, 10);
    if (Number.isNaN(next)) return;
    setMaxBuildAttempts(next);
    try {
      await tauriAPI.ui.setPrefs({ maxBuildAttempts: next });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExport = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setExporting(true);
    try {
      const result = await tauriAPI.settings.export(includeSecretsInExport);
      if (!result) {
        // User cancelled the save dialog.
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
      // Refresh local tuning values from the imported store.
      const prefs = await tauriAPI.ui.getPrefs();
      setMaxIterations(prefs.maxIterations ?? DEFAULT_MAX_ITERATIONS);
      setMaxBuildAttempts(prefs.maxBuildAttempts ?? DEFAULT_MAX_BUILD_ATTEMPTS);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleInstall = async () => {
    const target = versionInput.trim();
    if (!target) {
      setErrorMessage("Enter a version like 0.21.0");
      return;
    }
    if (!VERSION_PATTERN.test(target)) {
      setErrorMessage("Version must look like 0.21.0 (no leading 'v')");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(`Fetching v${target}…`);
    setInstalling(true);
    try {
      await installVersion(target);
      // Sync local store immediately — persistence already happened on the Rust side.
      setPinnedVersion(target);
      setStatusMessage(`Installed v${target}. Relaunching…`);
      await relaunch();
    } catch (err) {
      setStatusMessage(null);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  };

  const handleClearPin = async () => {
    setErrorMessage(null);
    try {
      await clearPinnedVersion();
      setPinnedVersion(null);
      setStatusMessage("Cleared pinned version. The auto-updater will check for the latest on next launch.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetChannel = async (channel: UpdateChannel) => {
    const previous = updateChannel;
    setErrorMessage(null);
    setUpdateChannel(channel);
    try {
      await tauriAPI.ui.setPrefs({ updateChannel: channel });
      setStatusMessage(
        channel === "stable"
          ? "Using stable updates from main."
          : "Using develop updates. The next auto-update check will read the develop channel."
      );
    } catch (err) {
      setUpdateChannel(previous);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearTauriState = async () => {
    if (
      !window.confirm("Clear Tauri stores? This resets saved settings, routing state, build state, and caches.")
    ) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setClearingState(true);
    try {
      await tauriAPI.debug.clearTauriState();
      useWidgetStore.getState().setEvolveState(null);
      useWidgetStore.getState().setGitStatus(null);
      useWidgetStore.getState().setPromptHistory([]);
      useWidgetStore.getState().setExternalBuildDetected(false);
      useWidgetStore.getState().setPinnedVersion(null);
      setStatusMessage(
        "Cleared Tauri stores: settings.json, evolve-state.json, and build-state.json. Relaunch or reopen settings to reload defaults.",
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingState(false);
    }
  };

  const handleClearUiBuffers = () => {
    const store = useWidgetStore.getState();
    store.clearLogs();
    store.clearEvolveEvents();
    store.clearPreview();
    store.clearRebuild();
    store.setConversationalResponse(null);
    store.setCommitMessageSuggestion(null);
    setStatusMessage("Cleared local UI debug buffers.");
    setErrorMessage(null);
  };

  const handleDisableDeveloper = async () => {
    try {
      await tauriAPI.ui.setPrefs({ developerMode: false });
      useWidgetStore.getState().setDeveloperMode(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-semibold text-base">Developer</h2>
        <p className="text-muted-foreground text-xs">
          Hidden tools for debugging and bisecting regressions. Don't use these unless you know what you're doing.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <div className="font-medium text-foreground">Heads up</div>
            <div className="text-muted-foreground">
              Installing a past version replaces your current <code className="rounded bg-muted px-1">.app</code>{" "}
              bundle on disk. The version number you enter must match an existing release at{" "}
              <code className="rounded bg-muted px-1">releases.nixmac.com</code>. Bisecting only works in release
              builds — the dev binary doesn't ship the updater plugin.
            </div>
          </div>
        </div>
      </div>

      {/* Update channel */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <GitBranch className="h-3.5 w-3.5" />
          Update channel
        </div>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Stable follows releases from <code className="rounded bg-muted px-1">main</code>. Develop follows signed
            release-mode builds from <code className="rounded bg-muted px-1">develop</code>. Version pins override the
            selected channel until you resume auto-update.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["stable", "develop"] as const).map((channel) => {
              const selected = updateChannel === channel;
              return (
                <Button
                  key={channel}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => handleSetChannel(channel)}
                >
                  {channel === "stable" ? "Stable" : "Develop"}
                </Button>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            Current channel: <code className="rounded bg-muted px-1 font-mono">{updateChannel}</code>
          </div>
        </div>
      </div>

      {/* Pinned-version status */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Pin className="h-3.5 w-3.5" />
          Version pin
        </div>
        {pinnedVersion ? (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Pinned to <code className="rounded bg-muted px-1 font-mono">v{pinnedVersion}</code>. The silent
              update check on launch is suppressed while pinned.
            </div>
            <Button onClick={handleClearPin} size="sm" variant="outline">
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Resume auto-update
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Not pinned. Currently running v{currentVersion ?? "…"}.
          </div>
        )}
      </div>

      {/* Install a specific version */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <History className="h-3.5 w-3.5" />
          Install a past release
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Enter a version that exists in the release bucket (look at <code className="rounded bg-muted px-1">git tag</code>{" "}
            for valid values). The signed bundle is downloaded from{" "}
            <code className="rounded bg-muted px-1 font-mono">releases.nixmac.com/&lt;version&gt;/</code>, verified, and
            installed.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={versionInput}
              onChange={(e) => setVersionInput(e.target.value)}
              placeholder="0.21.0"
              disabled={installing}
              className="font-mono"
            />
            <Button onClick={handleInstall} disabled={installing} size="sm">
              <Download className="mr-2 h-3.5 w-3.5" />
              {installing ? "Installing…" : "Install"}
            </Button>
          </div>
        </div>
      </div>

      {/* Tuning */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Tuning
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Knobs that control how the evolution loop behaves. Changes take effect on the next run.
          Saved to <code className="rounded bg-muted px-1 font-mono">.nixmac/settings.json</code> in
          your config repo so they sync across machines.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="dev-maxIterations"
              >
                Max iterations
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground/70"
                    aria-label="Max iterations info"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                  <p>API calls before stopping (default: {DEFAULT_MAX_ITERATIONS}).</p>
                  <p className="mt-1">
                    Lower = faster/cheaper, may not finish complex changes.
                    <br />
                    Higher = more thorough, uses more API calls.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="dev-maxIterations"
              type="number"
              min={1}
              max={200}
              value={maxIterations}
              onChange={(e) => handleMaxIterationsChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="dev-maxBuildAttempts"
              >
                Max build attempts
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground/70"
                    aria-label="Max build attempts info"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                  Failed builds before giving up on a run (default: {DEFAULT_MAX_BUILD_ATTEMPTS}).
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="dev-maxBuildAttempts"
              type="number"
              min={1}
              max={20}
              value={maxBuildAttempts}
              onChange={(e) => handleMaxBuildAttemptsChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Backup & Restore */}
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
                By default, legacy plain-text API keys are stripped before writing the file. Enable
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
      </div>

      {/* State reset tools */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <DatabaseZap className="h-3.5 w-3.5" />
          State reset
        </div>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Reset saved Tauri plugin-store data when the widget gets stuck in the wrong step or cached data looks stale.
            This clears saved settings, routing state, build state, prompt history, and model caches.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleClearTauriState} disabled={clearingState} size="sm" variant="outline">
              <DatabaseZap className="mr-2 h-3.5 w-3.5" />
              {clearingState ? "Clearing…" : "Clear Tauri state"}
            </Button>
            <Button onClick={handleClearUiBuffers} size="sm" variant="outline">
              <Eraser className="mr-2 h-3.5 w-3.5" />
              Clear UI buffers
            </Button>
          </div>
        </div>
      </div>

      {(statusMessage || errorMessage) && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
          {statusMessage && <div className="text-muted-foreground">{statusMessage}</div>}
          {errorMessage && <div className="text-red-400">{errorMessage}</div>}
        </div>
      )}

      {/* Exit developer mode */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={handleDisableDeveloper}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          Hide developer settings
        </button>
      </div>
    </div>
  );
}
