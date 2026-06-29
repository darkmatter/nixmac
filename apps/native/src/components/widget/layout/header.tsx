import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { filesystemViewEnabled } from "@/lib/flags";
import { cn } from "@/lib/utils";
import { Clock, FolderTree, Settings, MessageSquarePlus } from "lucide-react";
import { APP_NAME } from "../../../../shared/constants";
import { uiActions, useUiState, viewModelActions } from "@nixmac/state";
import { nav } from "@/router";
import { computeCurrentStep } from "@/components/widget/utils";

export function Header() {
  const showHistory = useUiState((s) => s.showHistory);
  const showFilesystem = useUiState((s) => s.showFilesystem);
  const isProcessing = useUiState((s) => s.isProcessing);
  const isGenerating = useUiState((s) => s.isGenerating);
  const [isPulsing, setIsPulsing] = useState(false);

  // Flash the feedback icon when an error occurs (subscribe to detect all changes)
  useEffect(() => {
    return useUiState.subscribe((state, prevState) => {
      const viewModel = viewModelActions.getState();
      const step = computeCurrentStep({
        nixInstalled: viewModel.nixInstall?.installed ?? null,
        darwinRebuildAvailable: viewModel.nixInstall?.darwinRebuildAvailable ?? null,
        configDir: viewModel.preferences?.configDir ?? "",
        host: viewModel.preferences?.hostAttr ?? "",
        hosts: viewModel.hosts,
        permissionsState: viewModel.permissions,
        permissionsChecked: viewModel.permissionsHydrated,
        evolveState: viewModel.evolve,
        showHistory: state.showHistory,
        showFilesystem: state.showFilesystem,
        isBootstrapping: state.isBootstrapping,
      });
      if (step !== "setup" && state.error && state.error !== prevState.error) {
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 2000);
      }
    });
  }, []);

  return (
    <div
      className="relative flex shrink-0 cursor-move select-none items-center justify-center border-border border-b bg-card/50 px-3 pt-3 pb-3"
      data-tauri-drag-region
    >
      <div className="absolute top-2 left-0 h-4 w-16 z-9999 cursor-default" />

      <h3 className="font-medium text-muted-foreground text-xs" data-tauri-drag-region>
        {APP_NAME}
      </h3>
      <div className="absolute right-3 flex items-center gap-1">
        {filesystemViewEnabled && (
          <Button
            className={cn(
              "h-6 w-6 p-0 mr-[2px]",
              showFilesystem &&
                "border border-teal-500/50 text-teal-400 hover:text-teal-300 hover:border-teal-500/70",
            )}
            size="sm"
            variant="ghost"
            onClick={() => {
              if (isProcessing || isGenerating) return;
              const next = !showFilesystem;
              uiActions.setShowFilesystem(next);
              if (next && showHistory) uiActions.setShowHistory(false);
            }}
            aria-label="Filesystem"
            title="Filesystem"
          >
            <FolderTree className="h-4 w-4" />
          </Button>
        )}
        <Button
          className={cn(
            "h-6 w-6 p-0 mr-[2px]",
            showHistory &&
              "border border-teal-500/50 text-teal-400 hover:text-teal-300 hover:border-teal-500/70",
          )}
          size="sm"
          variant="ghost"
          onClick={() => {
            if (isProcessing || isGenerating) return;
            const next = !showHistory;
            uiActions.setShowHistory(next);
            if (next && showFilesystem) uiActions.setShowFilesystem(false);
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
          onClick={() => uiActions.setFeedbackOpen(true)}
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
          onClick={() => nav.openSettings()}
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
