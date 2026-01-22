"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { AlertCircle, Sparkles } from "lucide-react";
import { useState } from "react";

interface BootstrapConfigProps {
  label: string;
  onSuccess?: () => void;
}

export function BootstrapConfig({ label, onSuccess }: BootstrapConfigProps) {
  const [hostname, setHostname] = useState("macbook");
  const { bootstrap, isBootstrapping } = useDarwinConfig();

  const handleBootstrap = async (): Promise<void> => {
    await bootstrap(hostname);
    onSuccess?.();
  };

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm">{label}</label>
      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            No nix-darwin configuration found in this directory
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-2">
            <label htmlFor="hostname" className="text-sm">
              Host name
            </label>
            <Input
              id="hostname"
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="macbook"
              className="font-mono"
              disabled={isBootstrapping}
            />
            <p className="text-muted-foreground text-xs">
              This will be your darwinConfiguration name
            </p>
          </div>

          <Button
            onClick={handleBootstrap}
            className="w-full"
            disabled={!hostname.trim() || isBootstrapping}
          >
            {isBootstrapping ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                Creating Configuration...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Create Default Configuration
              </>
            )}
          </Button>
          <p className="text-muted-foreground text-xs">
            This will create a basic nix-darwin flake in the directory
          </p>
        </div>
      </div>
    </div>
  );
}