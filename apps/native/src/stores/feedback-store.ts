import { FeedbackType } from "@/types/feedback";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

type PanicDetails = {
  message: string;
  location?: string;
  backtrace?: string;
  timestamp: string;
} | null;

export type FeedbackState = {
  error: string | null;
  feedbackOpen: boolean;
  feedbackTypeOverride: FeedbackType | null;
  feedbackInitialText: string | null;
  panicDetails: PanicDetails;
};

export type FeedbackActions = {
  setError: (error: string | null) => void;
  setFeedbackOpen: (open: boolean) => void;
  setFeedbackTypeOverride: (type: FeedbackType | null) => void;
  openFeedback: (type?: FeedbackType, initialText?: string) => void;
  setPanicDetails: (details: PanicDetails) => void;
};

export type FeedbackStore = FeedbackState & FeedbackActions;

const initialErrorFeedbackState: FeedbackState = {
  error: null,
  feedbackOpen: false,
  feedbackTypeOverride: null,
  feedbackInitialText: null,
  panicDetails: null,
};

export function createFeedbackStore(initial?: Partial<FeedbackStore>) {
  return create<FeedbackStore>()(
    devtools(
      (set) => ({
        ...initialErrorFeedbackState,
        ...initial,

        setError: (error) => set({ error }),
        setFeedbackOpen: (feedbackOpen) => set({ feedbackOpen }),
        setFeedbackTypeOverride: (feedbackTypeOverride) =>
          set({ feedbackTypeOverride }),
        openFeedback: (type, initialText) =>
          set({
            feedbackOpen: true,
            feedbackTypeOverride: type ?? null,
            feedbackInitialText: initialText ?? null,
          }),
        setPanicDetails: (panicDetails) => set({ panicDetails }),
      }),
      { name: "feedback-store", enabled: import.meta.env.DEV },
    ),
  );
}

export const useFeedbackStore = createFeedbackStore();
