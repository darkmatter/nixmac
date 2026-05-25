"use client";

import { Button } from "@/components/ui/button";
import { useWidgetStore } from "@/stores/widget-store";
import { open } from "@tauri-apps/plugin-shell";
import { Clipboard, FileText } from "lucide-react";
import { toast } from "sonner";

export function EvolutionLogActions() {
  const evolutionLogPath = useWidgetStore((s) => s.evolveState?.evolutionLogPath);

  if (!evolutionLogPath) {
    return null;
  }

  const copyLogPath = async (options?: { silent?: boolean }) => {
    try {
      await navigator.clipboard.writeText(evolutionLogPath);
      if (!options?.silent) {
        toast.success("Evolution log path copied");
      }
      return true;
    } catch (error) {
      console.warn("Failed to copy evolution log path", error);
      if (!options?.silent) {
        toast.error("Could not copy evolution log path");
      }
      return false;
    }
  };

  const openLog = async () => {
    try {
      await open(evolutionLogPath);
    } catch (error) {
      console.warn("Failed to open evolution log", error);
      const copied = await copyLogPath({ silent: true });
      toast.error(
        copied ? "Could not open log; copied path instead" : "Could not open or copy log path",
      );
    }
  };

  return (
    <>
      <Button
        className="text-muted-foreground hover:text-foreground"
        onClick={openLog}
        size="sm"
        title={evolutionLogPath}
        type="button"
        variant="ghost"
      >
        <FileText className="h-3.5 w-3.5" />
        Open log
      </Button>
      <Button
        className="text-muted-foreground hover:text-foreground"
        onClick={() => copyLogPath()}
        size="sm"
        title="Copy evolution log path"
        type="button"
        variant="ghost"
      >
        <Clipboard className="h-3.5 w-3.5" />
        Copy path
      </Button>
    </>
  );
}
