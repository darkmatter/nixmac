import { RebuildOverlay } from "@/components/rebuild-overlay";
import { DarwinWidget } from "@/components/widget/widget";
import { useWidgetStore } from "@/stores/widget-store";
import { darwinAPI } from "@/tauri-api";

export default function App() {
  const rebuild = useWidgetStore((state) => state.rebuild);
  const clearRebuild = useWidgetStore((state) => state.clearRebuild);

  // Show overlay when rebuild is running OR when it finished (success/error) and hasn't been dismissed
  const showOverlay = rebuild.isRunning || rebuild.success !== undefined;

  const handleRollback = async () => {
    try {
      await darwinAPI.git.restoreAll();
      clearRebuild();
    } catch (e) {
      console.error("Failed to rollback:", e);
    }
  };

  const handleDismiss = () => {
    clearRebuild();
  };

  return (
    <>
      <DarwinWidget />
      {showOverlay && (
        <RebuildOverlay
          errorMessage={rebuild.errorMessage}
          errorType={rebuild.errorType}
          exitCode={rebuild.exitCode}
          isRunning={rebuild.isRunning}
          lines={rebuild.lines}
          onDismiss={handleDismiss}
          onRollback={handleRollback}
          success={rebuild.success}
        />
      )}
    </>
  );
}
