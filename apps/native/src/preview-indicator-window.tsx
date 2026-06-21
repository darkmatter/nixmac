import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { PreviewIndicator } from "@/components/preview-indicator/preview-indicator";
import type { PreviewIndicatorState } from "@/ipc/types";
import "./index.css";

function PreviewIndicatorWindow() {
  const [state, setState] = useState<PreviewIndicatorState>({
    visible: false,
    summary: null,
    filesChanged: 0,
    additions: null,
    deletions: null,
    isLoading: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    invoke<PreviewIndicatorState>("preview_indicator_get_state")
      .then((initialState) => {
        setState(initialState);
      })
      .catch((err) => {
        console.error("[preview-indicator] Failed to get initial state:", err);
        setError(String(err));
      });

    const unsubscribe = listen<PreviewIndicatorState>("preview-indicator:update", (event) => {
      setState(event.payload);
    });

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
      <div style={{ background: "red", color: "white", padding: 8, fontSize: 12 }}>
        Error: {error}
      </div>
    );
  }

  if (!mounted) {
    return (
      <div style={{ background: "blue", color: "white", padding: 8, fontSize: 12 }}>
        Mounting...
      </div>
    );
  }

  return (
    <PreviewIndicator
      additions={state.additions ?? undefined}
      deletions={state.deletions ?? undefined}
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
