"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Console } from "./console";
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
  configDir,
  hosts,
  host,
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
  isExpanded,
  peekState,
  settingsOpen,
  error,
  onExpand,
  onCollapse,
  onPickDir,
  onSaveHost,
  onEvolve,
  onApply,
  onCommit,
  onCancel,
  onEvolvePromptChange,
  onCommitMsgChange,
  onConsoleExpandedChange,
  onSettingsOpenChange,
  onErrorDismiss,
  onHostsChange,
  onShowCommitScreen,
  onBackFromCommit,
  prefFloatingFooter,
  setPrefFloatingFooter,
  prefWindowShadow,
  setPrefWindowShadow,
  openaiApiKey,
  setOpenaiApiKey,
  iconClassName,
  ...props
}: WidgetUIProps) {
  const showExpanded = isExpanded && peekState !== "hidden";
  const staged =
    gitStatus?.files?.filter(
      (f) => f.index && f.index !== " " && f.index !== "?"
    ) || [];
  const isPreviewActive =
    gitStatus?.files?.every(
      (f) => f.index && f.index !== " " && f.index !== "?"
    ) && staged.length > 0;

  if (!showExpanded) {
    return (
      <div
        className={cn(
          "fixed inset-0 z-50 flex h-full w-full items-end justify-end space-y-4 p-4",
          props.className
        )}
      >
        <Button
          className="zoom-in h-14 w-14 animate-in rounded-full bg-primary text-primary-foreground shadow-2xl duration-200 hover:bg-primary/90"
          onClick={onExpand}
          size="lg"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      {...props}
      className={cn("fixed inset-0 z-50 m-auto h-full w-full", props.className)}
    >
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <div className="slide-in-from-bottom-4 z-10 flex h-full min-h-0 w-full animate-in flex-col overflow-hidden rounded-xl border border-border bg-card/90 shadow-2xl backdrop-blur-xl duration-300">
              {/* Header */}
              <Header
                onOpenSettings={() => onSettingsOpenChange(true)}
                setIsExpanded={onCollapse}
              />

              {/* Stepper - only show when not in setup */}
              {step !== "setup" && (
                <Stepper currentStep={getStepperStep(step)} />
              )}

              {/* Main Content */}
              <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                <div
                  className={cn(
                    "flex-1 p-5",
                    step !== "evolving" && "overflow-auto"
                  )}
                >
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
                  {step === "setup" && (
                    <SetupStep
                      configDir={configDir}
                      host={host}
                      hosts={hosts}
                      pickDir={onPickDir}
                      saveHost={onSaveHost}
                    />
                  )}

                  {/* Step: Overview */}
                  {step === "overview" && (
                    <OverviewStep
                      evolveEvents={evolveEvents}
                      evolvePrompt={evolvePrompt}
                      gitStatus={gitStatus}
                      handleEvolve={onEvolve}
                      isGenerating={isGenerating}
                      isProcessing={
                        isProcessing && processingAction === "evolve"
                      }
                      setEvolvePrompt={onEvolvePromptChange}
                    />
                  )}

                  {/* Step: Evolving (shows summary) */}
                  {step === "evolving" && !isPreviewActive && (
                    <EvolvingStep
                      evolveEvents={evolveEvents}
                      evolvePrompt={evolvePrompt}
                      gitStatus={gitStatus}
                      handleCancel={onCancel}
                      handleEvolve={onEvolve}
                      handleShowCommit={onShowCommitScreen}
                      isGenerating={isGenerating}
                      isProcessing={isProcessing}
                      processingAction={processingAction}
                      setEvolvePrompt={onEvolvePromptChange}
                      summary={summary}
                    />
                  )}

                  {/* Step: Commit (action selection) */}
                  {(step === "commit" ||
                    (step === "evolving" && isPreviewActive)) && (
                    <CommitStep
                      commitMsg={commitMsg}
                      evolvePrompt={evolvePrompt}
                      gitStatus={gitStatus}
                      handleCancel={onCancel}
                      handleCommit={onCommit}
                      handleEvolve={onEvolve}
                      isProcessing={isProcessing}
                      processingAction={processingAction}
                      setCommitMsg={onCommitMsgChange}
                      setEvolvePrompt={onEvolvePromptChange}
                      summary={summary}
                    />
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
            </div>
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        configDir={configDir}
        host={host}
        hosts={hosts}
        isOpen={settingsOpen}
        onClose={() => onSettingsOpenChange(false)}
        openaiApiKey={openaiApiKey ?? ""}
        pickDir={onPickDir}
        prefFloatingFooter={prefFloatingFooter ?? false}
        prefWindowShadow={prefWindowShadow ?? false}
        saveHost={onSaveHost}
        setHosts={onHostsChange}
        setOpenaiApiKey={setOpenaiApiKey ?? (() => {})}
        setPrefFloatingFooter={setPrefFloatingFooter ?? (() => {})}
        setPrefWindowShadow={setPrefWindowShadow ?? (() => {})}
      />
    </div>
  );
}
