import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BootstrapConfig } from "@/components/widget/controls/bootstrap-config";
import { DirectoryPicker } from "@/components/widget/controls/directory-picker";
import { getWebSiteUrl } from "@/lib/env";
import { useWidgetStore } from "@/stores/widget-store";
import { tauriAPI } from "@/ipc/api";
import { useTelemetry } from "@/lib/telemetry/context";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import type { AnyFieldApi } from "@tanstack/react-form";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface GeneralTabProps {
  configDir: string | null;
  hasFlake: boolean;
  host: string | null;
  hosts: string[];
  saveHost: (value: string) => void;
  handleRefreshHosts: () => void;
  setSettingsOpen: (open: boolean) => void;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  sendDiagnosticsField: AnyFieldApi;
}

// Support should always land on the public website, even in local app builds.
const SUPPORT_NIXMAC_URL = "https://nixmac.com/support";

async function openExternalUrl(url: string) {
  try {
    await open(url);
  } catch (error) {
    console.warn("Failed to open external URL with Tauri shell; falling back to browser window.", error);
    window.open(url, "_blank");
  }
}

export function GeneralTab({
  configDir,
  hasFlake,
  host,
  hosts,
  saveHost,
  handleRefreshHosts,
  setSettingsOpen,
  sendDiagnosticsField,
}: GeneralTabProps) {
  const telemetry = useTelemetry();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 font-semibold text-base">General</h2>
        <div className="space-y-4">
          {/* Config Directory */}
          <DirectoryPicker label="Configuration Directory" subLabel="Holds your nix-darwin flake" />

          {/* Host Selection or Bootstrap */}
          {hasFlake ? (
            <div className="space-y-2">
              <label className="font-medium text-sm">Host</label>
              <div className="flex items-center gap-2">
                <Select onValueChange={saveHost} value={host || undefined}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a host" />
                  </SelectTrigger>
                  <SelectContent>
                    {hosts.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleRefreshHosts} size="sm" variant="outline">
                  Refresh
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                The darwin configuration to use for this machine
              </p>
            </div>
          ) : (
            configDir && (
              <BootstrapConfig label="Configuration" onSuccess={() => setSettingsOpen(false)} />
            )
          )}

          {/* Diagnostics */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <div className="font-medium text-sm">Send diagnostics to the nixmac team</div>
              <div className="text-muted-foreground text-xs">
                Share redacted crash and error reports to improve stability. Restart required.
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      const base = getWebSiteUrl().replace(/\/$/, "");
                      openExternalUrl(`${base}/privacy`);
                    }}
                    className="mt-2 text-xs text-zinc-400 underline hover:text-zinc-200"
                  >
                    Privacy policy
                  </button>
                </div>
              </div>
            </div>
            <Switch
              checked={!!sendDiagnosticsField.state.value}
              onCheckedChange={async (checked) => {
                const previousValue = !!sendDiagnosticsField.state.value;
                sendDiagnosticsField.handleChange(checked);
                try {
                  await tauriAPI.ui.setPrefs({ sendDiagnostics: checked });
                  telemetry.setEnabled(checked);
                  telemetry.captureEvent({ name: checked ? "diagnostics_opt_in" : "diagnostics_opt_out" });
                } catch (error) {
                  // Revert the field value if persisting the preference fails
                  sendDiagnosticsField.handleChange(previousValue);
                  throw error;
                }
              }}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <div className="font-medium text-sm">Support Nixmac</div>
              <div className="text-muted-foreground text-xs">
                Help fund continued development.
              </div>
            </div>
            <Button
              aria-label="Open Support Nixmac"
              onClick={() => openExternalUrl(SUPPORT_NIXMAC_URL)}
              size="sm"
              variant="outline"
            >
              Open
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>

          <VersionRow />
        </div>
      </div>
    </div>
  );
}

/**
 * Version display with a hidden 7-click toggle for developer mode.
 * Mirrors the classic Android "tap Build number 7 times" easter egg —
 * keeps the developer panel out of the regular UI without an env-var dance.
 */
function VersionRow() {
  const developerMode = useWidgetStore((s) => s.developerMode);
  const setDeveloperMode = useWidgetStore((s) => s.setDeveloperMode);
  const [version, setVersion] = useState<string | null>(null);
  const [tapHint, setTapHint] = useState<string | null>(null);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  const handleVersionTap = async () => {
    if (developerMode) return; // already on; nothing to do
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapCountRef.current = 0;
      setTapHint(null);
    }, 1500);

    const remaining = 7 - tapCountRef.current;
    if (remaining <= 0) {
      tapCountRef.current = 0;
      setTapHint(null);
      setDeveloperMode(true);
      try {
        await tauriAPI.ui.setPrefs({ developerMode: true });
      } catch (err) {
        console.error("Failed to enable developer mode:", err);
        setDeveloperMode(false);
      }
      return;
    }
    if (remaining <= 3) {
      setTapHint(`${remaining} more tap${remaining === 1 ? "" : "s"} to enable Developer settings`);
    }
  };

  const handleDisable = async () => {
    setDeveloperMode(false);
    try {
      await tauriAPI.ui.setPrefs({ developerMode: false });
    } catch (err) {
      console.error("Failed to disable developer mode:", err);
      setDeveloperMode(true);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>Version</span>
        <button
          type="button"
          onClick={handleVersionTap}
          className="select-none font-mono tabular-nums text-foreground hover:text-primary"
          title={developerMode ? "Developer mode is enabled" : undefined}
        >
          {version ?? "…"}
          {developerMode && <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">dev</span>}
        </button>
      </div>
      {tapHint && !developerMode && (
        <div className="mt-1 text-[11px] text-primary">{tapHint}</div>
      )}
      {developerMode && (
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span>Developer settings panel is enabled.</span>
          <button
            type="button"
            onClick={handleDisable}
            className="underline hover:text-foreground"
          >
            Disable
          </button>
        </div>
      )}
    </div>
  );
}
