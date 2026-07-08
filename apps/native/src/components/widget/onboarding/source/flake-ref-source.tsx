"use client";

import { useMemo, useState } from "react";
import { FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlakeDirChooser } from "@/components/widget/controls/flake-dir-chooser";
import { RepoRefInput } from "@/components/widget/controls/repo-ref-input";
import { EXAMPLE_REFS, parseFlakeRef } from "@/components/widget/onboarding/lib/flake-ref";
import { useDarwinConfig } from "@/hooks/use-darwin-config";
import { useImportConfig } from "@/hooks/use-import-config";
import { client } from "@/lib/orpc";

interface FlakeRefSourceProps {
  onImported?: () => void;
}

/**
 * Advanced import: accepts repository references supported by
 * `bootstrap::import::parse_repo_ref`, plus a `.zip` archive picker.
 */
export function FlakeRefSource({ onImported }: FlakeRefSourceProps) {
  const { importGithub, pickZip, importZip } = useDarwinConfig({ stage: true });
  const [value, setValue] = useState("");
  const [dir, setDir] = useState("~/.darwin");
  const [loading, setLoading] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseFlakeRef(value), [value]);
  const canUse = parsed.valid && parsed.importable;
  const importConfig = useImportConfig(onImported);

  async function use() {
    if (!canUse) return;
    setError(null);
    setLoading(true);
    try {
      const normalized = await client.path.normalize({
        input: dir.trim() || "~/.darwin",
      });
      importConfig.handleResult(await importGithub(value.trim(), normalized));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function importArchive() {
    setError(null);
    const path = await pickZip();
    if (!path) return;
    setZipLoading(true);
    try {
      const normalized = await client.path.normalize({
        input: dir.trim() || "~/.darwin",
      });
      importConfig.handleResult(await importZip(path, normalized));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setZipLoading(false);
    }
  }

  if (importConfig.pending) {
    return (
      <FlakeDirChooser
        flakeDirs={importConfig.pending.flakeDirs}
        onChoose={importConfig.choose}
        onCancel={importConfig.cancel}
        busy={importConfig.resolving}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="flake-ref" className="mb-1.5 block font-medium text-sm">
          Repository reference
        </label>
        <RepoRefInput
          id="flake-ref"
          value={value}
          parsed={parsed}
          onChange={(next) => {
            setValue(next);
            setError(null);
          }}
          onSubmit={() => void use()}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-import-dir" className="font-medium text-sm">
          Where to save it
        </label>
        <input
          id="repo-import-dir"
          value={dir}
          onChange={(e) => {
            setDir(e.target.value);
            setError(null);
          }}
          placeholder="~/.darwin"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-muted-foreground text-xs">
          Imports into this directory, then selects it as your active config directory. Any path
          in your home directory works, <code className="font-mono">~</code> included; missing
          folders are created.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={use} disabled={!canUse || loading} className="flex-1">
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Importing…
            </>
          ) : (
            "Use this reference"
          )}
        </Button>
        <Button variant="secondary" onClick={importArchive} disabled={zipLoading}>
          {zipLoading ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Importing…
            </>
          ) : (
            <>
              <FileArchive className="size-4" aria-hidden="true" />
              Import a .zip
            </>
          )}
        </Button>
      </div>

      <details className="rounded-lg border border-border bg-card px-3 py-2">
        <summary className="cursor-pointer font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Reference examples
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_REFS.map((ex) => (
            <button
              key={ex.ref}
              type="button"
              onClick={() => setValue(ex.ref)}
              className="group flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/50"
            >
              <code className="font-mono text-foreground text-xs">{ex.ref}</code>
              <span className="text-[11px] text-muted-foreground">{ex.note}</span>
            </button>
          ))}
        </div>
      </details>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
