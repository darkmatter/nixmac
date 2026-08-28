import { PreviewIndicator } from "@/components/preview-indicator/preview-indicator";
import { orpc, queryClient, type PreviewIndicatorState } from "@/lib/orpc";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

export function PreviewIndicatorWindow() {
  const {
    data: state,
  } = useQuery(orpc.previewIndicator.getState.queryOptions());

  useEffect(() => {
    const unlisten = listen<PreviewIndicatorState>("preview-indicator:update", (event) => {
      queryClient.setQueryData(orpc.previewIndicator.getState.key(), event.payload);
    });

    return () => {
      void unlisten.then((removeListener) => removeListener());
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

  // Keep the webview empty until the native window has a matching visible
  // state. The Rust side keeps that empty window hidden so it cannot intercept
  // clicks behind it.
  if (!state?.visible) {
    return null;
  }

  return (
    <PreviewIndicator
      additions={state?.additions ?? undefined}
      deletions={state?.deletions ?? undefined}
      disableExpansion
      filesChanged={state?.filesChanged}
      isLoading={state?.isLoading}
      onClick={handleClick}
      summary={state?.summary ?? undefined}
      visible
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <PreviewIndicatorWindow />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
