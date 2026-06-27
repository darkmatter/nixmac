import { ipcRenderer } from "@/ipc/api";
import type { EvolveEvent } from "@/ipc/types";
import { EVOLVE_EVENT_CHANNEL } from "@/lib/constants";
import { getTelemetry } from "@/lib/telemetry/instance";
import { formatDurationMs } from "@/lib/utils";
import { uiActions, viewModelActions } from "@nixmac/state";
import { toast } from "sonner";

/** Reset the evolve event stream (debug tooling / e2e reset / cancel). */
export function clearEvolveEvents(): void {
  viewModelActions.setState({ evolveEvents: [] });
}

/**
 * Terminal `complete` payload: the backend emits it once per successful run,
 * after every state cell is updated, carrying the run's result data. Mirror
 * the result data into UI state and fire the completion side-effects that
 * belong to the run (log line, toast, telemetry capture).
 */
function handleEvolutionComplete(payload: EvolveEvent): void {
  const telemetry = payload.telemetry ?? null;
  uiActions.setEvolutionTelemetry(telemetry);
  uiActions.setConversationalResponse(payload.conversationalResponse ?? null);

  const isLimitReached = telemetry?.state === "limitReached";
  const iterationSuffix = telemetry
    ? ` in ${formatDurationMs(telemetry.durationMs)} and ${telemetry.iterations} iteration${telemetry.iterations === 1 ? "" : "s"}`
    : "";
  const completionMsg = isLimitReached
    ? `⏸ Evolution stopped (safety limit reached)${iterationSuffix}\n`
    : `✓ Evolution complete${iterationSuffix}\n`;
  uiActions.appendLog(completionMsg);
  if (isLimitReached) {
    toast.info(completionMsg);
  } else {
    toast.success(completionMsg);
  }

  // The backend updates the evolve-state cell before emitting the terminal
  // event, so the mirrored step is already current here.
  const step = viewModelActions.getState().evolve?.step;
  if (step) {
    getTelemetry().captureEvent({ name: "evolve_completed", props: { step } });
  }
}

/**
 * Always-on fold over the evolve agent event stream. There is no state to
 * hydrate — the buffer resets itself on each run's `start` event instead of
 * the UI clearing it before invoking.
 */
export function startEvolutionSync(): Promise<() => void> {
  return ipcRenderer.on<EvolveEvent>(EVOLVE_EVENT_CHANNEL, (event) => {
    const payload = event.payload;
    if (!payload) return;

    viewModelActions.setState((state) => ({
      evolveEvents: payload.eventType === "start" ? [payload] : [...state.evolveEvents, payload],
    }));

    if (payload.raw) {
      uiActions.appendLog(`${payload.raw}\n`);
    }

    if (payload.eventType === "complete") {
      handleEvolutionComplete(payload);
    }
  });
}
