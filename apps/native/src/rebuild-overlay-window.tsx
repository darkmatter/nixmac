import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  getLineType,
  normalizeOutput,
  type RebuildLine,
  RebuildOverlay,
} from "@/components/rebuild-overlay";
import { darwinAPI } from "@/tauri-api";
import "./index.css";

// Check for debug mode via URL param: rebuild-overlay.html?debug=true
const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "true";

// Mock lines for debug mode
const DEBUG_MOCK_LINES: RebuildLine[] = [
  { id: 1, text: "building '/nix/store/abc123-source.drv'...", type: "info" },
  {
    id: 2,
    text: "copying path '/nix/store/def456-package' to the store...",
    type: "info",
  },
  { id: 3, text: "building '/nix/store/ghi789-config.drv'...", type: "info" },
  { id: 4, text: "activating system configuration...", type: "info" },
  { id: 5, text: "setting up user profiles...", type: "stdout" },
  {
    id: 6,
    text: "warning: some optional feature is deprecated",
    type: "stderr",
  },
  {
    id: 7,
    text: "copying path '/nix/store/jkl012-binary' to the store...",
    type: "info",
  },
];

interface RebuildState {
  isRunning: boolean;
  lines: RebuildLine[];
  exitCode?: number;
  success?: boolean;
}

// Track if we've already started a rebuild to prevent duplicates
let globalStarted = false;

function RebuildOverlayWindow() {
  const [state, setState] = useState<RebuildState>({
    isRunning: true,
    lines: DEBUG_MODE ? DEBUG_MOCK_LINES : [{ id: 0, text: "Preparing rebuild...", type: "info" }],
  });
  const lineIdRef = useRef(DEBUG_MODE ? DEBUG_MOCK_LINES.length + 1 : 0);

  // Reset state when window becomes visible (for subsequent runs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !state.isRunning) {
        // Reset state for a new run
        setState({
          isRunning: true,
          lines: [],
        });
        lineIdRef.current = 0;
        globalStarted = false;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state.isRunning]);

  useEffect(() => {
    // In debug mode, add a new mock line every 2 seconds to simulate activity
    if (DEBUG_MODE) {
      const interval = setInterval(() => {
        setState((prev) => ({
          ...prev,
          lines: [
            ...prev.lines,
            {
              id: lineIdRef.current,
              text: `copying path '/nix/store/${Math.random().toString(36).slice(2, 10)}-package' to the store...`,
              type: "info" as const,
            },
          ].slice(-100),
        }));
        lineIdRef.current += 1;
      }, 2000);
      return () => clearInterval(interval);
    }

    // Prevent double-start from StrictMode
    if (globalStarted) {
      return;
    }
    globalStarted = true;

    // Set up event listeners and start rebuild
    let unsubDataFn: (() => void) | null = null;
    let unsubEndFn: (() => void) | null = null;

    const setup = async () => {
      // Register listeners first
      unsubDataFn = await listen<{ chunk: string }>("darwin:apply:data", (event) => {
        const normalized = normalizeOutput(event.payload.chunk);
        if (!normalized) {
          return;
        }

        const newLines = normalized.split("\n").filter(Boolean);

        setState((prev) => {
          const startId = lineIdRef.current;
          lineIdRef.current += newLines.length;
          return {
            ...prev,
            lines: [
              ...prev.lines,
              ...newLines.map((text, i) => ({
                id: startId + i,
                text,
                type: getLineType(text),
              })),
            ].slice(-100),
          };
        });
      });

      unsubEndFn = await listen<{ ok: boolean; code: number }>(
        "darwin:apply:end",
        async (event) => {
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
          }

          // Hide the overlay after a delay to let the completion animation play
          setTimeout(() => {
            darwinAPI.rebuildOverlay.hide();
          }, 2500);
        },
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
          lines: [...prev.lines, { id: lineIdRef.current, text: `Error: ${msg}`, type: "stderr" }],
        }));
        lineIdRef.current += 1;
      }
    };

    setup();

    return () => {
      if (unsubDataFn) {
        unsubDataFn();
      }
      if (unsubEndFn) {
        unsubEndFn();
      }
    };
  }, []);

  return (
    <RebuildOverlay
      exitCode={state.exitCode}
      isRunning={state.isRunning}
      lines={state.lines}
      success={state.success}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RebuildOverlayWindow />
    </React.StrictMode>,
  );
}
