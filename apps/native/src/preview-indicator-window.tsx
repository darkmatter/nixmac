import { PreviewIndicator } from "@/components/preview-indicator/preview-indicator";
import { orpc, queryClient } from "@/lib/orpc";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

function PreviewIndicatorWindow() {
  const {
    data: state,
    error,
  } = useQuery(orpc.previewIndicator.getState.queryOptions());
  useEffect(() => {
    if (state) {
      console.log("state", state);
    }
  }, [state]);

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
  // if (error) {
  //   return (
  //     <div style={{ background: "red", color: "white", padding: 8, fontSize: 12 }}>
  //       Error: {error.message}
  //     </div>
  //   );
  // }

  // if (!state) {
  //   return (
  //     <div style={{ background: "blue", color: "white", padding: 8, fontSize: 12 }}>
  //       Loading...
  //     </div>
  //   );
  // }

  return (
    <PreviewIndicator
      additions={state?.additions ?? undefined}
      deletions={state?.deletions ?? undefined}
      disableExpansion
      filesChanged={state?.filesChanged}
      isLoading={state?.isLoading}
      onClick={handleClick}
      summary={state?.summary ?? undefined}
      visible={state?.visible ?? false}
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
