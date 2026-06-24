"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { GitHubLogoIcon } from "@radix-ui/react-icons";
import { FileArchive, FolderInput } from "lucide-react";
import { useState } from "react";

type ImportSource = "github" | "zip";

interface RepoImportProps {
  /** Called once the imported configuration has been selected as the config dir. */
  onImported?: () => void;
}

const DEFAULT_DIR = ".darwin";

export function RepoImport({ onImported }: RepoImportProps) {
  const { importGithub, importZip, pickZip } = useDarwinConfig();

  const [source, setSource] = useState<ImportSource>("github");
  const [repoRef, setRepoRef] = useState("");
  const [zipPath, setZipPath] = useState("");
  const [dirName, setDirName] = useState(DEFAULT_DIR);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetName = dirName.trim() || DEFAULT_DIR;

  const runImport = async (fn: () => Promise<unknown>) => {
    setError(null);
    setIsImporting(true);
    try {
      await fn();
      onImported?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsImporting(false);
    }
  };

  const onImportGithub = () => {
    if (!repoRef.trim()) {
      setError("Enter a GitHub reference like owner/repo");
      return;
    }
    void runImport(() => importGithub(repoRef.trim(), targetName));
  };

  const onPickZip = async () => {
    setError(null);
    const path = await pickZip();
    if (path) setZipPath(path);
  };

  const onImportZip = () => {
    if (!zipPath) {
      setError("Choose a .zip archive to import");
      return;
    }
    void runImport(() => importZip(zipPath, targetName));
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <Tabs
        className="w-full"
        value={source}
        onValueChange={(value) => {
          if (value === "github" || value === "zip") {
            setSource(value);
            setError(null);
          }
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="github">
            <GitHubLogoIcon className="mr-1 size-3" />
            GitHub
          </TabsTrigger>
          <TabsTrigger value="zip">
            <FileArchive className="mr-1 h-3 w-3" />
            Zip file
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {source === "github" ? (
        <div className="space-y-2">
          <Input
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onImportGithub();
            }}
            placeholder="owner/repo"
            className="font-mono text-xs"
            aria-label="GitHub repository reference"
            disabled={isImporting}
          />
          <p className="text-muted-foreground text-xs">
            A public GitHub repo, e.g. <span className="font-mono">czxtm/darwin</span>. Add{" "}
            <span className="font-mono">#branch</span> to clone a specific branch.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 truncate rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs"
              value={zipPath}
              readOnly
              placeholder="No file selected"
              aria-label="Selected zip archive"
            />
            <Button onClick={onPickZip} size="sm" variant="secondary" disabled={isImporting}>
              <FileArchive className="mr-1 h-3 w-3" />
              Browse
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Extracts the archive into your config directory.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="import-dir-name" className="text-xs text-muted-foreground">
          Destination folder (in your home directory)
        </label>
        <Input
          id="import-dir-name"
          value={dirName}
          onChange={(e) => setDirName(e.target.value)}
          placeholder={DEFAULT_DIR}
          className="font-mono text-xs"
          disabled={isImporting}
        />
      </div>

      <Button
        className="w-full"
        data-testid="import-repo-button"
        disabled={isImporting}
        onClick={source === "github" ? onImportGithub : onImportZip}
      >
        {isImporting ? (
          <>
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
            Importing…
          </>
        ) : (
          <>
            <FolderInput className="mr-2 h-4 w-4" />
            Import to ~/{targetName}
          </>
        )}
      </Button>

      {error && <p className="text-rose-300 text-xs">{error}</p>}
    </div>
  );
}
