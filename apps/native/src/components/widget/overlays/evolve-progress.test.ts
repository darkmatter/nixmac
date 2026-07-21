import { describe, expect, it } from "vitest";
import type { EvolveEvent, EvolveEventDetail, EvolveEventType } from "@/ipc/types";
import {
  answeredTextFor,
  getFocusState,
  getPendingQuestion,
  getTokenProgress,
  isVisibleEvent,
  trailingBuildLog,
  trailingStreamText,
} from "./evolve-progress";

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

  it("hides streamed build output chunks, which render under the active row", () => {
    expect(isVisibleEvent(event("buildCheck"))).toBe(false);
  });

  it("hides streamed response slices, which render as the active row's typewriter tail", () => {
    expect(isVisibleEvent(event("streamDelta"))).toBe(false);
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

describe("getPendingQuestion", () => {
  const question = event("question");

  it("finds the question the run is blocked on", () => {
    expect(getPendingQuestion([event("start"), question])).toBe(question);
  });

  it("ignores questions that have been answered", () => {
    const events = [question, event("answered", "", { type: "answered", text: "yes" })];
    expect(getPendingQuestion(events)).toBeNull();
  });

  it("returns null when no question was ever asked", () => {
    expect(getPendingQuestion([event("start"), event("thinking")])).toBeNull();
  });
});

describe("getFocusState", () => {
  it("switches to needs-you mode on a pending question", () => {
    const question = event("question", "", {
      type: "question",
      text: "Which variant?",
      choices: ["a", "b"],
      kind: "agent",
    });
    const focus = getFocusState([event("start"), question]);
    expect(focus.mode).toBe("needsYou");
    expect(focus.event).toBe(question);
    expect(focus.headline).toBe("Which variant?");
  });

  it("shows current narration text in working mode", () => {
    const narration: EvolveEvent = {
      ...event("narration", "", { type: "narration", text: "The plain vim package is best. I'll add it." }),
      summary: "The plain vim package is best.",
    };
    const focus = getFocusState([event("start"), narration]);
    expect(focus.mode).toBe("working");
    expect(focus.headline).toBe("The plain vim package is best.");
    expect(focus.detailText).toBe("The plain vim package is best. I'll add it.");
  });

  it("collapses narration once superseded by a later event", () => {
    const narration = event("narration", "", { type: "narration", text: "Adding it now." });
    const editing: EvolveEvent = { ...event("editing"), summary: "Adding vim to systemPackages" };
    const focus = getFocusState([narration, editing]);
    expect(focus.mode).toBe("waiting");
    expect(focus.headline).toBe("Adding vim to systemPackages");
    expect(focus.detailText).toBeNull();
  });

  it("skips detail text that repeats the headline", () => {
    const narration: EvolveEvent = {
      ...event("narration", "", { type: "narration", text: "Short thought." }),
      summary: "Short thought.",
    };
    expect(getFocusState([narration]).detailText).toBeNull();
  });

  it("narrates the latest visible event, not hidden machinery", () => {
    const editing: EvolveEvent = { ...event("editing"), summary: "Adding vim" };
    const focus = getFocusState([editing, event("apiRequest"), event("iteration")]);
    expect(focus.mode).toBe("waiting");
    expect(focus.headline).toBe("Adding vim");
  });

  it("waits with a generic headline before any event arrives", () => {
    const focus = getFocusState([]);
    expect(focus.mode).toBe("waiting");
    expect(focus.event).toBeNull();
    expect(focus.headline).toBe("Working...");
  });

  it("types the streamed response into its own active row", () => {
    const editing: EvolveEvent = { ...event("editing"), summary: "Adding vim" };
    const delta = event("streamDelta", "", {
      type: "streamDelta",
      text: "The plain vim package is what we want.",
    });
    const focus = getFocusState([event("start"), editing, delta]);
    expect(focus.mode).toBe("working");
    // event: null → the stream renders as the placeholder row after the
    // last completed action, which keeps its own plain row.
    expect(focus.event).toBeNull();
    expect(focus.headline).toBe("Thinking...");
    expect(focus.detailText).toBe("The plain vim package is what we want.");
  });

  it("shows the streamed build log while a check runs", () => {
    const toolCall: EvolveEvent = {
      ...event("toolCall", "", { type: "toolCall", tool: "build_check", args: {} }),
      summary: "Checking the configuration builds...",
    };
    const chunk = event("buildCheck", "evaluating flake\n", {
      type: "buildOutput",
      chunk: "evaluating flake\n",
    });
    const focus = getFocusState([event("start"), toolCall, chunk]);
    expect(focus.mode).toBe("working");
    expect(focus.headline).toBe("Checking the configuration builds...");
    expect(focus.buildLog).toEqual(["evaluating flake"]);
    expect(focus.detailText).toBeNull();
  });
});

describe("trailingBuildLog", () => {
  const chunk = (text: string) => event("buildCheck", text, { type: "buildOutput", chunk: text });

  it("returns null when the latest activity is not a build check", () => {
    expect(trailingBuildLog([event("start"), event("editing")])).toBeNull();
    expect(trailingBuildLog([])).toBeNull();
  });

  it("collects trailing chunks into ordered lines", () => {
    const events = [
      event("start"),
      event("toolCall"),
      chunk("evaluating flake\ncopying sources\n"),
      chunk("these 4 derivations will be built:\n"),
    ];
    expect(trailingBuildLog(events)).toEqual([
      "evaluating flake",
      "copying sources",
      "these 4 derivations will be built:",
    ]);
  });

  it("ends the log once any other event follows the chunks", () => {
    const events = [chunk("evaluating flake\n"), event("buildPass")];
    expect(trailingBuildLog(events)).toBeNull();
  });

  it("caps retained lines at the ring-buffer limit", () => {
    const big = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
    const log = trailingBuildLog([chunk(big)]);
    expect(log).toHaveLength(500);
    expect(log?.[0]).toBe("line 100");
    expect(log?.[499]).toBe("line 599");
  });
});

describe("trailingStreamText", () => {
  const delta = (text: string) => event("streamDelta", text, { type: "streamDelta", text });

  it("returns null when nothing is streaming", () => {
    expect(trailingStreamText([event("start"), event("editing")])).toBeNull();
    expect(trailingStreamText([])).toBeNull();
  });

  it("joins trailing deltas in order", () => {
    const events = [event("start"), delta("The nixpkgs build "), delta("is broken on darwin.")];
    expect(trailingStreamText(events)).toBe("The nixpkgs build is broken on darwin.");
  });

  it("ends the stream once any other event follows", () => {
    expect(trailingStreamText([delta("partial"), event("narration")])).toBeNull();
  });

  it("clips long streams to a tail with a leading ellipsis", () => {
    const text = trailingStreamText([delta("x".repeat(400))]);
    expect(text).toHaveLength(321);
    expect(text?.startsWith("…")).toBe(true);
  });

  it("discards the abandoned attempt at a provider retry marker", () => {
    const reset = event("streamDelta", "Response interrupted; retrying...", {
      type: "streamReset",
    });
    const events = [
      delta("half a response that will be discarded"),
      reset,
      delta("→ Response interrupted; retrying...\n"),
      delta("fresh attempt"),
    ];
    expect(trailingStreamText(events)).toBe(
      "→ Response interrupted; retrying...\nfresh attempt",
    );
  });

  it("collapses blank lines between thoughts and tool announcements", () => {
    const events = [
      delta("Need vim installed.\n"),
      delta("\n→ Searching packages...\n"),
      delta("\n→ Editing configuration...\n"),
    ];
    expect(trailingStreamText(events)).toBe(
      "Need vim installed.\n→ Searching packages...\n→ Editing configuration...\n",
    );
  });

  it("drops a leading blank line when an announcement starts the stream", () => {
    expect(trailingStreamText([delta("\n→ Reading file...\n")])).toBe("→ Reading file...\n");
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
