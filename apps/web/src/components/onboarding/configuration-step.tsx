import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ConfigurationStepProps {
  config: {
    repoDirectory: string;
    selectedHost: string;
    hosts: string[];
  };
  setConfig: (config: any) => void;
}

export function ConfigurationStep({
  config,
  setConfig,
}: ConfigurationStepProps) {
  const [newHost, setNewHost] = useState("");

  const handleAddHost = () => {
    if (newHost && !config.hosts.includes(newHost)) {
      setConfig({
        ...config,
        hosts: [...config.hosts, newHost],
        selectedHost: config.selectedHost || newHost,
      });
      setNewHost("");
    }
  };

  const handleRemoveHost = (host: string) => {
    const updatedHosts = config.hosts.filter((h) => h !== host);
    setConfig({
      ...config,
      hosts: updatedHosts,
      selectedHost:
        config.selectedHost === host
          ? updatedHosts[0] || ""
          : config.selectedHost,
    });
  };

  return (
    <div className="space-y-6">
      {/* Repository Directory - Essential config */}
      <div className="space-y-2">
        <Label className="font-medium text-base" htmlFor="repoDirectory">
          Repository Directory
        </Label>
        <p className="text-muted-foreground text-sm">
          Location of your nixmac configuration files
        </p>
        <div className="flex gap-2">
          <Input
            className="font-mono text-sm"
            id="repoDirectory"
            onChange={(e) =>
              setConfig({ ...config, repoDirectory: e.target.value })
            }
            placeholder="~/.config/nixmac"
            value={config.repoDirectory}
          />
          <Button size="icon" variant="outline">
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Host Selection - Essential config */}
      <div className="space-y-2">
        <Label className="font-medium text-base">Current Host</Label>
        <p className="text-muted-foreground text-sm">
          Select or add the host configuration to use
        </p>

        <div className="space-y-3">
          {config.hosts.length > 0 ? (
            <>
              <Select
                onValueChange={(value) =>
                  setConfig({ ...config, selectedHost: value })
                }
                value={config.selectedHost}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a host" />
                </SelectTrigger>
                <SelectContent>
                  {config.hosts.map((host) => (
                    <SelectItem key={host} value={host}>
                      {host}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex flex-wrap gap-2">
                {config.hosts.map((host) => (
                  <Badge
                    className="gap-1"
                    key={host}
                    variant={
                      host === config.selectedHost ? "default" : "secondary"
                    }
                  >
                    {host}
                    <button
                      className="ml-1 hover:text-destructive"
                      onClick={() => handleRemoveHost(host)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-border border-dashed bg-muted/50 p-4 text-center text-muted-foreground text-sm">
              No hosts configured yet. Add your first host below.
            </div>
          )}

          <div className="flex gap-2">
            <Input
              onChange={(e) => setNewHost(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddHost();
                }
              }}
              placeholder="e.g., macbook-pro, work-mac"
              value={newHost}
            />
            <Button onClick={handleAddHost} size="icon">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Advanced Options - Collapsed by default */}
      <Accordion collapsible type="single">
        <AccordionItem value="advanced">
          <AccordionTrigger className="font-medium text-sm">
            Advanced Configuration
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="flakeUri">Flake URI</Label>
                <Input
                  className="font-mono text-sm"
                  id="flakeUri"
                  placeholder="github:user/repo"
                />
                <p className="text-muted-foreground text-xs">
                  Optional: Use a remote flake repository
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="buildFlags">Build Flags</Label>
                <Input
                  className="font-mono text-sm"
                  id="buildFlags"
                  placeholder="--impure --verbose"
                />
                <p className="text-muted-foreground text-xs">
                  Additional flags for nix build commands
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  className="h-4 w-4 rounded border-border"
                  id="autoUpdate"
                  type="checkbox"
                />
                <Label className="font-normal text-sm" htmlFor="autoUpdate">
                  Automatically check for configuration updates
                </Label>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
