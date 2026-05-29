import { describe, expect, it } from "vitest";
import { createUiStore } from "@/stores/ui-store";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createUiStore — initial state", () => {
  it("uses the documented defaults when no overrides are passed", () => {
    const store = createUiStore();
    const s = store.getState();

    expect(s.evolvePrompt).toBe("");
    expect(s.isProcessing).toBe(false);
    expect(s.processingAction).toBeNull();
    expect(s.settingsOpen).toBe(false);
    expect(s.settingsActiveTab).toBeNull();
    expect(s.showHistory).toBe(false);
    expect(s.showFilesystem).toBe(false);
    expect(s.filesystemTargetSection).toBeNull();
    expect(s.editingFile).toBeNull();
    expect(s.promptHistory).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setProcessing — clears action when not processing
// ---------------------------------------------------------------------------

describe("setProcessing", () => {
  it("sets isProcessing=true with the provided action", () => {
    const store = createUiStore();
    store.getState().setProcessing(true, "evolve");
    const s = store.getState();
    expect(s.isProcessing).toBe(true);
    expect(s.processingAction).toBe("evolve");
  });

  it("clears processingAction to null when isProcessing=false, regardless of the 2nd arg", () => {
    const store = createUiStore();
    store.getState().setProcessing(true, "apply");
    store.getState().setProcessing(false, "apply");
    const s = store.getState();
    expect(s.isProcessing).toBe(false);
    expect(s.processingAction).toBeNull();
  });

  it("defaults action to null when omitted", () => {
    const store = createUiStore();
    store.getState().setProcessing(true);
    expect(store.getState().processingAction).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

describe("setSettingsOpen", () => {
  it("toggles and stores the active tab", () => {
    const store = createUiStore();
    store.getState().setSettingsOpen(true, "api-keys");
    let s = store.getState();
    expect(s.settingsOpen).toBe(true);
    expect(s.settingsActiveTab).toBe("api-keys");

    store.getState().setSettingsOpen(false);
    s = store.getState();
    expect(s.settingsOpen).toBe(false);
    expect(s.settingsActiveTab).toBeNull();
  });
});
