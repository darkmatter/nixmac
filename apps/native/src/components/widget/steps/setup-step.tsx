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
import { Monitor } from "lucide-react";

export function SetupStep() {
  const configDir = useWidgetStore((state) => state.configDir);
  const hosts = useWidgetStore((state) => state.hosts);
  const host = useWidgetStore((state) => state.host);

  const { saveHost } = useDarwinConfig();

  const hasConfigDir = Boolean(configDir);
  const hasFlake = hasConfigDir && hosts.length > 0;

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-8">
      <img src="/outline-white.png" alt="" className="h-16 w-16 object-contain" />
      <div className="text-center">
        <h2 data-testid="onboarding-welcome-title" className="font-semibold text-foreground text-lg">
          Welcome to nixmac
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Let's set up your nix-darwin configuration
        </p>
      </div>

      <div className="w-full max-w-sm">
        <DirectoryPicker label="1. Configuration Directory" />
      </div>

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
