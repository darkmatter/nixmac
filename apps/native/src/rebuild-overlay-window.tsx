import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  getLineType,
  normalizeOutput,
  type RebuildLine,
  RebuildOverlay,
} from "@/components/rebuild-overlay";
import "./index.css";

// Check for debug mode via URL param: rebuild-overlay.html?debug=true
const DEBUG_MODE =
  new URLSearchParams(window.location.search).get("debug") === "true";

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

function RebuildOverlayWindow() {
  const [state, setState] = useState<RebuildState>({
    isRunning: true,
    lines: DEBUG_MODE ? DEBUG_MOCK_LINES : [],
  });
  const lineIdRef = useRef(DEBUG_MODE ? DEBUG_MOCK_LINES.length + 1 : 0);

  useEffect(() => {
    // In debug mode, add a new mock line every 2 seconds to simulate activity
    if (DEBUG_MODE) {
      const interval = setInterval(() => {
        setState((prev) => ({
          ...prev,
          lines: [
            ...prev.lines,
            {
              id: lineIdRef.current++,
              text: `copying path '/nix/store/${Math.random().toString(36).slice(2, 10)}-package' to the store...`,
              type: "info",
            },
          ].slice(-100),
        }));
      }, 2000);
      return () => clearInterval(interval);
    }

    // Listen for rebuild output data
    const unsubData = listen<{ chunk: string }>(
      "darwin:apply:data",
      (event) => {
        const normalized = normalizeOutput(event.payload.chunk);
        if (!normalized) return;

        // Split by newlines in case multiple lines come at once
        const newLines = normalized.split("\n").filter(Boolean);

        setState((prev) => ({
          ...prev,
          lines: [
            ...prev.lines,
            ...newLines.map((text) => ({
              id: lineIdRef.current++,
              text,
              type: getLineType(text),
            })),
          ].slice(-100), // Keep last 100 lines to prevent memory issues
        }));
      }
    );

    // Listen for rebuild completion (ignored in debug mode)
    const unsubEnd = listen<{ ok: boolean; code: number }>(
      "darwin:apply:end",
      (event) => {
        setState((prev) => ({
          ...prev,
          isRunning: false,
          success: event.payload.ok,
          exitCode: event.payload.code,
        }));
      }
    );

    return () => {
      unsubData.then((unlisten) => unlisten());
      unsubEnd.then((unlisten) => unlisten());
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
    </React.StrictMode>
  );
}
