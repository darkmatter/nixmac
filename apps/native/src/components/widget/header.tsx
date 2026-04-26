import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Clock, Settings, MessageSquarePlus } from "lucide-react";
import { APP_NAME } from "../../../shared/constants";
import { useWidgetStore } from "@/stores/widget-store";

export function Header() {
  const setSettingsOpen = useWidgetStore((s) => s.setSettingsOpen);
  const setFeedbackOpen = useWidgetStore((s) => s.setFeedbackOpen);
  const showHistory = useWidgetStore((s) => s.showHistory);
  const setShowHistory = useWidgetStore((s) => s.setShowHistory);
  const isProcessing = useWidgetStore((s) => s.isProcessing);
  const isGenerating = useWidgetStore((s) => s.isGenerating);
  const [isPulsing, setIsPulsing] = useState(false);

  // Flash the feedback icon when an error occurs (subscribe to detect all changes)
  useEffect(() => {
    return useWidgetStore.subscribe((state, prevState) => {
      if (state.error && state.error !== prevState.error) {
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 2000);
      }
    });
  }, []);

  return (
    <div
      className="relative flex flex-shrink-0 cursor-move select-none items-center justify-center border-border border-b bg-card/50 px-3 pt-3 pb-3"
      data-tauri-drag-region
    >
      <div className="absolute top-2 left-0 h-4 w-16 z-[9999] cursor-default" />

      <h3 className="font-medium text-muted-foreground text-xs" data-tauri-drag-region>
        {APP_NAME}
      </h3>
      <div className="absolute right-3 flex items-center gap-1">
        <Button
          className={cn(
            "h-6 w-6 p-0 mr-[2px]",
            showHistory && "border border-teal-500/50 text-teal-400 hover:text-teal-300 hover:border-teal-500/70",
          )}
          size="sm"
          variant="ghost"
          onClick={() => {
            if (isProcessing || isGenerating) return;
            setShowHistory(!showHistory);
          }}
          aria-label="History"
          title="History"
        >
          <Clock className="h-4 w-4" />
        </Button>
        <Button
          className="h-6 w-6 p-0"
          size="sm"
          variant="ghost"
          onClick={() => setFeedbackOpen(true)}
          aria-label="Give feedback"
          title="Give feedback"
        >
          <MessageSquarePlus
            className={`h-4 w-4 transition-all duration-500 ${isPulsing ? "text-red-400 scale-125" : ""}`}
          />
        </Button>
        <Button
          className="h-6 w-6 p-0"
          size="sm"
          variant="ghost"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" data-testid="settings-icon" />
        </Button>
      </div>
    </div>
  );
}
