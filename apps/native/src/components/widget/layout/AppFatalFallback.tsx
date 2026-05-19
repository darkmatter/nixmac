import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type AppFatalFallbackProps = {
  error?: Error | null;
};

const RECOVERY_STORAGE_KEY = "nixmac:pending-error-report";

function stashErrorForRecovery(error: Error | null | undefined): void {
  try {
    window.localStorage.setItem(
      RECOVERY_STORAGE_KEY,
      JSON.stringify({
        name: error?.name ?? "Error",
        message: error?.message ?? "Unknown error",
        stack: error?.stack ?? "",
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
  }
}

export function AppFatalFallback({ error }: AppFatalFallbackProps) {
  const handleReload = () => {
    stashErrorForRecovery(error);
    window.location.reload();
  };

  return (
    <div
      role="alert"
      className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground"
    >
      <img src="/outline-white.png" alt="" className="mb-3 h-16 w-16 object-contain" />
      <h3 className="mb-5 font-semibold text-lg">Something went wrong</h3>
      <Button onClick={handleReload} size="sm">
        <RotateCcw />
        Reload
      </Button>
    </div>
  );
}
