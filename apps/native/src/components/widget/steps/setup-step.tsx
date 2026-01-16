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

interface SetupStepProps {
  configDir: string;
  pickDir: () => void;
  hosts: string[];
  host: string;
  saveHost: (h: string) => void;
}

export function SetupStep({
  configDir,
  pickDir,
  hosts,
  host,
  saveHost,
}: SetupStepProps) {
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
        <label className="font-medium text-foreground text-sm">
          1. Configuration Directory
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 truncate rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-sm">
            {configDir || "Not selected"}
          </div>
          <Button onClick={pickDir} size="sm" variant="secondary">
            <FolderOpen className="mr-1 h-4 w-4" />
            Browse
          </Button>
        </div>
      </div>

      {/* Step 2: Select Host */}
      {configDir && (
        <div className="w-full max-w-sm space-y-2">
          <label
            className="font-medium text-foreground text-sm"
            htmlFor="host-select"
          >
            2. Select Host
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
          {hosts.length === 0 && (
            <p className="text-muted-foreground text-xs">
              No hosts found. Make sure your flake has darwinConfigurations.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
