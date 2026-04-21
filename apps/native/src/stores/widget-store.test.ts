import type { EvolveEvent, GitStatus } from "@/tauri-api";
import { describe, expect, it } from "vitest";
import {
  createWidgetStore,
  initialRebuildState,
  type RebuildLine,
} from "./widget-store";

// ---------------------------------------------------------------------------
// createWidgetStore() — factory + initial state
// ---------------------------------------------------------------------------

describe("createWidgetStore — initial state", () => {
  it("uses the documented defaults when no overrides are passed", () => {
    const store = createWidgetStore();
    const s = store.getState();

    expect(s.configDir).toBe("");
    expect(s.hosts).toEqual([]);
    expect(s.host).toBe("");
    expect(s.permissionsChecked).toBe(false);
    expect(s.permissionsState).toBeNull();
    expect(s.nixInstalled).toBeNull();
    expect(s.darwinRebuildAvailable).toBeNull();
    expect(s.isProcessing).toBe(false);
    expect(s.processingAction).toBeNull();
    expect(s.evolveEvents).toEqual([]);
    expect(s.consoleLogs).toBe("");
    expect(s.rebuild).toEqual(initialRebuildState);
    // recommendedPrompt distinguishes "never fetched" (undefined) from "none" (null).
    expect(s.recommendedPrompt).toBeUndefined();
    // confirmation prefs default on for safety.
    expect(s.confirmBuild).toBe(true);
    expect(s.confirmClear).toBe(true);
    expect(s.confirmRollback).toBe(true);
    // analyzing-hash set starts empty but is an actual Set.
    expect(s.analyzingHistoryForHashes).toBeInstanceOf(Set);
    expect(s.analyzingHistoryForHashes.size).toBe(0);
  });

  it("merges initialState overrides over the defaults", () => {
    const store = createWidgetStore({
      configDir: "/Users/me/.darwin",
      hosts: ["mbp"],
      host: "mbp",
      permissionsChecked: true,
    });
    const s = store.getState();
    expect(s.configDir).toBe("/Users/me/.darwin");
    expect(s.hosts).toEqual(["mbp"]);
    expect(s.host).toBe("mbp");
    expect(s.permissionsChecked).toBe(true);
    // Unrelated defaults are preserved.
    expect(s.evolvePrompt).toBe("");
    expect(s.rebuild).toEqual(initialRebuildState);
  });

  it("creates independent store instances (no shared state across factory calls)", () => {
    const a = createWidgetStore();
    const b = createWidgetStore();
    a.getState().setConfigDir("/a");
    b.getState().setConfigDir("/b");
    expect(a.getState().configDir).toBe("/a");
    expect(b.getState().configDir).toBe("/b");
  });
});

// ---------------------------------------------------------------------------
// Simple setters
// ---------------------------------------------------------------------------

describe("widget store — simple setters", () => {
  it("setConfigDir / setHosts / setHost update their respective fields", () => {
    const store = createWidgetStore();
    store.getState().setConfigDir("/etc/nix-darwin");
    store.getState().setHosts(["one", "two"]);
    store.getState().setHost("one");

    const s = store.getState();
    expect(s.configDir).toBe("/etc/nix-darwin");
    expect(s.hosts).toEqual(["one", "two"]);
    expect(s.host).toBe("one");
  });

  it("setError stores the message and can clear it with null", () => {
    const store = createWidgetStore();
    store.getState().setError("boom");
    expect(store.getState().error).toBe("boom");
    store.getState().setError(null);
    expect(store.getState().error).toBeNull();
  });

  it("setGitStatus stores the provided git status", () => {
    const store = createWidgetStore();
    const gitStatus: GitStatus = {
      hasChanges: true,
      files: [],
    } as unknown as GitStatus;
    store.getState().setGitStatus(gitStatus);
    expect(store.getState().gitStatus).toBe(gitStatus);
  });
});

// ---------------------------------------------------------------------------
// setProcessing — clears action when not processing
// ---------------------------------------------------------------------------

describe("setProcessing", () => {
  it("sets isProcessing=true with the provided action", () => {
    const store = createWidgetStore();
    store.getState().setProcessing(true, "evolve");
    const s = store.getState();
    expect(s.isProcessing).toBe(true);
    expect(s.processingAction).toBe("evolve");
  });

  it("clears processingAction to null when isProcessing=false, regardless of the 2nd arg", () => {
    const store = createWidgetStore();
    store.getState().setProcessing(true, "apply");
    store.getState().setProcessing(false, "apply");
    const s = store.getState();
    expect(s.isProcessing).toBe(false);
    expect(s.processingAction).toBeNull();
  });

  it("defaults action to null when omitted", () => {
    const store = createWidgetStore();
    store.getState().setProcessing(true);
    expect(store.getState().processingAction).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confirmation preferences
// ---------------------------------------------------------------------------

describe("confirmation preferences", () => {
  it("setConfirmPref updates only the targeted key", () => {
    const store = createWidgetStore();
    store.getState().setConfirmPref("confirmBuild", false);
    const s = store.getState();
    expect(s.confirmBuild).toBe(false);
    expect(s.confirmClear).toBe(true);
    expect(s.confirmRollback).toBe(true);
  });

  it("initConfirmPrefs fills missing keys with true", () => {
    const store = createWidgetStore();
    store.getState().initConfirmPrefs({ confirmBuild: false });
    const s = store.getState();
    expect(s.confirmBuild).toBe(false);
    // missing keys -> default true
    expect(s.confirmClear).toBe(true);
    expect(s.confirmRollback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// analyzingHistoryForHashes — immutable Set updates
// ---------------------------------------------------------------------------

describe("analyzingHistoryForHashes", () => {
  it("adds a hash to the set without mutating the previous Set instance", () => {
    const store = createWidgetStore();
    const before = store.getState().analyzingHistoryForHashes;

    store.getState().addAnalyzingHistoryHash("abc");

    const after = store.getState().analyzingHistoryForHashes;
    expect(after).not.toBe(before); // new Set reference (no in-place mutation)
    expect(before.has("abc")).toBe(false);
    expect(after.has("abc")).toBe(true);
  });

  it("removeAnalyzingHistoryHash removes only that hash", () => {
    const store = createWidgetStore();
    store.getState().addAnalyzingHistoryHash("a");
    store.getState().addAnalyzingHistoryHash("b");
    store.getState().removeAnalyzingHistoryHash("a");

    const s = store.getState().analyzingHistoryForHashes;
    expect(s.has("a")).toBe(false);
    expect(s.has("b")).toBe(true);
  });

  it("removing a hash that isn't present is a no-op", () => {
    const store = createWidgetStore();
    expect(() => store.getState().removeAnalyzingHistoryHash("nope")).not.toThrow();
    expect(store.getState().analyzingHistoryForHashes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Console log buffer
// ---------------------------------------------------------------------------

describe("console log buffer", () => {
  it("appendLog concatenates, clearLogs resets", () => {
    const store = createWidgetStore();
    store.getState().appendLog("hello ");
    store.getState().appendLog("world");
    expect(store.getState().consoleLogs).toBe("hello world");

    store.getState().clearLogs();
    expect(store.getState().consoleLogs).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Evolve events
// ---------------------------------------------------------------------------

describe("evolve events", () => {
  it("appendEvolveEvent pushes events in order, clearEvolveEvents empties them", () => {
    const store = createWidgetStore();
    const e1 = { type: "start" } as unknown as EvolveEvent;
    const e2 = { type: "end" } as unknown as EvolveEvent;
    store.getState().appendEvolveEvent(e1);
    store.getState().appendEvolveEvent(e2);
    expect(store.getState().evolveEvents).toEqual([e1, e2]);

    store.getState().clearEvolveEvents();
    expect(store.getState().evolveEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rebuild lifecycle
// ---------------------------------------------------------------------------

describe("rebuild lifecycle", () => {
  it("startRebuild seeds a running state with a 'Preparing rebuild...' info line", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("apply");
    const r = store.getState().rebuild;
    expect(r.isRunning).toBe(true);
    expect(r.context).toBe("apply");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].type).toBe("info");
    expect(r.lines[0].text).toMatch(/preparing/i);
    expect(r.rawLines).toEqual([]);
    expect(r.success).toBeUndefined();
  });

  it("appendRebuildLine caps buffered lines at 50", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("apply");
    for (let i = 0; i < 60; i++) {
      const line: RebuildLine = { id: i + 1, text: `line ${i}`, type: "stdout" };
      store.getState().appendRebuildLine(line);
    }
    const lines = store.getState().rebuild.lines;
    expect(lines).toHaveLength(50);
    // Oldest lines fall off the front; most recent 50 remain.
    expect(lines[0].text).toBe("line 10");
    expect(lines[lines.length - 1].text).toBe("line 59");
  });

  it("appendRawLine caps raw lines at 500", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("rollback");
    for (let i = 0; i < 600; i++) {
      store.getState().appendRawLine(`raw ${i}`);
    }
    const raw = store.getState().rebuild.rawLines;
    expect(raw).toHaveLength(500);
    expect(raw[0]).toBe("raw 100");
    expect(raw[raw.length - 1]).toBe("raw 599");
  });

  it("setRebuildError attaches error details without stopping the run", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("apply");
    store.getState().setRebuildError("build_error", "derivation foo failed");
    const r = store.getState().rebuild;
    expect(r.errorType).toBe("build_error");
    expect(r.errorMessage).toBe("derivation foo failed");
    // setRebuildError shouldn't flip isRunning on its own — that's setRebuildComplete's job.
    expect(r.isRunning).toBe(true);
  });

  it("setRebuildComplete flips isRunning off and records success/exitCode", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("apply");
    store.getState().setRebuildComplete(true, 0);
    const r = store.getState().rebuild;
    expect(r.isRunning).toBe(false);
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("clearRebuild resets back to initialRebuildState", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("apply");
    store.getState().appendRebuildLine({ id: 1, text: "x", type: "stdout" });
    store.getState().clearRebuild();
    expect(store.getState().rebuild).toEqual(initialRebuildState);
  });
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

describe("UI helpers", () => {
  it("setSettingsOpen toggles and stores the active tab", () => {
    const store = createWidgetStore();
    store.getState().setSettingsOpen(true, "api-keys");
    let s = store.getState();
    expect(s.settingsOpen).toBe(true);
    expect(s.settingsActiveTab).toBe("api-keys");

    store.getState().setSettingsOpen(false);
    s = store.getState();
    expect(s.settingsOpen).toBe(false);
    expect(s.settingsActiveTab).toBeNull();
  });

  it("openFeedback seeds type + initial text and opens the panel", () => {
    const store = createWidgetStore();
    store.getState().openFeedback("bug" as never, "something broke");
    const s = store.getState();
    expect(s.feedbackOpen).toBe(true);
    expect(s.feedbackTypeOverride).toBe("bug");
    expect(s.feedbackInitialText).toBe("something broke");
  });

  it("clearPreview wipes changeMap and summaryAvailable", () => {
    const store = createWidgetStore({
      changeMap: { foo: "bar" } as never,
      summaryAvailable: true,
    });
    store.getState().clearPreview();
    const s = store.getState();
    expect(s.changeMap).toBeNull();
    expect(s.summaryAvailable).toBe(false);
  });
});
