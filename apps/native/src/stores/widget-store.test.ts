import { describe, expect, it } from "vitest";
import { createWidgetStore } from "./widget-store";

// ---------------------------------------------------------------------------
// createWidgetStore() — transitional empty shell
//
// All widget state has migrated to the ViewModel (backend-mirrored) and
// UiState (UI-owned) stores; their behavior is covered by
// `src/viewmodel/viewmodel.test.ts` and `src/stores/ui-state.test.ts`.
// ---------------------------------------------------------------------------

describe("createWidgetStore", () => {
  it("creates an empty store", () => {
    const store = createWidgetStore();
    expect(store.getState()).toEqual({});
  });

  it("creates independent store instances", () => {
    const a = createWidgetStore();
    const b = createWidgetStore();
    expect(a.getState()).not.toBe(b.getState());
  });
});
