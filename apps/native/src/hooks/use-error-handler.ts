/**
 * Hook to capture and handle unhandled JavaScript errors and promise rejections
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { useWidgetStore } from "@/stores/widget-store";
import { FeedbackType } from "@/types/feedback";

export interface JavaScriptErrorDetails {
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  timestamp: string;
  type: "error" | "unhandledrejection";
}

export function useErrorHandler() {
  const { setError, openFeedback, setPanicDetails } = useWidgetStore();

  useEffect(() => {
    // Handle uncaught errors
    const handleError = (event: ErrorEvent) => {
      console.error("Unhandled JavaScript error:", event);

      const errorDetails: JavaScriptErrorDetails = {
        message: event.message,
        stack: event.error?.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        timestamp: new Date().toISOString(),
        type: "error",
      };

      // Format error message for display
      const errorMessage = `Unhandled Error: ${event.message}${
        event.filename ? `\n\nFile: ${event.filename}:${event.lineno}:${event.colno}` : ""
      }${
        event.error?.stack
          ? `\n\nStack trace available - see console or submit feedback for details`
          : ""
      }`;

      // Set the error state
      setError(errorMessage);

      // Store error details as panic details (same structure as Rust panics for simplicity)
      setPanicDetails({
        message: event.message,
        location: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
        backtrace: event.error?.stack,
        timestamp: errorDetails.timestamp,
      });

      // Show toast notification in case we obscure the main window error message with the feedback dialog.
      toast.error("JavaScript Error Detected", {
        description: "The application encountered an unexpected error. Please report this issue.",
        duration: 10000,
      });

      openFeedback(FeedbackType.Error, errorMessage);

      event.preventDefault();
    };

    // Handle unhandled promise rejections
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", event);

      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;

      const errorDetails: JavaScriptErrorDetails = {
        message,
        stack,
        timestamp: new Date().toISOString(),
        type: "unhandledrejection",
      };

      // Format error message for display
      const errorMessage = `Unhandled Promise Rejection: ${message}${
        stack ? `\n\nStack trace available - see console or submit feedback for details` : ""
      }`;

      // Set the error state
      setError(errorMessage);

      // Store error details
      setPanicDetails({
        message,
        backtrace: stack,
        timestamp: errorDetails.timestamp,
      });

      // Show toast notification
      toast.error("Async Operation Failed", {
        description: "An asynchronous operation failed unexpectedly. Please report this issue.",
        duration: 10000,
      });

      openFeedback(FeedbackType.Error, errorMessage);

      event.preventDefault();
    };

    // Register event listeners
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    // Cleanup on unmount
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [setError, openFeedback, setPanicDetails]);
}
