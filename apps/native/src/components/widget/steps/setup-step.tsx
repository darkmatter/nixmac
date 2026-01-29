"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BootstrapConfig } from "@/components/widget/bootstrap-config";
import { DirectoryPicker } from "@/components/widget/directory-picker";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useWidgetStore } from "@/stores/widget-store";
import { Monitor, Sparkles } from "lucide-react";

export function SetupStep() {
  const configDir = useWidgetStore((state) => state.configDir);
  const hosts = useWidgetStore((state) => state.hosts);
  const host = useWidgetStore((state) => state.host);

  const { saveHost } = useDarwinConfig();

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
      <div className="w-full max-w-sm">
        <DirectoryPicker label="1. Configuration Directory" />
      </div>

      {/* Step 2: Host Configuration */}
      {hasConfigDir && (
        <div className="w-full max-w-sm space-y-2">
          {hasFlake ? (
            <>
              <label className="font-medium text-foreground text-sm">
                2. Configuration
              </label>
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
            <BootstrapConfig label="2. Configuration" />
          )}
        </div>
      )}
    </div>
  );
}