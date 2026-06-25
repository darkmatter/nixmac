import { ipcRenderer, tauriAPI } from "@/ipc/api";
import type { DarwinApplyDataEvent, DarwinApplySummaryEvent, RebuildStatus } from "@/ipc/types";
import { REBUILD_ERROR_CODES } from "@/lib/errors";
import type { RebuildLine } from "@/types/rebuild";
import { uiActions, viewModelActions } from "@nixmac/state";
import { bindBackendSlice } from "./_helpers";

// Monotonic id for summary lines; reset on every new run.
let nextLineId = 1;

// Store-path activations (rollback) have no log summarizer, so raw output
// lines double as summary lines. Toggled per-run by `useRebuildStream`.
let echoRawToSummary = false;

export function setRebuildRawLineEcho(echo: boolean): void {
  echoRawToSummary = echo;
}

/** Reset the rebuild output fold (debug tooling / e2e reset). */
export function clearRebuildLog(): void {
  nextLineId = 1;
  viewModelActions.setState({ rebuildLog: { lines: [], rawLines: [] } });
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
  viewModelActions.setState((state) => ({
    rebuildLog: {
      ...state.rebuildLog,
      rawLines: [...state.rebuildLog.rawLines, ...lines].slice(-500), // Keep last 500 raw lines
    },
  }));
}

function mirrorRebuildStatus(status: RebuildStatus): void {
  const wasRunning = viewModelActions.getState().rebuildStatus?.isRunning ?? false;

  if (status.isRunning && !wasRunning) {
    // A new run started: reset the output fold and re-show the panel.
    nextLineId = 1;
    viewModelActions.setState({
      rebuildStatus: status,
      rebuildLog: {
        lines: [{ id: 0, text: "Preparing rebuild...", type: "info" }],
        rawLines: [],
      },
    });
    uiActions.setRebuildPanelDismissed(false);
    return;
  }

  viewModelActions.setState({ rebuildStatus: status });

  if (wasRunning && !status.isRunning) {
    // Run ended: release the global processing flag. On Full Disk Access
    // failures, re-probe permissions — the backend writes the cell and
    // `permissions_changed` mirrors it, routing the UI to the permissions
    // step.
    uiActions.setProcessing(false);
    if (status.errorType === REBUILD_ERROR_CODES.FULL_DISK_ACCESS) {
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      void tauriAPI.permissions.refresh();
    }
  }
}

export async function startRebuildSync(): Promise<() => void> {
  const [statusUnlisten, dataUnlisten, summaryUnlisten] = await Promise.all([
    bindBackendSlice<RebuildStatus>({
      // deprecated(orpc): replace with client/orpc from @/lib/orpc
      hydrate: () => tauriAPI.darwin.rebuildStatus(),
      event: "rebuild_status_changed",
      mirror: mirrorRebuildStatus,
    }),
    ipcRenderer.on<DarwinApplyDataEvent>("darwin:apply:data", (event) => {
      const lines = event.payload.chunk.split("\n").filter((line) => line.trim() !== "");
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
