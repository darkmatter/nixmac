import { Button } from "@/components/ui/button";
import { Settings, MessageSquare } from "lucide-react";
import { APP_NAME } from "../../../shared/constants";
import { useWidgetStore } from "@/stores/widget-store";

export function Header() {
  const setSettingsOpen = useWidgetStore((s) => s.setSettingsOpen);
  const setFeedbackOpen = useWidgetStore((s) => s.setFeedbackOpen);

  return (
    <div
      className="relative flex flex-shrink-0 cursor-move select-none items-center justify-center border-border border-b bg-card/50 px-3 pt-3 pb-3"
      data-tauri-drag-region
    >
      <div className="absolute top-2 left-0 h-4 w-16 z-[9999] cursor-default" />

      <h3 className="font-medium text-muted-foreground text-xs" data-tauri-drag-region>
        {APP_NAME}
      </h3>
      <div className="absolute right-3 flex items-center gap-2">
        <Button
          className="h-8 w-8 p-0"
          size="sm"
          variant="ghost"
          onClick={() => setFeedbackOpen(true)}
          aria-label="Give feedback"
          title="Give feedback"
        >
          <MessageSquare className="h-4 w-4" />
        </Button>

        <Button
          className="h-8 w-8 p-0"
          size="sm"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
