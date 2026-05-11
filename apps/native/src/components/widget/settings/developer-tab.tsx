import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertTriangle,
  DatabaseZap,
  Download,
  Eraser,
  History,
  Pin,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";

const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-zA-Z0-9.-]+)?$/;

export function DeveloperTab() {
  const pinnedVersion = useWidgetStore((s) => s.pinnedVersion);
  const setPinnedVersion = useWidgetStore((s) => s.setPinnedVersion);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [versionInput, setVersionInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const [clearingState, setClearingState] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion("unknown"));
  }, []);

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
      await invoke("install_version", { version: target });
      // Sync local store immediately — persistence already happened on the Rust side.
      setPinnedVersion(target);
      setStatusMessage(`Installed v${target}. Relaunching…`);
      // Reuse the same relaunch path the production updater uses.
      await invoke("relaunch_after_update");
    } catch (err) {
      setStatusMessage(null);
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setInstalling(false);
    }
  };

  const handleClearPin = async () => {
    setErrorMessage(null);
    try {
      await invoke("clear_pinned_version");
      setPinnedVersion(null);
      setStatusMessage("Cleared pinned version. The auto-updater will check for the latest on next launch.");
    } catch (err) {
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
      await invoke("developer_clear_tauri_state");
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
      await darwinAPI.ui.setPrefs({ developerMode: false });
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
