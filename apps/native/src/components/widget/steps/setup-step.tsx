"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BootstrapConfig } from "@/components/widget/controls/bootstrap-config";
import { DirectoryPicker } from "@/components/widget/controls/directory-picker";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useViewModel } from "@/stores/view-model";
import { Monitor } from "lucide-react";
import { useEffect, useState } from "react";

export function SetupStep() {
  const configDir = useViewModel((state) => state.preferences?.configDir ?? "");
  const hosts = useViewModel((state) => state.hosts);
  const host = useViewModel((state) => state.preferences?.hostAttr ?? "");
  const [configDirConfirmed, setConfigDirConfirmed] = useState(() => Boolean(configDir));
  const [selectedHost, setSelectedHost] = useState<string>("");

  const { saveHost } = useDarwinConfig();

  useEffect(() => {
    setConfigDirConfirmed(Boolean(configDir));
  }, [configDir]);

  const hasConfigDir = Boolean(configDir) && configDirConfirmed;
  const hasHosts = hasConfigDir && hosts.length > 0;
  const effectiveHost = selectedHost || host;

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
        <DirectoryPicker
          label="1. Configuration Directory"
          flow="setup"
          onConfigured={() => setConfigDirConfirmed(true)}
        />
      </div>

      <hr className="w-96 mx-auto" />

      {(hasConfigDir && configDirConfirmed) && (
        <div className="w-full max-w-sm space-y-2">
          {hasHosts ? (
            <>
              <label className="font-medium text-foreground text-sm">
                2. Configuration
              </label>
              <Select onValueChange={setSelectedHost} value={effectiveHost || undefined}>
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
          {hasHosts && (
            <Button disabled={!effectiveHost} onClick={() => saveHost(effectiveHost)}>
              Next
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
