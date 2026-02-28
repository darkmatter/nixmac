/**
 * Hook to listen for Rust panic events and automatically show the feedback dialog
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useWidgetStore } from "@/stores/widget-store";
import { FeedbackType } from "@/types/feedback";

export interface RustPanicEvent {
  message: string;
  location?: string;
  backtrace?: string;
  timestamp: string;
}

export function usePanicHandler() {
  const { setError, openFeedback, setPanicDetails } = useWidgetStore();

  useEffect(() => {
    const unlisten = listen<RustPanicEvent>("rust:panic", (event) => {
      const panic = event.payload;

      // Log the panic to console for debugging
      console.error("Panic caught:", panic);

      // Store the full panic details for feedback submission
      setPanicDetails(panic);

      // Format error message for display
      const errorMessage = `Application Error: ${panic.message}${
        panic.location ? `\n\nLocation: ${panic.location}` : ""
      }${
        panic.backtrace
          ? `\n\nBacktrace available - see console or submit feedback for details`
          : ""
      }`;

      setError(errorMessage);

      // Show a toast notification to explain why the dialog is opening.
      // Necessary because the dialog will probably obscure the error message
      // in the main window, and we want to make sure users understand what's happening.
      toast.error("Application Crash Detected", {
        description: "The application encountered an unexpected error. Please report this issue.",
        duration: 10000,
      });

      // Automatically open the feedback dialog with Error type and pre-filled error details
      // This gives the user an immediate way to report the crash
      openFeedback(FeedbackType.Error, errorMessage);
    });

    // Cleanup listener on unmount
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setError, openFeedback, setPanicDetails]);
}
