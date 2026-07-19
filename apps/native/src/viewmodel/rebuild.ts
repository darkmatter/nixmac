import { ipcRenderer, tauriAPI } from "@/ipc/api";
import type {
  DarwinApplyDataEvent,
  DarwinApplySummaryEvent,
  RebuildStatus,
} from "@/ipc/types";
import { isProbeablePermissionRebuildError } from "@/lib/errors";
import { client } from "@/lib/orpc";
import type { RebuildLine } from "@/types/rebuild";
import { uiActions, viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";
import { noticesForBuildLogLines } from "./log-triggers";

// Monotonic id for summary lines; reset on every new run.
let nextLineId = 1;

// Store-path activations (rollback) have no log summarizer, so raw output
// lines double as summary lines. Toggled per-run by `useRebuildStream`.
let echoRawToSummary = false;

// The rebuild-status cell lives on the (long-lived) backend process, but the
// panel/log state is webview-local and resets on reload. Reset per bind so the
// first mirror is recognised as the startup hydration.
let hydrated = false;

export function setRebuildRawLineEcho(echo: boolean): void {
  echoRawToSummary = echo;
}

/** Reset the rebuild output fold (debug tooling / e2e reset). */
export function clearRebuildLog(): void {
  nextLineId = 1;
  viewModelActions.setState({
    rebuildLog: { lines: [], rawLines: [], notices: [] },
  });
}

function appendSummaryLines(texts: string[], type: RebuildLine["type"]): void {
  viewModelActions.setState((state) => ({
    rebuildLog: {
      ...state.rebuildLog,
      lines: [
        ...state.rebuildLog.lines,
        ...texts.map((text) => ({ id: nextLineId++, text, type })),
      ].slice(-50), // Keep last 50 lines
    },
  }));
}

function appendRawLines(lines: string[]): void {
  viewModelActions.setState((state) => {
    const existingNotices = state.rebuildLog.notices;
    const newNotices = noticesForBuildLogLines(lines, existingNotices);

    return {
      rebuildLog: {
        ...state.rebuildLog,
        rawLines: [...state.rebuildLog.rawLines, ...lines].slice(-500), // Keep last 500 raw lines
        notices:
          newNotices.length > 0
            ? [...existingNotices, ...newNotices]
            : existingNotices,
      },
    };
  });
}

function mirrorRebuildStatus(status: RebuildStatus): void {
  const wasRunning =
    viewModelActions.getState().rebuildStatus?.isRunning ?? false;
  const isHydration = !hydrated;
  hydrated = true;

  // Startup hydration of a finished run: the backend process outlives the
  // webview, so a completed/failed run from a previous UI session would
  // otherwise reopen the panel (fresh webview => `rebuildPanelDismissed` false,
  // empty log => a stale "Starting rebuild..." fold). Only an actively running
  // rebuild should open the panel on hydration; keep a finished one dismissed.
  if (isHydration && !status.isRunning) {
    viewModelActions.setState({ rebuildStatus: status });
    uiActions.setRebuildPanelDismissed(true);
    return;
  }

  if (status.isRunning && !wasRunning) {
    // A new run started: reset the output fold and re-show the panel.
    nextLineId = 1;
    viewModelActions.setState({
      rebuildStatus: status,
      rebuildLog: {
        lines: [{ id: 0, text: "Preparing rebuild...", type: "info" }],
        rawLines: [],
        notices: [],
      },
    });
    uiActions.setRebuildPanelDismissed(false);
    return;
  }

  viewModelActions.setState({ rebuildStatus: status });

  if (wasRunning && !status.isRunning) {
    // Run ended: release the global processing flag. On probeable permission
    // failures, re-probe permissions — the backend writes the cell and
    // `permissions_changed` mirrors it, routing the UI to the permissions
    // step.
    uiActions.setProcessing(false);
    if (isProbeablePermissionRebuildError(status.errorType)) {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      void tauriAPI.permissions.refresh();
    }
  }
}

export async function startRebuildSync(): Promise<() => void> {
  hydrated = false;
  const [statusUnlisten, dataUnlisten, summaryUnlisten] = await Promise.all([
    bindBackendSlice<RebuildStatus>({
      hydrate: () => client.darwin.rebuildStatus(),
      event: "rebuild_status_changed",
      mirror: mirrorRebuildStatus,
    }),
    ipcRenderer.on<DarwinApplyDataEvent>("darwin:apply:data", (event) => {
      const lines = event.payload.chunk
        .split("\n")
        .filter((line) => line.trim() !== "");
      if (lines.length === 0) return;
      appendRawLines(lines);
      if (echoRawToSummary) {
        appendSummaryLines(lines, "info");
      }
    }),
    // AI-summarized log lines. Completion/error *status* stays backend-owned
    // (`rebuild_status_changed` carries the same error_type/error/system data
    // via the `darwin:apply:end` payload); the fold only renders the text.
    ipcRenderer.on<DarwinApplySummaryEvent>("darwin:apply:summary", (event) => {
      const { text, complete, success, error } = event.payload;
      if (complete) {
        appendSummaryLines([text], success ? "info" : "stderr");
      } else if (error) {
        appendSummaryLines([text], "stderr");
      } else {
        appendSummaryLines([text], "info");
      }
    }),
  ]);

  return () => {
    statusUnlisten();
    dataUnlisten();
    summaryUnlisten();
  };
}
