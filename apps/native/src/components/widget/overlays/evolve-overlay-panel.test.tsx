import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvolveOverlayPanel } from "@/components/widget/overlays/evolve-overlay-panel";
import type { EvolveEvent } from "@/ipc/types";
import { initialUiState, uiActions, viewModelActions } from "@nixmac/state";

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      evolveCancel: vi.fn<() => Promise<void>>(),
      evolveAnswer: vi.fn<() => Promise<void>>(),
    },
  },
}));
vi.mock("@/viewmodel/evolution", () => ({ clearEvolveEvents: vi.fn<() => void>() }));

function event(eventType: EvolveEvent["eventType"], timestampMs = 0): EvolveEvent {
  return { eventType, summary: `${eventType} event`, raw: "", iteration: 1, timestampMs };
}

function setMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function startRun(events: EvolveEvent[]) {
  act(() => {
    viewModelActions.setState({ evolveEvents: events });
    uiActions.setState({ ...initialUiState, isGenerating: true });
  });
}

function endRun(events: EvolveEvent[]) {
  act(() => {
    viewModelActions.setState({ evolveEvents: events });
    uiActions.setState({ isGenerating: false });
  });
}

describe("<EvolveOverlayPanel> completion beat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMatchMedia(false);
    act(() => {
      viewModelActions.setState({ evolveEvents: [] });
      uiActions.setState({ ...initialUiState });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lingers on the completed state before dismissing", async () => {
    startRun([event("start")]);
    render(<EvolveOverlayPanel />);
    expect(screen.getByText("Evolving...")).toBeInTheDocument();

    endRun([event("start"), event("complete", 5000)]);
    expect(screen.getByText("Evolution Complete")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Evolution Complete")).not.toBeInTheDocument();
  });

  it("dismisses immediately when the run ends without a complete event", () => {
    startRun([event("start")]);
    render(<EvolveOverlayPanel />);

    endRun([event("start"), event("error", 5000)]);
    expect(screen.queryByText("Evolution Complete")).not.toBeInTheDocument();
  });

  it("skips the beat under prefers-reduced-motion", () => {
    setMatchMedia(true);
    startRun([event("start")]);
    render(<EvolveOverlayPanel />);

    endRun([event("start"), event("complete", 5000)]);
    expect(screen.queryByText("Evolution Complete")).not.toBeInTheDocument();
  });
});
