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

const INITIAL_HINT =
  "Select your own, or proceed below for defaults";

export function DirectoryPicker({ label, subLabel }: DirectoryPickerProps) {
  const configDir = useWidgetStore((state) => state.configDir);
  const { pickDir, setDir } = useDarwinConfig();

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

  const submit = async (): Promise<boolean> => {
    const normalizedPath = await normalizePathInput(value);
    if (!normalizedPath) return false;
    if (!(await validateDirectoryExists(normalizedPath))) return false;
    try {
      const result = await setDir(normalizedPath);
      setValue(result.dir);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`${message}`);
      return false;
    }
  };

  const onBlur = () => { submit(); };
  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const target = e.currentTarget;
    if (await submit()) target.blur();
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

  function validateOrInitial(path: string | undefined, fallback: string): void {
    setValidationMessage(path?.endsWith("/.darwin") ? INITIAL_HINT : fallback);
  }

  async function validateDirectoryExists(path: string): Promise<boolean> {
    try {
      const exists = await darwinAPI.path.exists(path);
      if (!exists) {
        validateOrInitial(path, `Directory does not exist: ${path}`);
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

      validateOrInitial(path, "flake.nix not found in this directory");
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
            onKeyDown={onKeyDown}
            placeholder="Not selected"
            aria-label={label}
          />
          <Button onClick={pickDir} size="sm" variant="secondary">
            <FolderOpen className="mr-1 h-3 w-3" />
            Browse
          </Button>
        </div>
        {validationMessage && (
          <p className={`text-xs ${validationMessage === INITIAL_HINT ? "text-teal-300" : "text-rose-300"}`}>
            {validationMessage}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Press ⌘+⇧+. when browsing to show hidden folders like{" "}
          <code className="rounded bg-muted px-1">.darwin</code>
        </p>
      </div>
    </div>
  );
}
