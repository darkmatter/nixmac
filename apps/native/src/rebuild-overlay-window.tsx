import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { type RebuildLine, RebuildOverlay } from "@/components/rebuild-overlay";
import { darwinAPI } from "@/tauri-api";
import "./index.css";

// Check for debug mode via URL param: rebuild-overlay.html?debug=true
const DEBUG_MODE =
  new URLSearchParams(window.location.search).get("debug") === "true";

// Mock lines for debug mode - simulating AI-summarized output
const DEBUG_MOCK_LINES: RebuildLine[] = [
  { id: 1, text: "🚀 Starting system rebuild...", type: "info" },
  { id: 2, text: "🔍 Evaluating nix configuration", type: "info" },
  { id: 3, text: "📦 Downloading neovim package", type: "info" },
  { id: 4, text: "📦 Fetching Firefox browser", type: "info" },
  { id: 5, text: "🔨 Building shell environment", type: "info" },
  { id: 6, text: "⚡ Activating system configuration", type: "info" },
];

/** Payload from the AI-powered log summarizer */
interface SummaryPayload {
  text: string;
  complete?: boolean;
  success?: boolean;
  error?: boolean; // True when an error (like infinite recursion) is detected
  error_type?:
    | "infinite_recursion"
    | "evaluation_error"
    | "build_error"
    | "generic_error";
}

interface RebuildState {
  isRunning: boolean;
  lines: RebuildLine[];
  exitCode?: number;
  success?: boolean;
  errorType?:
    | "infinite_recursion"
    | "evaluation_error"
    | "build_error"
    | "generic_error";
  errorMessage?: string;
}

// Track if we've already started a rebuild to prevent duplicates
let globalStarted = false;

function RebuildOverlayWindow() {
  const [state, setState] = useState<RebuildState>({
    isRunning: true,
    lines: DEBUG_MODE
      ? DEBUG_MOCK_LINES
      : [{ id: 0, text: "Preparing rebuild...", type: "info" }],
  });
  const lineIdRef = useRef(DEBUG_MODE ? DEBUG_MOCK_LINES.length + 1 : 1);

  // Reset state when window becomes visible (for subsequent runs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !state.isRunning) {
        // Reset state for a new run
        setState({
          isRunning: true,
          lines: [],
        });
        lineIdRef.current = 1;
        globalStarted = false;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state.isRunning]);

  useEffect(() => {
    // In debug mode, add a new mock line every 500ms to simulate AI-summarized activity
    if (DEBUG_MODE) {
      const mockSummaries = [
        "📦 Fetching zsh plugins",
        "📦 Downloading git configuration",
        "🔨 Building neovim plugins",
        "🔨 Compiling treesitter grammars",
        "📦 Fetching homebrew packages",
        "⚡ Setting up user environment",
      ];
      let mockIndex = 0;

      const interval = setInterval(() => {
        const text = mockSummaries[mockIndex % mockSummaries.length];
        mockIndex++;

        setState((prev) => ({
          ...prev,
          lines: [
            ...prev.lines,
            { id: lineIdRef.current, text, type: "info" as const },
          ].slice(-50),
        }));
        lineIdRef.current += 1;
      }, 500);

      return () => clearInterval(interval);
    }

    // Prevent double-start from StrictMode
    if (globalStarted) {
      return;
    }
    globalStarted = true;

    // Set up event listeners and start rebuild
    let unsubSummaryFn: (() => void) | null = null;
    let unsubEndFn: (() => void) | null = null;

    const setup = async () => {
      // Listen to AI-summarized log events (smooth, 500ms intervals)
      unsubSummaryFn = await listen<SummaryPayload>(
        "darwin:apply:summary",
        (event) => {
          const { text, complete, success, error, error_type } = event.payload;

          if (complete) {
            // Summary includes completion status
            setState((prev) => ({
              ...prev,
              isRunning: false,
              success: success ?? false,
              // If we already have an error type, preserve it
              errorType: prev.errorType ?? (success ? undefined : error_type),
              errorMessage: prev.errorMessage ?? (success ? undefined : text),
              lines: [
                ...prev.lines,
                {
                  id: lineIdRef.current,
                  text,
                  type: success ? "info" : "stderr",
                },
              ],
            }));
            lineIdRef.current += 1;
          } else if (error) {
            // Error detected (e.g., infinite recursion)
            setState((prev) => ({
              ...prev,
              errorType: error_type,
              errorMessage: text,
              lines: [
                ...prev.lines,
                { id: lineIdRef.current, text, type: "stderr" as const },
              ].slice(-50),
            }));
            lineIdRef.current += 1;
          } else {
            // Regular summarized log line
            setState((prev) => ({
              ...prev,
              lines: [
                ...prev.lines,
                { id: lineIdRef.current, text, type: "info" as const },
              ].slice(-50),
            }));
            lineIdRef.current += 1;
          }
        }
      );

      // Still listen to the end event for git staging and overlay hiding
      unsubEndFn = await listen<{ ok: boolean; code: number }>(
        "darwin:apply:end",
        async (event) => {
          // Update state (may already be set by summary complete event)
          setState((prev) => ({
            ...prev,
            isRunning: false,
            success: event.payload.ok,
            exitCode: event.payload.code,
          }));

          // If successful, stage all changes to mark them as "previewed"
          if (event.payload.ok) {
            try {
              await darwinAPI.git.stageAll();
            } catch (e) {
              console.error("Failed to stage changes:", e);
            }

            // Only auto-hide on success - on failure, user needs to take action
            setTimeout(() => {
              darwinAPI.rebuildOverlay.hide();
            }, 2500);
          }
          // On failure, don't auto-hide - let the error UI show with rollback option
        }
      );

      // Now start the rebuild
      try {
        await darwinAPI.darwin.applyStreamStart();
      } catch (e: unknown) {
        const msg = (e as Error)?.message || String(e);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          success: false,
          lines: [
            ...prev.lines,
            { id: lineIdRef.current, text: `❌ Error: ${msg}`, type: "stderr" },
          ],
        }));
        lineIdRef.current += 1;
      }
    };

    setup();

    return () => {
      if (unsubSummaryFn) {
        unsubSummaryFn();
      }
      if (unsubEndFn) {
        unsubEndFn();
      }
    };
  }, []);

  const handleRollback = async () => {
    try {
      await darwinAPI.git.restoreAll();
      // Hide overlay after rollback
      darwinAPI.rebuildOverlay.hide();
    } catch (e) {
      console.error("Failed to rollback:", e);
    }
  };

  const handleDismiss = () => {
    darwinAPI.rebuildOverlay.hide();
  };

  return (
    <RebuildOverlay
      errorMessage={state.errorMessage}
      errorType={state.errorType}
      exitCode={state.exitCode}
      isRunning={state.isRunning}
      lines={state.lines}
      onDismiss={handleDismiss}
      onRollback={handleRollback}
      success={state.success}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RebuildOverlayWindow />
    </React.StrictMode>
  );
}
