// Storybook manual mock for the feedback store. Activated via
// `sb.mock(import("../stores/feedback-store"))` in `.storybook/preview.tsx`.
//
// The real store is delegated to for state; we just replace the dialog-opening
// actions with no-ops so a transient error in a story can't trigger
// FeedbackDialog (which has render edge cases that obscure the component
// under review).
//
// Inside `__mocks__`, the relative import resolves to the un-mocked original
// module — that's the manual-mock contract Storybook inherits from Vitest.
import { useFeedbackStore as realFeedbackStore } from "@/stores/feedback-store";

export type {
  FeedbackActions,
  FeedbackState,
  FeedbackStore,
} from "@/stores/feedback-store";

realFeedbackStore.setState({
  setFeedbackOpen: () => undefined,
  openFeedback: () => undefined,
});

export const useFeedbackStore = realFeedbackStore;
