import { describe, expect, it } from "vitest";
import type { EvolveEvent, EvolveEventType } from "@/ipc/types";
import { isVisibleEvent } from "./evolve-progress";

function event(eventType: EvolveEventType, raw = ""): EvolveEvent {
  return { eventType, raw, summary: "", iteration: 1, timestampMs: 0 };
}

describe("isVisibleEvent", () => {
  it("hides loop machinery events", () => {
    expect(isVisibleEvent(event("iteration"))).toBe(false);
    expect(isVisibleEvent(event("apiRequest"))).toBe(false);
    expect(isVisibleEvent(event("apiResponse"))).toBe(false);
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
