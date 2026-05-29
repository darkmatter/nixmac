import { describe, expect, it } from "vitest";
import { createFeedbackStore } from "@/stores/feedback-store";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("createFeedbackStore — initial state", () => {
  it("uses the documented defaults when no overrides are passed", () => {
    const store = createFeedbackStore();
    const s = store.getState();

    expect(s.error).toBeNull();
    expect(s.feedbackOpen).toBe(false);
    expect(s.feedbackTypeOverride).toBeNull();
    expect(s.feedbackInitialText).toBeNull();
    expect(s.panicDetails).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setError
// ---------------------------------------------------------------------------

describe("setError", () => {
  it("stores the message and can clear it with null", () => {
    const store = createFeedbackStore();
    store.getState().setError("boom");
    expect(store.getState().error).toBe("boom");
    store.getState().setError(null);
    expect(store.getState().error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// openFeedback
// ---------------------------------------------------------------------------

describe("openFeedback", () => {
  it("seeds type + initial text and opens the panel", () => {
    const store = createFeedbackStore();
    store.getState().openFeedback("bug" as never, "something broke");
    const s = store.getState();
    expect(s.feedbackOpen).toBe(true);
    expect(s.feedbackTypeOverride).toBe("bug");
    expect(s.feedbackInitialText).toBe("something broke");
  });
});
