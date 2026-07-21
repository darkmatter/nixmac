import { describe, expect, it, vi } from "vitest";
import type { EvolveEvent, EvolveEventDetail, EvolveEventType } from "@/ipc/types";
import { appendEvolveEvent } from "./evolution";

vi.mock("@/ipc/api", () => ({ ipcRenderer: { on: vi.fn<() => Promise<() => void>>() } }));
vi.mock("@/lib/telemetry/instance", () => ({ getTelemetry: vi.fn<() => unknown>() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn<() => void>(), info: vi.fn<() => void>() } }));

function event(eventType: EvolveEventType, raw = "", detail?: EvolveEventDetail): EvolveEvent {
  return { eventType, raw, summary: "", iteration: 1, timestampMs: 0, detail };
}

const delta = (text: string) => event("streamDelta", text, { type: "streamDelta", text });
const chunk = (text: string) => event("buildCheck", text, { type: "buildOutput", chunk: text });

describe("appendEvolveEvent", () => {
  it("resets the buffer on a start event", () => {
    const start = event("start");
    expect(appendEvolveEvent([event("editing"), event("thinking")], start)).toEqual([start]);
  });

  it("appends semantic events as-is", () => {
    const editing = event("editing");
    const buildPass = event("buildPass");
    expect(appendEvolveEvent([editing], buildPass)).toEqual([editing, buildPass]);
  });

  it("coalesces consecutive stream deltas into one event", () => {
    let events: EvolveEvent[] = [event("editing")];
    events = appendEvolveEvent(events, delta("The plain "));
    events = appendEvolveEvent(events, delta("vim package "));
    events = appendEvolveEvent(events, delta("is best."));
    expect(events).toHaveLength(2);
    expect(events[1].detail).toEqual({
      type: "streamDelta",
      text: "The plain vim package is best.",
    });
  });

  it("coalesces consecutive build output chunks into one event", () => {
    let events: EvolveEvent[] = [event("toolCall")];
    events = appendEvolveEvent(events, chunk("evaluating flake\n"));
    events = appendEvolveEvent(events, chunk("copying sources\n"));
    expect(events).toHaveLength(2);
    expect(events[1].detail).toEqual({
      type: "buildOutput",
      chunk: "evaluating flake\ncopying sources\n",
    });
  });

  it("caps coalesced stream text to a tail", () => {
    let events: EvolveEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events = appendEvolveEvent(events, delta("x".repeat(100)));
    }
    expect(events).toHaveLength(1);
    const detail = events[0].detail;
    expect(detail?.type === "streamDelta" && detail.text.length).toBe(2000);
  });

  it("caps coalesced build output to a line tail", () => {
    let events: EvolveEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const lines = Array.from({ length: 20 }, (_, j) => `line ${i}-${j}`).join("\n");
      events = appendEvolveEvent(events, chunk(`${lines}\n`));
    }
    expect(events).toHaveLength(1);
    const detail = events[0].detail;
    expect(detail?.type === "buildOutput" && detail.chunk.split("\n").length).toBeLessThanOrEqual(
      500,
    );
  });

  it("does not merge across a stream reset marker", () => {
    const reset = event("streamDelta", "Response interrupted; retrying...", {
      type: "streamReset",
    });
    let events: EvolveEvent[] = [delta("abandoned")];
    events = appendEvolveEvent(events, reset);
    events = appendEvolveEvent(events, delta("fresh"));
    expect(events).toHaveLength(3);
    expect(events[1].detail?.type).toBe("streamReset");
    expect(events[2].detail).toEqual({ type: "streamDelta", text: "fresh" });
  });

  it("does not merge stream text with build output", () => {
    let events: EvolveEvent[] = [delta("thinking text")];
    events = appendEvolveEvent(events, chunk("evaluating\n"));
    expect(events).toHaveLength(2);
  });
});
