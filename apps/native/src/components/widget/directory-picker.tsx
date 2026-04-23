"use client";

import { Button } from "@/components/ui/button";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useWidgetStore } from "@/stores/widget-store";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { darwinAPI } from "@/tauri-api";

type DirectoryPickerProps = {
  label: string;
  subLabel?: string;
};

export function DirectoryPicker({ label, subLabel }: DirectoryPickerProps) {
  const configDir = useWidgetStore((state) => state.configDir);
  const setConfigDir = useWidgetStore((state) => state.setConfigDir);
  const setHosts = useWidgetStore((state) => state.setHosts);
  const setHost = useWidgetStore((state) => state.setHost);
  const { pickDir } = useDarwinConfig();

  const [value, setValue] = useState<string>(configDir || "");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  // Keep local input in sync when store changes externally (like via the directory picker)
  useEffect(() => {
    setValue(configDir || "");
    // When configDir changes externally (e.g. from the picker), ensure the
    // directory still exists before checking for flake.nix.
    (async () => {
      if (!configDir) {
        setValidationMessage(null);
        return;
      }

      const exists = await validateDirectoryExists(configDir);
      if (!exists) {
        return;
      }

      await validateFlakeExists(configDir);
    })();
  }, [configDir]);

  const onBlur = async () => {
    const normalizedPath = await normalizePathInput(value);
    if (!normalizedPath) {
      return;
    }

    // Check path existence first and show immediate feedback
    if (!(await validateDirectoryExists(normalizedPath))) {
      return;
    }

    try {
      const result = await darwinAPI.config.setDir(normalizedPath);
      setConfigDir(result.dir);
      setValue(result.dir);
      if (result.evolveState) {
        useWidgetStore.getState().setEvolveState(result.evolveState);

        // Dir changed — clear host and reload the host list for the new directory.
        setHost("");
        try {
          await darwinAPI.config.setHostAttr("");
        } catch {}

        setHosts(result.hosts ?? []);
      }

      // Don't validate flake here — missing flake.nix is handled above by
      // hosts=[], which shows the bootstrap UI. This keeps typed input
      // behavior consistent with the Browse flow.
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`${message}`);
    }
  };

  async function normalizePathInput(input: string): Promise<string | null> {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setValidationMessage("Directory path is required");
      return null;
    }

    try {
      const normalized = await darwinAPI.path.normalize(trimmedInput);
      if (!normalized) {
        setValidationMessage("Directory path is required");
        return null;
      }

      return normalized;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`Failed to normalize path: ${message}`);
      return null;
    }
  }

  async function validateDirectoryExists(path: string): Promise<boolean> {
    try {
      const exists = await darwinAPI.path.exists(path);
      if (!exists) {
        setValidationMessage(`Directory does not exist: ${path}`);
        return false;
      }

      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`Failed to check path: ${message}`);
      return false;
    }
  }

  async function validateFlakeExists(path?: string): Promise<boolean> {
    try {
      const hasFlake = path ? await darwinAPI.flake.existsAt(path) : await darwinAPI.flake.exists();
      if (hasFlake) {
        setValidationMessage(null);
        return true;
      }

      setValidationMessage("flake.nix not found in this directory");
      return false;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`${message}`);
      return false;
    }
  }

  return (
    <div className="space-y-2">
      <label className="font-medium text-sm">
        {label}
        {subLabel && (
          <span className="text-muted-foreground ml-2 font-light text-xs">({subLabel})</span>
        )}
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={onBlur}
            placeholder="Not selected"
            aria-label={label}
          />
          <Button onClick={pickDir} size="sm" variant="secondary">
            <FolderOpen className="mr-1 h-3 w-3" />
            Browse
          </Button>
        </div>
        {validationMessage && <p className="text-destructive text-xs">{validationMessage}</p>}
        <p className="text-muted-foreground text-xs">
          Press ⌘+⇧+. when browsing to show hidden folders like{" "}
          <code className="rounded bg-muted px-1">.darwin</code>
        </p>
      </div>
    </div>
  );
}
