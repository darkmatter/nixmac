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

  it("shows the final timestamp without ticking when not generating", async () => {
    render(<EvolveProgress events={[event(10_000)]} isGenerating={false} />);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByText("10s").length).toBeGreaterThan(0);
    expect(screen.queryByText("15s")).toBeNull();
  });
});
