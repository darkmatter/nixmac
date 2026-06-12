import type { EvolveEvent } from "@/ipc/types";
import { describe, expect, it } from "vitest";
import { createWidgetStore } from "./widget-store";
import { initialRebuildState, type RebuildLine } from "@/types/rebuild";

// ---------------------------------------------------------------------------
// createWidgetStore() — factory + initial state
// ---------------------------------------------------------------------------

describe("createWidgetStore — initial state", () => {
  it("uses the documented defaults when no overrides are passed", () => {
    const store = createWidgetStore();
    const s = store.getState();

    expect(s.nixInstalled).toBeNull();
    expect(s.darwinRebuildAvailable).toBeNull();
    expect(s.evolveEvents).toEqual([]);
    expect(s.rebuild).toEqual(initialRebuildState);
    expect(s.conversationalResponse).toBeNull();
    expect(s.evolutionTelemetry).toBeNull();
  });

  it("merges initialState overrides over the defaults", () => {
    const store = createWidgetStore({
      nixInstalled: true,
      darwinRebuildAvailable: true,
    });
    const s = store.getState();
    expect(s.nixInstalled).toBe(true);
    expect(s.darwinRebuildAvailable).toBe(true);
    // Unrelated defaults are preserved.
    expect(s.evolveEvents).toEqual([]);
    expect(s.rebuild).toEqual(initialRebuildState);
  });

  it("creates independent store instances (no shared state across factory calls)", () => {
    const a = createWidgetStore();
    const b = createWidgetStore();
    a.getState().setNixInstalled(true);
    b.getState().setNixInstalled(false);
    expect(a.getState().nixInstalled).toBe(true);
    expect(b.getState().nixInstalled).toBe(false);
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

  it("setRebuildError records whether the system was untouched", () => {
    const store = createWidgetStore();
    store.getState().startRebuild("apply");
    store.getState().setRebuildError("build_error", "derivation foo failed", true);

    expect(store.getState().rebuild.systemUntouched).toBe(true);
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

