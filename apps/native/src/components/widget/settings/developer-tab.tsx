import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { uiActions, useViewModel } from "@nixmac/state";
import { clearChangeMap } from "@/viewmodel/change-map";
import { clearEvolveEvents } from "@/viewmodel/evolution";
import { clearRebuildLog } from "@/viewmodel/rebuild";
import { tauriAPI } from "@/ipc/api";
import type { UpdateChannel } from "@/ipc/types";
import { usePrefs } from "@/hooks/use-prefs";
import { OVERRIDABLE_FLAGS } from "@/components/widget/settings/overridable-flags";
import { useUpdater } from "@/hooks/use-updater";
import { getVersion } from "@tauri-apps/api/app";
import {
  AlertTriangle,
  DatabaseZap,
  Download,
  GitBranch,
  Bell,
  Eraser,
  History,
  Flag,
  Pin,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:-[a-zA-Z0-9.-]+)?$/;

export function DeveloperTab() {
  const { installVersion, relaunch, clearPinnedVersion } = useUpdater();
  const { setPref, setFeatureFlagOverride } = usePrefs();
  const featureFlagOverrides = useViewModel((s) => s.preferences?.featureFlagOverrides ?? null);
  const experimentalSpinningMascot = useViewModel(
    (s) => s.preferences?.experimentalSpinningMascot ?? false,
  );
  const experimentalStreamingEvolve = useViewModel(
    (s) => s.preferences?.experimentalStreamingEvolve ?? false,
  );
  const pinnedVersion = useViewModel((s) => s.preferences?.pinnedVersion ?? null);
  const updateChannel = useViewModel((s) => s.preferences?.updateChannel ?? "stable");
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [versionInput, setVersionInput] = useState("");
  const [installing, setInstalling] = useState(false);
  const [clearingState, setClearingState] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion("unknown"));
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
      await installVersion(target);
      // Persistence happened on the Rust side; the preferences event
      // round-trip updates the ViewModel.
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
      setStatusMessage(
        "Cleared pinned version. The auto-updater will check for the latest on next launch.",
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetChannel = async (channel: UpdateChannel) => {
    setErrorMessage(null);
    try {
      // The `global_preferences_changed` round-trip updates the ViewModel.
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.ui.setPrefs({ updateChannel: channel });
      setStatusMessage(
        channel === "stable"
          ? "Using stable updates from main."
          : "Using develop updates. The next auto-update check will read the develop channel.",
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearTauriState = async () => {
    if (
      !window.confirm(
        "Clear Tauri stores? This resets saved settings, routing state, build state, and caches.",
      )
    ) {
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setClearingState(true);
    try {
      // The backend resets its observables and broadcasts the cleared values
      // (`evolve_state_changed`, `global_preferences_changed`,
      // `prompt_history_changed`); the sync modules mirror them.
      await tauriAPI.debug.clearTauriState();
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
    uiActions.clearLogs();
    clearEvolveEvents();
    clearChangeMap();
    clearRebuildLog();
    uiActions.setRebuildPanelDismissed(true);
    uiActions.setConversationalResponse(null);
    uiActions.setCommitMessageSuggestion(null);
    setStatusMessage("Cleared local UI debug buffers.");
    setErrorMessage(null);
  };

  const handleSendTestNotification = async () => {
    setErrorMessage(null);
    try {
      await tauriAPI.debug.sendTestNotification();
      setStatusMessage("Test notification sent.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetFlagOverride = async (key: string, variant: string | null) => {
    try {
      await setFeatureFlagOverride(key, variant);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisableDeveloper = async () => {
    try {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      await tauriAPI.ui.setPrefs({ developerMode: false });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-semibold text-base">Developer</h2>
        <p className="text-muted-foreground text-xs">
          Hidden tools for debugging and bisecting regressions. Don't use these unless you know what
          you're doing.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <div className="font-medium text-foreground">Heads up</div>
            <div className="text-muted-foreground">
              Installing a past version replaces your current{" "}
              <code className="rounded bg-muted px-1">.app</code> bundle on disk. The version number
              you enter must match an existing release at{" "}
              <code className="rounded bg-muted px-1">releases.nixmac.com</code>. Bisecting only
              works in release builds — the dev binary doesn't ship the updater plugin.
            </div>
          </div>
        </div>
      </div>

      {/* Experimental features */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          Experimental
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-sm">Spinning mascot</div>
            <div className="text-muted-foreground text-xs">
              Show a spinning 3D nixmac mascot in the bottom-right corner of your screen while an
              evolution or build is running. Takes effect after restarting nixmac.
            </div>
          </div>
          <Switch
            checked={experimentalSpinningMascot}
            onCheckedChange={(checked) => setPref("experimentalSpinningMascot", checked)}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-sm">Streaming evolve</div>
            <div className="text-muted-foreground text-xs">
              Stream the model's response into the evolve progress view as it is generated,
              instead of waiting for each full reply. Applies to the next evolution.
            </div>
          </div>
          <Switch
            checked={experimentalStreamingEvolve}
            onCheckedChange={(checked) => setPref("experimentalStreamingEvolve", checked)}
          />
        </div>
      </div>

      {/* Feature flag overrides */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Flag className="h-3.5 w-3.5" />
          Feature flags
        </div>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Override PostHog feature flag variants locally for testing. "PostHog
            default" uses the server-side value; choosing a variant forces it
            even when diagnostics are disabled.
          </p>
          {OVERRIDABLE_FLAGS.map((flag) => {
            const active = featureFlagOverrides?.[flag.key] ?? null;
            return (
              <div key={flag.key} className="space-y-1.5">
                <Label className="text-xs font-mono">{flag.label ?? flag.key}</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={active === null ? "default" : "outline"}
                    onClick={() => handleSetFlagOverride(flag.key, null)}
                  >
                    PostHog default
                  </Button>
                  {flag.options.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={active === option.value ? "default" : "outline"}
                      onClick={() => handleSetFlagOverride(flag.key, option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
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
            Stable follows releases from <code className="rounded bg-muted px-1">main</code>.
            Develop follows signed release-mode builds from{" "}
            <code className="rounded bg-muted px-1">develop</code>. Version pins override the
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
            Current channel:{" "}
            <code className="rounded bg-muted px-1 font-mono">{updateChannel}</code>
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
              Pinned to <code className="rounded bg-muted px-1 font-mono">v{pinnedVersion}</code>.
              The silent update check on launch is suppressed while pinned.
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
            Enter a version that exists in the release bucket (look at{" "}
            <code className="rounded bg-muted px-1">git tag</code> for valid values). The signed
            bundle is downloaded from{" "}
            <code className="rounded bg-muted px-1 font-mono">
              releases.nixmac.com/&lt;version&gt;/
            </code>
            , verified, and installed.
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
            Reset saved Tauri plugin-store data when the widget gets stuck in the wrong step or
            cached data looks stale. This clears saved settings, routing state, build state, prompt
            history, and model caches.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleClearTauriState}
              disabled={clearingState}
              size="sm"
              variant="outline"
            >
              <DatabaseZap className="mr-2 h-3.5 w-3.5" />
              {clearingState ? "Clearing…" : "Clear Tauri state"}
            </Button>
            <Button onClick={handleClearUiBuffers} size="sm" variant="outline">
              <Eraser className="mr-2 h-3.5 w-3.5" />
              Clear UI buffers
            </Button>
            <Button onClick={handleSendTestNotification} size="sm" variant="outline">
              <Bell className="mr-2 h-3.5 w-3.5" />
              Test notification
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
