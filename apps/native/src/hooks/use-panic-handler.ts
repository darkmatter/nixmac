/**
 * Hook to listen for Rust panic events and automatically show the feedback dialog
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useUiState } from "@nixmac/state";
import type { RustPanicEvent } from "@/ipc/types";
import { FeedbackType } from "@/types/feedback";
import { getTelemetry } from "@/lib/telemetry/instance";

export function usePanicHandler() {
  const { setError, openFeedback, setPanicDetails } = useUiState();

  useEffect(() => {
    const unlisten = listen<RustPanicEvent>("rust:panic", (event) => {
      const panic = event.payload;

      // Log the panic to console for debugging
      console.error("Panic caught:", panic);

      getTelemetry().captureError(new Error(panic.message), {
        location: panic.location ?? undefined,
        source: "rust_panic",
      });

      // Store the full panic details for feedback submission
      setPanicDetails({
        message: panic.message,
        location: panic.location ?? undefined,
        backtrace: panic.backtrace ?? undefined,
        timestamp: panic.timestamp,
      });

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
    }).catch((error) => {
      if (import.meta.env.PROD) console.error("Panic listener unavailable:", error);
      return () => {};
    });

    // Cleanup listener on unmount
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setError, openFeedback, setPanicDetails]);
}
