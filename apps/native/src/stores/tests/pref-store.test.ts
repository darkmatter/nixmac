import { describe, expect, it } from "vitest";
import { createPrefStore } from "@/stores/pref-store";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createPrefStore — initial state", () => {
  it("uses the documented defaults when no overrides are passed", () => {
    const store = createPrefStore();
    const s = store.getState();

    // confirmation prefs default on for safety.
    expect(s.confirmBuild).toBe(true);
    expect(s.confirmClear).toBe(true);
    expect(s.confirmRollback).toBe(true);
    expect(s.scanHomebrewOnStartup).toBe(true);
    expect(s.autoSummarizeOnFocus).toBe(false);
    expect(s.defaultToDiffTab).toBe(false);
    expect(s.developerMode).toBe(false);
    expect(s.pinnedVersion).toBeNull();
    expect(s.updateChannel).toBe("stable");
    expect(s.prefsLoaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confirmation preferences
// ---------------------------------------------------------------------------

describe("confirmation preferences", () => {
  it("setBoolPref updates only the targeted key", () => {
    const store = createPrefStore();
    store.getState().setBoolPref("confirmBuild", false);
    const s = store.getState();
    expect(s.confirmBuild).toBe(false);
    expect(s.confirmClear).toBe(true);
    expect(s.confirmRollback).toBe(true);
  });

  it("initConfirmPrefs fills missing keys with true", () => {
    const store = createPrefStore();
    store.getState().initConfirmPrefs({ confirmBuild: false });
    const s = store.getState();
    expect(s.confirmBuild).toBe(false);
    // missing keys -> default true
    expect(s.confirmClear).toBe(true);
    expect(s.confirmRollback).toBe(true);
  });

  it("setBoolPref toggles scanHomebrewOnStartup", () => {
    const store = createPrefStore();
    store.getState().setBoolPref("scanHomebrewOnStartup", false);
    const s = store.getState();
    expect(s.scanHomebrewOnStartup).toBe(false);
    expect(s.confirmBuild).toBe(true);
  });
});
