import { Switch } from "@/components/ui/switch";
import { usePrefs } from "@/hooks/use-prefs";
import { useWidgetStore } from "@/stores/widget-store";

export function PreferencesTab() {
  const { setPref } = usePrefs();
  const confirmBuild = useWidgetStore((s) => s.confirmBuild);
  const confirmClear = useWidgetStore((s) => s.confirmClear);
  const confirmRollback = useWidgetStore((s) => s.confirmRollback);
  const autoSummarizeOnFocus = useWidgetStore((s) => s.autoSummarizeOnFocus);

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
                <div className="text-muted-foreground text-xs">Ask before rebuilding with changes</div>
              </div>
              <Switch
                checked={confirmBuild}
                onCheckedChange={(checked) => setPref("confirmBuild", checked)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Clear / Discard</div>
                <div className="text-muted-foreground text-xs">Ask before discarding changes</div>
              </div>
              <Switch
                checked={confirmClear}
                onCheckedChange={(checked) => setPref("confirmClear", checked)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <div className="text-sm">Rollback</div>
                <div className="text-muted-foreground text-xs">Ask before rolling back to a previous commit</div>
              </div>
              <Switch
                checked={confirmRollback}
                onCheckedChange={(checked) => setPref("confirmRollback", checked)}
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
                <div className="text-muted-foreground text-xs">Summarize unsummarized changes when the window is focused</div>
              </div>
              <Switch
                checked={autoSummarizeOnFocus}
                onCheckedChange={(checked) => setPref("autoSummarizeOnFocus", checked)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
