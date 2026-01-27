"use client";

import { cn } from "@/lib/utils";
import { Console } from "./console";
import { DebugOverlay } from "./debug-overlay";
import { Header } from "./header";
import { SettingsDialog } from "./settings-dialog";
import { Stepper } from "./stepper";
import { CommitStep, EvolvingStep, OverviewStep, SetupStep } from "./steps";
import type { WidgetUIProps } from "./types";
import { getStepperStep } from "./utils";

export type { WidgetUIProps } from "./types";

export function WidgetUI({
  step,
  appState: _appState,
  gitStatus,
  evolvePrompt,
  commitMsg,
  isProcessing,
  isGenerating,
  processingAction,
  evolveEvents,
  summary,
  consoleLogs,
  consoleExpanded,
  settingsOpen,
  error,
  onEvolve,
  onApply,
  onCommit,
  onCancel,
  onEvolvePromptChange,
  onCommitMsgChange,
  onConsoleExpandedChange,
  onSettingsOpenChange,
  onErrorDismiss,
  onShowCommitScreen,
  onBackFromCommit: _onBackFromCommit,
  prefFloatingFooter,
  setPrefFloatingFooter,
  prefWindowShadow,
  setPrefWindowShadow,
  openaiApiKey,
  setOpenaiApiKey,
  ...props
}: WidgetUIProps) {
  const staged =
    gitStatus?.files?.filter((f) => f.index && f.index !== " " && f.index !== "?") || [];

  // Consider a file "cleanly staged" only if its index shows changes and its worktree
  // has no additional unstaged modifications.
  const cleanlyStaged =
    gitStatus?.files?.filter(
      (f) =>
        f.index &&
        f.index !== " " &&
        f.index !== "?" &&
        (!f.working_tree || f.working_tree === " "),
    ) || [];

  // Preview active only when every file is cleanly staged and there's at least one staged file.
  const isPreviewActive =
    (gitStatus?.files?.length ?? 0) > 0 &&
    cleanlyStaged.length === (gitStatus?.files?.length ?? 0) &&
    staged.length > 0;

  return (
    <div
      {...props}
      className={cn(
        "flex h-full w-full flex-col bg-background/90 backdrop-blur-xl",
        props.className,
      )}
    >
      {/* Header */}
      <Header onOpenSettings={() => onSettingsOpenChange(true)} />

      {/* Stepper - only show when not in setup */}
      {step !== "setup" && <Stepper currentStep={getStepperStep(step)} />}

      {/* Main Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className={cn("flex-1 p-5", step !== "evolving" && "overflow-auto")}>
          {/* Error display */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-400 text-sm">
              {error}
              <button
                className="ml-2 text-red-300 underline"
                onClick={onErrorDismiss}
                type="button"
              >
                dismiss
              </button>
            </div>
          )}

          {/* Step: Setup */}
          {step === "setup" && <SetupStep />}

          {/* Step: Overview */}
          {step === "overview" && <OverviewStep />}

          {/* Step: Evolving (shows summary) */}
          {step === "evolving" && !isPreviewActive && <EvolvingStep />}

          {/* Step: Commit (action selection) */}
          {(step === "commit" || (step === "evolving" && isPreviewActive)) && (
            <CommitStep />
          )}
        </div>

        {/* Collapsible Console */}
        {/* <Console
                  expanded={consoleExpanded}
                  logs={consoleLogs}
                  setExpanded={onConsoleExpandedChange}
                /> */}
      </div>

      {/* Footer Navigation - only show when not in setup */}
      {/* {step !== "setup" && (
                <FooterNav
                  evolvePrompt={evolvePrompt}
                  gitStatus={gitStatus}
                  isProcessing={isProcessing}
                  onBack={step === "commit" ? onBackFromCommit : undefined}
                  onContinue={
                    step === "overview"
                      ? onEvolve
                      : step === "evolving"
                        ? onShowCommitScreen
                        : undefined
                  }
                  step={step}
                />
              )} */}
      <Console
        expanded={consoleExpanded}
        logs={consoleLogs}
        setExpanded={onConsoleExpandedChange}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => onSettingsOpenChange(false)}
        openaiApiKey={openaiApiKey ?? ""}
        prefFloatingFooter={prefFloatingFooter ?? false}
        prefWindowShadow={prefWindowShadow ?? false}
        setOpenaiApiKey={setOpenaiApiKey ?? (() => {})}
        setPrefFloatingFooter={setPrefFloatingFooter ?? (() => {})}
        setPrefWindowShadow={setPrefWindowShadow ?? (() => {})}
      />

      {/* Debug Overlay */}
      <DebugOverlay />
    </div>
  );
}
