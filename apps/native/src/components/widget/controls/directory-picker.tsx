"use client";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useViewModel } from "@nixmac/state";
import { HoverClickPopoverIcon } from "@/components/ui/hover-click-popover-icon";
import { ConfigDirBadge } from "@/components/widget/badges/config-dir-badge";
import { GitignoreBadge } from "@/components/widget/badges/gitignore-badge";
import { RepoImport } from "@/components/widget/controls/repo-import";
import { FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { CANONICAL_CONFIG_DIR } from "@/components/widget/onboarding/lib/flake-ref";
import { client } from "@/lib/orpc";
import { activeConfigDir } from "@/lib/active-config";

type DirectoryPickerProps = {
  label: string;
  subLabel?: string;
  flow?: "existing" | "setup";
  onConfigured?: (valid?: boolean) => void;
};

type SetupChoice = "new" | "existing" | "import";

const INITIAL_HINT = "Select your own, or proceed below for defaults";

function getDirectoryName(path: string | undefined): string {
  if (!path) return "nix-darwin";
  if (path === CANONICAL_CONFIG_DIR) return "nix-darwin";
  return path.split("/").filter(Boolean).pop() || "nix-darwin";
}

export function DirectoryPicker({
  label,
  subLabel,
  flow = "existing",
  onConfigured,
}: DirectoryPickerProps) {
  const configDir = useViewModel(activeConfigDir);
  const { pickDir, prepareNewDir, setDir } = useDarwinConfig();
  const isSetupFlow = flow === "setup";

  const [value, setValue] = useState<string>(configDir || "");
  const [setupChoice, setSetupChoice] = useState<SetupChoice>(isSetupFlow ? "new" : "existing");
  const [directoryName, setDirectoryName] = useState<string>(() => getDirectoryName(configDir));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [showPrivacyNote, setShowPrivacyNote] = useState(false);

  useEffect(() => {
    setShowPrivacyNote(Boolean(configDir && configDir !== CANONICAL_CONFIG_DIR));
  }, [configDir]);

  useEffect(() => {
    if (configDir) setDirectoryName(getDirectoryName(configDir));
  }, [configDir]);

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

  const submitNew = async (): Promise<boolean> => {
    const trimmedName = directoryName.trim();
    if (!trimmedName) {
      setValidationMessage("Directory name is required");
      return false;
    }

    if (trimmedName.includes("/") || trimmedName === "." || trimmedName === "..") {
      setValidationMessage("Use a directory name, not a path");
      return false;
    }

    const normalizedPath = await normalizePathInput(`~/${trimmedName}`);
    if (!normalizedPath) return false;

    try {
      const result = await prepareNewDir(normalizedPath);
      setValue(result.dir);
      setValidationMessage(null);
      onConfigured?.();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`${message}`);
      return false;
    }
  };

  const submit = async (): Promise<boolean> => {
    const normalizedPath = await normalizePathInput(value);
    if (!normalizedPath) return false;
    if (!(await validateDirectoryExists(normalizedPath))) return false;
    try {
      const result = await setDir(normalizedPath);
      setValue(result.dir);
      onConfigured?.();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationMessage(`${message}`);
      return false;
    }
  };

  const onBlur = () => {
    submit();
  };
  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const target = e.currentTarget;
    if (await submit()) target.blur();
  };
  const onNewKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const target = e.currentTarget;
    if (await submitNew()) target.blur();
  };

  const onPickDir = async () => {
    const result = await pickDir();
    if (!result) return;
    setValue(result.dir);
    onConfigured?.();
  };

  async function normalizePathInput(input: string): Promise<string | null> {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setValidationMessage("Directory path is required");
      return null;
    }

    try {
      const normalized = await client.path.normalize({ input: trimmedInput });
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
      const exists = await client.path.exists({ dir: path });
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
      const hasFlake = path
        ? await client.flake.existsAt({ dir: path })
        : await client.flake.exists();
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
        {isSetupFlow && (
          <Tabs
            className="w-full max-w-md"
            value={setupChoice}
            onValueChange={(value) => {
              if (value === "new" || value === "existing" || value === "import") {
                setSetupChoice(value);
              }
            }}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger onClick={() => setSetupChoice("existing")} value="existing">
                Existing
              </TabsTrigger>
              <TabsTrigger onClick={() => setSetupChoice("new")} value="new">
                New
              </TabsTrigger>
              <TabsTrigger onClick={() => setSetupChoice("import")} value="import">
                Import
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {setupChoice === "import" ? (
          <RepoImport onImported={() => onConfigured?.()} />
        ) : setupChoice === "new" ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs"
                value={directoryName}
                onChange={(e) => setDirectoryName(e.target.value)}
                onKeyDown={onNewKeyDown}
                placeholder=".darwin"
                aria-label={`${label} name`}
              />
              <Button onClick={submitNew} size="sm" variant="outline">
                <FolderPlus className="mr-1 h-3 w-3" />
                Create
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Creates an empty folder in your home directory, then nixmac can generate a default
              flake.
            </p>
          </div>
        ) : (
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
            <Button onClick={onPickDir} size="sm" variant="secondary">
              <FolderOpen className="mr-1 h-3 w-3" />
              Browse
            </Button>
          </div>
        )}
        {validationMessage && (
          <p
            className={`text-xs ${validationMessage === INITIAL_HINT ? "text-teal-300" : "text-rose-300"}`}
          >
            {validationMessage}
          </p>
        )}
        {showPrivacyNote && (
          <p className="text-muted-foreground text-xs flex items-center gap-1 flex-wrap">
            Content of <ConfigDirBadge configDir={configDir!} /> may be seen by your AI provider{" "}
            <HoverClickPopoverIcon>
              <p>
                Files and folders listed in a <GitignoreBadge /> will be hidden from AI agents.
              </p>
            </HoverClickPopoverIcon>
          </p>
        )}
      </div>
    </div>
  );
}
