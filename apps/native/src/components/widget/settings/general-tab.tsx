import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BootstrapConfig } from "@/components/widget/bootstrap-config";
import { DirectoryPicker } from "@/components/widget/directory-picker";
import { darwinAPI } from "@/tauri-api";
import { open } from '@tauri-apps/plugin-shell';
import { getWebSiteUrl } from "@/lib/env";
import type { AnyFieldApi } from "@tanstack/react-form";

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
                Share anonymized crash and error reports to improve stability. Restart required.
                <div>
                  <button
                    type="button"
                    onClick={async () => {
                      const base = getWebSiteUrl().replace(/\/$/, "");
                      const url = `${base}/privacy-policy`;
                      try {
                        await open(url);
                      } catch (err) {
                        // Fallback to window.open if Tauri shell fails for some reason (e.g. during direct development in the web app)
                        window.open(url, "_blank");
                      }
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
                  await darwinAPI.ui.setPrefs({ sendDiagnostics: checked });
                } catch (error) {
                  // Revert the field value if persisting the preference fails
                  sendDiagnosticsField.handleChange(previousValue);
                  throw error;
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
