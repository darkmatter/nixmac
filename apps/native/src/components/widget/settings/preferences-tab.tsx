import { Switch } from "@/components/ui/switch";
import { usePrefs } from "@/hooks/use-prefs";
import { usePrefStore } from "@/stores/pref-store";

export function PreferencesTab() {
  const { setPref } = usePrefs();
  const confirmBuild = usePrefStore((s) => s.confirmBuild);
  const confirmClear = usePrefStore((s) => s.confirmClear);
  const confirmRollback = usePrefStore((s) => s.confirmRollback);
  const autoSummarizeOnFocus = usePrefStore((s) => s.autoSummarizeOnFocus);
  const scanHomebrewOnStartup = usePrefStore((s) => s.scanHomebrewOnStartup);
  const defaultToDiffTab = usePrefStore((s) => s.defaultToDiffTab);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 font-semibold text-base">Preferences</h2>
        <div className="space-y-3">
          <div className="font-medium text-sm">Confirmation dialogs</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Build</div>
                <div className="text-muted-foreground text-xs">
                  Ask before rebuilding with changes
                </div>
              </div>
              <Switch
                checked={confirmBuild}
                onCheckedChange={(checked) => setPref("confirmBuild", checked)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Clear / Discard</div>
                <div className="text-muted-foreground text-xs">
                  Ask before discarding changes
                </div>
              </div>
              <Switch
                checked={confirmClear}
                onCheckedChange={(checked) => setPref("confirmClear", checked)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Rollback</div>
                <div className="text-muted-foreground text-xs">
                  Ask before rolling back to a previous commit
                </div>
              </div>
              <Switch
                checked={confirmRollback}
                onCheckedChange={(checked) =>
                  setPref("confirmRollback", checked)
                }
              />
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="space-y-3">
          <div className="font-medium text-sm">Summarization</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Auto-summarize on focus</div>
                <div className="text-muted-foreground text-xs">
                  Summarize unsummarized changes when the window is focused
                </div>
              </div>
              <Switch
                checked={autoSummarizeOnFocus}
                onCheckedChange={(checked) =>
                  setPref("autoSummarizeOnFocus", checked)
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Diff Tab</div>
                <div className="text-muted-foreground text-xs">
                  Prefer Diff tab when reviewing changes
                </div>
              </div>
              <Switch
                checked={defaultToDiffTab}
                onCheckedChange={(checked) =>
                  setPref("defaultToDiffTab", checked)
                }
              />
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="space-y-3">
          <div className="font-medium text-sm">Startup scans</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Scan Homebrew</div>
                <div className="text-muted-foreground text-xs">
                  Detect Homebrew drift and offer to resolve
                </div>
              </div>
              <Switch
                checked={scanHomebrewOnStartup}
                onCheckedChange={(checked) =>
                  setPref("scanHomebrewOnStartup", checked)
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
