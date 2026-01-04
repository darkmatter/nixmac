import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { PreviewIndicator } from "@/components/preview-indicator";
import "./index.css";

interface PreviewState {
  visible: boolean;
  summary: string | null;
  filesChanged: number;
  additions?: number;
  deletions?: number;
  isLoading: boolean;
}

function PreviewIndicatorWindow() {
  const [state, setState] = useState<PreviewState>({
    visible: false,
    summary: null,
    filesChanged: 0,
    isLoading: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    console.log("[preview-indicator] Component mounted!");
    setMounted(true);

    // Fetch initial state on mount (in case event was sent before we were ready)
    invoke<PreviewState>("preview_indicator_get_state")
      .then((initialState) => {
        console.log("[preview-indicator] Got initial state:", initialState);
        setState(initialState);
      })
      .catch((err) => {
        console.error("[preview-indicator] Failed to get initial state:", err);
        setError(String(err));
      });

    // Listen for state updates from the main widget
    const unsubscribe = listen<PreviewState>(
      "preview-indicator:update",
      (event) => {
        console.log("[preview-indicator] Received update:", event.payload);
        setState(event.payload);
      },
    );

    return () => {
      unsubscribe.then((unlisten) => unlisten());
    };
  }, []);

  const handleClick = async () => {
    // Show and focus the main window via Tauri command
    // This properly updates peek state and hides preview indicator
    try {
      await invoke("show_main_window");
    } catch (err) {
      console.error("Failed to show main window:", err);
    }
  };

  // DEBUG: Show error or loading state
  if (error) {
    return (
      <div
        style={{ background: "red", color: "white", padding: 8, fontSize: 12 }}
      >
        Error: {error}
      </div>
    );
  }

  if (!mounted) {
    return (
      <div
        style={{ background: "blue", color: "white", padding: 8, fontSize: 12 }}
      >
        Mounting...
      </div>
    );
  }

  return (
    <PreviewIndicator
      additions={state.additions}
      deletions={state.deletions}
      disableExpansion
      filesChanged={state.filesChanged}
      isLoading={state.isLoading}
      onClick={handleClick}
      summary={state.summary ?? undefined}
      visible={state.visible}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <PreviewIndicatorWindow />
    </React.StrictMode>,
  );
}
