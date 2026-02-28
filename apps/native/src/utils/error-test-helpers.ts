/**
 * Test helpers for triggering error handlers
 * These work from the browser console
 */

export interface ErrorTestHelpers {
  // Sync errors get eaten by React error boundaries and won't trigger
  // the global error handler, so we need to throw async errors to test it.
  throwAsyncError: () => void;
  throwUnhandledRejection: () => void;
}

/**
 * Expose test helpers to the window object for console testing
 */
export function setupErrorTestHelpers() {
  if (typeof window === "undefined") return;

  const helpers: ErrorTestHelpers = {
    /**
     * Throw an async error that should trigger window.onerror
     * Usage: window.__testError.throwAsyncError()
     */
    throwAsyncError: () => {
      setTimeout(() => {
        throw new Error("Test async error with delay");
      }, 100);
    },

    /**
     * Create an unhandled promise rejection
     * Usage: window.__testError.throwUnhandledRejection()
     */
    throwUnhandledRejection: () => {
      Promise.reject(new Error("Test unhandled promise rejection"));
    },
  };

  // Expose to window for testing
  window.__testError = helpers;
}

// Expose as window extension
declare global {
  interface Window {
    __testError?: ErrorTestHelpers;
  }
}
