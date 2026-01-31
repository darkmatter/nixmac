import { Switch } from "@/components/ui/switch";
import { darwinAPI } from "@/tauri-api";
import type { AnyFieldApi } from "@tanstack/react-form";

interface AppearanceTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  floatingFooterField: AnyFieldApi;
  // biome-ignore lint/suspicious/noExplicitAny: tanstack form types are complex
  windowShadowField: AnyFieldApi;
}

export function AppearanceTab({
  floatingFooterField,
  windowShadowField,
}: AppearanceTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 font-semibold text-base">Appearance</h2>
        <div className="space-y-4">
          {/* Floating Footer */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <div className="font-medium text-sm">Floating Footer</div>
              <div className="text-muted-foreground text-xs">
                Show the footer floating above content
              </div>
            </div>
            <Switch
              checked={!!floatingFooterField.state.value}
              onCheckedChange={async (checked) => {
                floatingFooterField.handleChange(checked);
                try {
                  await darwinAPI.ui.setPrefs({
                    floatingFooter: checked,
                  });
                } catch {
                  // Ignore errors
                }
              }}
            />
          </div>

          {/* Window Shadow */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <div className="font-medium text-sm">Window Shadow</div>
              <div className="text-muted-foreground text-xs">
                Add a shadow around the widget window
              </div>
            </div>
            <Switch
              checked={!!windowShadowField.state.value}
              onCheckedChange={async (checked) => {
                windowShadowField.handleChange(checked);
                try {
                  await darwinAPI.ui.setWindowShadow(checked);
                  await darwinAPI.ui.setPrefs({
                    windowShadow: checked,
                  });
                } catch {
                  // Ignore errors
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
