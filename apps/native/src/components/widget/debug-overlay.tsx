"use client";

import { useWidgetStore, computeAppState, appStateToStep } from "@/stores/widget-store";

/**
 * Debug overlay for development - shows current widget state
 */
export function DebugOverlay() {
  const store = useWidgetStore();
  const appState = computeAppState(store);
  const step = appStateToStep(appState, store.showCommitScreen, store.rebuild.isRunning);
  // const appState = useWidgetStore((s) => s.appState);
  // const isProcessing = useWidgetStore((s) => s.isProcessing);
  // const processingAction = useWidgetStore((s) => s.processingAction);
  // const isGenerating = useWidgetStore((s) => s.isGenerating);
  // const hasChanges = useWidgetStore((s) => s.gitStatus?.hasChanges);
  // const filesCount = useWidgetStore((s) => s.gitStatus?.files?.length ?? 0);
  // const showCommitScreen = useWidgetStore((s) => s.showCommitScreen);
  // const isExpanded = useWidgetStore((s) => s.isExpanded);

  return (
    <div
      className="pointer-events-none absolute top-2 right-4 z-50 rounded bg-black/80 px-2 py-1 font-mono text-xs text-yellow-400"
      style={{ backdropFilter: "blur(4px)" }}
    >
      <div>step: {step}</div>
      {/* <div>appState: {appState}</div> */}
      {/* <div>isProcessing: {String(isProcessing)}</div> */}
      {/* <div>processingAction: {processingAction || "null"}</div> */}
      {/* <div>isGenerating: {String(isGenerating)}</div> */}
      {/* <div>hasChanges: {String(hasChanges)}</div> */}
      {/* <div>filesCount: {filesCount}</div> */}
      {/* <div>showCommitScreen: {String(showCommitScreen)}</div> */}
      {/* <div>isExpanded: {String(isExpanded)}</div> */}
    </div>
  );
}
