import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvolveEvent } from "@/ipc/types";
import { EvolveProgress } from "./evolve-progress";

vi.mock("@/lib/orpc", () => ({ client: { darwin: { evolveAnswer: vi.fn() } } }));

function event(timestampMs: number): EvolveEvent {
  return {
    eventType: "thinking",
    summary: `Thought at ${timestampMs}.`,
    raw: "",
    iteration: 1,
    timestampMs,
  };
}

describe("EvolveProgress elapsed clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every second while generating without new events", async () => {
    render(<EvolveProgress events={[event(10_000)]} isGenerating={true} />);
    expect(screen.getAllByText("10s").length).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getAllByText("13s").length).toBeGreaterThan(0);
  });

  it("resumes from the new event's timestamp when one arrives", async () => {
    const { rerender } = render(<EvolveProgress events={[event(10_000)]} isGenerating={true} />);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<EvolveProgress events={[event(10_000), event(20_000)]} isGenerating={true} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByText("22s").length).toBeGreaterThan(0);
  });

  it("keeps the step timer running while stream chunks arrive", async () => {
    const { rerender } = render(<EvolveProgress events={[event(10_000)]} isGenerating={true} />);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    // Streamed chunks arrive every ~120ms; they must not restart the
    // active-step clock (only semantic events do).
    const delta: EvolveEvent = {
      eventType: "streamDelta",
      summary: "Thinking...",
      raw: "hello",
      iteration: 1,
      timestampMs: 13_000,
      detail: { type: "streamDelta", text: "hello" },
    };
    rerender(<EvolveProgress events={[event(10_000), delta]} isGenerating={true} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    // Step timer: 3s before the chunk + 2s after = 5s (the pre-fix behavior
    // would show 2s, re-anchored at the chunk).
    expect(screen.getAllByText("5s").length).toBeGreaterThan(0);
  });

  it("re-anchors the header clock when a coalesced event replaces the last one", async () => {
    const delta = (timestampMs: number): EvolveEvent => ({
      eventType: "streamDelta",
      summary: "Thinking...",
      raw: "chunk",
      iteration: 1,
      timestampMs,
      detail: { type: "streamDelta", text: "chunk" },
    });
    const { rerender } = render(
      <EvolveProgress events={[event(10_000), delta(13_000)]} isGenerating={true} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    // The viewmodel coalesces stream chunks by REPLACING the last event
    // (same array length, newer backend timestamp). The header clock must
    // re-anchor on the replacement: 15s stamp + 2s wait = 17s — an anchor
    // keyed on array length would show 15 + 4 = 19s, double-counting.
    rerender(<EvolveProgress events={[event(10_000), delta(15_000)]} isGenerating={true} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByText("17s").length).toBeGreaterThan(0);
    expect(screen.queryByText("19s")).toBeNull();
  });

  it("shows the final timestamp without ticking when not generating", async () => {
    render(<EvolveProgress events={[event(10_000)]} isGenerating={false} />);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText("10s").length).toBeGreaterThan(0);
    expect(screen.queryByText("15s")).toBeNull();
  });
});
