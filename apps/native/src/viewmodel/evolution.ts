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

// Retention caps for coalesced stream chunks. Comfortably above the display
// tails (320 chars / 500 lines in evolve-progress.tsx) — anything beyond
// them is only reachable through the Console, which got the raw chunks.
const STREAM_TEXT_MAX_CHARS = 2_000;
const BUILD_CHUNK_MAX_LINES = 500;

function tailChars(text: string, max: number): string {
  if (text.length <= max) return text;
  // Slice by code points so the cut can't land inside a surrogate pair.
  return [...text].slice(-max).join("");
}

function tailLines(text: string, max: number): string {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  return lines.slice(-max).join("\n");
}

/** The incoming event folded into the previous one when both are chunks of
 * the same stream, null otherwise. */
function coalesceStreamChunk(last: EvolveEvent, next: EvolveEvent): EvolveEvent | null {
  const a = last.detail;
  const b = next.detail;
  if (a?.type === "streamDelta" && b?.type === "streamDelta") {
    const text = tailChars(a.text + b.text, STREAM_TEXT_MAX_CHARS);
    return { ...next, raw: text, detail: { type: "streamDelta", text } };
  }
  if (a?.type === "buildOutput" && b?.type === "buildOutput") {
    const chunk = tailLines(a.chunk + b.chunk, BUILD_CHUNK_MAX_LINES);
    return { ...next, raw: chunk, detail: { type: "buildOutput", chunk } };
  }
  return null;
}

/**
 * Fold an incoming event into the buffer. Stream chunks (streamDelta text,
 * buildCheck output) arrive every ~120ms; appending each one would retain
 * thousands of hidden events over a long run and re-copy the array every
 * time. A chunk merges into a preceding chunk of the same stream instead,
 * capped to a display-sized tail — semantic events (including streamReset
 * markers, which bound the visible tail) append as-is.
 */
export function appendEvolveEvent(events: EvolveEvent[], payload: EvolveEvent): EvolveEvent[] {
  if (payload.eventType === "start") {
    return [payload];
  }
  const last = events[events.length - 1];
  const coalesced = last === undefined ? null : coalesceStreamChunk(last, payload);
  if (coalesced) {
    return [...events.slice(0, -1), coalesced];
  }
  return [...events, payload];
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
      evolveEvents: appendEvolveEvent(state.evolveEvents, payload),
    }));

    if (payload.raw) {
      uiActions.appendLog(`${payload.raw}\n`);
    }

    if (payload.eventType === "complete") {
      handleEvolutionComplete(payload);
    }
  });
}
