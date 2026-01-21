"use client";

import { FolderOpen, Monitor, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BootstrapConfig } from "@/components/widget/bootstrap-config";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useWidgetStore } from "@/stores/widget-store";

export function SetupStep() {
  const configDir = useWidgetStore((state) => state.configDir);
  const hosts = useWidgetStore((state) => state.hosts);
  const host = useWidgetStore((state) => state.host);

  const { pickDir, saveHost } = useDarwinConfig();

  const hasConfigDir = Boolean(configDir);
  const hasFlake = hasConfigDir && hosts.length > 0;

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-8">
      <div className="text-center">
        <Sparkles className="mx-auto mb-3 h-10 w-10 text-primary" />
        <h2 className="font-semibold text-foreground text-lg">
          Welcome to nixmac
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Let's set up your nix-darwin configuration
        </p>
      </div>

      {/* Step 1: Choose Directory */}
      <div className="w-full max-w-sm space-y-2">
        <label htmlFor="config-dir" className="font-medium text-foreground text-sm">
          1. Configuration Directory
        </label>
        <div className="flex items-center gap-2">
          <div
            id="config-dir"
            className="flex-1 truncate rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-sm"
          >
            {configDir || "Not selected"}
          </div>
          <Button onClick={pickDir} size="sm" variant="secondary">
            <FolderOpen className="mr-1 h-4 w-4" />
            Browse
          </Button>
        </div>
      </div>

      {/* Step 2: Host Configuration */}
      {hasConfigDir && (
        <div className="w-full max-w-sm space-y-2">
          <label className="font-medium text-foreground text-sm">
            2. Configuration
          </label>

          {hasFlake ? (
            <>
              <Select onValueChange={saveHost} value={host || undefined}>
                <SelectTrigger className="w-full" id="host-select">
                  <SelectValue placeholder="Choose a host configuration" />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((h) => (
                    <SelectItem key={h} value={h}>
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4" />
                        {h}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Select your nix-darwin host configuration
              </p>
            </>
          ) : (
            <BootstrapConfig />
          )}
        </div>
      )}
    </div>
  );
}