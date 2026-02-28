/**
 * Test helpers for triggering error handlers
 * These work from the browser console
 */

export interface ErrorTestHelpers {
  throwSyncError: () => void;
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
     * Throw a synchronous error that should trigger window.onerror
     * Usage: window.__testError.throwSyncError()
     */
    throwSyncError: () => {
      setTimeout(() => {
        throw new Error("Test synchronous error from setTimeout");
      }, 0);
    },

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

  // @ts-ignore - Expose to window for testing
  window.__testError = helpers;
}

// Expose as window extension
declare global {
  interface Window {
    __testError: ErrorTestHelpers;
  }
}
