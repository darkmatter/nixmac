import { describe, expect, it } from "vitest";
import type { EvolveEvent, EvolveEventDetail, EvolveEventType } from "@/ipc/types";
import { answeredTextFor, getTokenProgress, isVisibleEvent } from "./evolve-progress";

function event(eventType: EvolveEventType, raw = "", detail?: EvolveEventDetail): EvolveEvent {
  return { eventType, raw, summary: "", iteration: 1, timestampMs: 0, detail };
}

describe("isVisibleEvent", () => {
  it("hides loop machinery events", () => {
    expect(isVisibleEvent(event("iteration"))).toBe(false);
    expect(isVisibleEvent(event("apiRequest"))).toBe(false);
    expect(isVisibleEvent(event("apiResponse"))).toBe(false);
  });

  it("hides answered events, which render inside the question card", () => {
    expect(isVisibleEvent(event("answered"))).toBe(false);
  });

  it("shows narration events", () => {
    expect(isVisibleEvent(event("narration"))).toBe(true);
  });

  it("prefers the structured detail for the tool name", () => {
    const hidden = event("toolCall", "", { type: "toolCall", tool: "think", args: {} });
    const shown = event("toolCall", "", { type: "toolCall", tool: "search_docs", args: {} });
    expect(isVisibleEvent(hidden)).toBe(false);
    expect(isVisibleEvent(shown)).toBe(true);
  });

  it("shows goal-relevant events", () => {
    for (const type of [
      "start",
      "thinking",
      "reading",
      "editing",
      "searchPackages",
      "buildPass",
      "buildFail",
      "question",
      "error",
      "info",
      "summarizing",
      "complete",
    ] as const) {
      expect(isVisibleEvent(event(type))).toBe(true);
    }
  });

  it("hides tool calls that are followed by a specific event", () => {
    expect(isVisibleEvent(event("toolCall", 'think | args: category="planning"'))).toBe(false);
    expect(isVisibleEvent(event("toolCall", 'read_file | args: path="flake.nix"'))).toBe(false);
    expect(isVisibleEvent(event("toolCall", 'edit_nix_file | args: path="flake.nix"'))).toBe(false);
  });

  it("shows tool calls for slow tools and tools without a follow-up event", () => {
    expect(isVisibleEvent(event("toolCall", "build_check | args: "))).toBe(true);
    expect(isVisibleEvent(event("toolCall", 'search_packages | args: query="spotify"'))).toBe(true);
    expect(isVisibleEvent(event("toolCall", 'search_docs | args: query="casks"'))).toBe(true);
    expect(isVisibleEvent(event("toolCall", 'search_code | args: pattern="brew"'))).toBe(true);
    expect(isVisibleEvent(event("toolCall", 'list_files | args: pattern="**/*"'))).toBe(true);
  });

  it("shows tool calls for unknown tools", () => {
    expect(isVisibleEvent(event("toolCall", "future_tool | args: "))).toBe(true);
  });
});

describe("getTokenProgress", () => {
  it("returns the latest progress detail", () => {
    const events = [
      event("apiResponse", "", {
        type: "progress",
        tokens: 1000,
        budget: 500_000,
        iteration: 1,
        limit: 50,
      }),
      event("thinking"),
      event("apiResponse", "", {
        type: "progress",
        tokens: 2500,
        budget: 500_000,
        iteration: 2,
        limit: 50,
      }),
    ];
    expect(getTokenProgress(events)).toEqual({ total: 2500, budget: 500_000 });
  });

  it("returns null when no progress detail was received", () => {
    expect(getTokenProgress([event("apiResponse", "tokens used: 999")])).toBeNull();
  });
});

describe("answeredTextFor", () => {
  const question = event("question");
  const answer = event("answered", "", { type: "answered", text: "spotify" });

  it("pairs a question with the answered event that follows it", () => {
    const events = [event("start"), question, answer, event("editing")];
    expect(answeredTextFor(events, question)).toBe("spotify");
  });

  it("returns null while the question is still pending", () => {
    expect(answeredTextFor([event("start"), question], question)).toBeNull();
  });

  it("does not cross into the next question's answer", () => {
    const q2 = event("question", "second");
    const events = [question, q2, answer];
    expect(answeredTextFor(events, question)).toBeNull();
    expect(answeredTextFor(events, q2)).toBe("spotify");
  });
});
